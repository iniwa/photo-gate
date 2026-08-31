import type { Context } from 'hono'
import type { Env } from '../types/env.js'
import { Layout } from '../templates/layout.js'
import { forbiddenResponse } from '../middleware/auth-response.js'
import { isValidId } from '../services/repository-validation.js'
import { parseUrlEncodedForm } from '../services/url-encoded-form.js'
import {
  type HardDeleteCategory,
  type HardDeleteTokenPayload,
  HARD_DELETE_HMAC_MIN_KEY_LEN,
  HARD_DELETE_TOKEN_TTL_MS,
  signHardDeleteToken,
  verifyHardDeleteToken,
} from '../services/admin-hard-delete-token.js'
import type { UserForHardDelete } from '../services/admin-user-repository.js'
import type { AlbumForHardDelete } from '../services/admin-album-repository.js'

type AdminContext = Context<{ Bindings: Env }>

type HardDeleteDeps = {
  hmacKey: string | undefined
  userRepo: {
    getUserForHardDelete(userId: string): Promise<UserForHardDelete | null>
    deleteUser(userId: string): Promise<void>
  }
  albumRepo: {
    getAlbumForHardDelete(albumId: string): Promise<AlbumForHardDelete | null>
    deleteAlbum(albumId: string): Promise<void>
  }
  syncTargetRepo: { removeTarget(albumId: string, publishedAt: string): Promise<void> }
  clock: () => Date
}

type TargetKind = 'user' | 'album'

const PHRASES: Record<TargetKind, string> = {
  user: 'DELETE USER',
  album: 'DELETE ALBUM',
}

const MAX_HARD_DELETE_FORM_BYTES = 4 * 1024

const CATEGORIES: Record<TargetKind, HardDeleteCategory> = {
  user: 'user-delete',
  album: 'album-delete',
}

function isSameOrigin(c: AdminContext): boolean {
  const origin = c.req.header('Origin')
  if (origin === undefined || origin === 'null') return false
  try {
    return origin === new URL(c.req.url).origin
  } catch {
    return false
  }
}

function isFormContentType(contentType: string | undefined): boolean {
  if (contentType === undefined) return false
  const parts = contentType.split(';')
  if (parts[0]?.trim().toLowerCase() !== 'application/x-www-form-urlencoded') return false
  if (parts.length === 1) return true
  if (parts.length !== 2) return false
  return /^charset\s*=\s*(?:"[^"]+"|[a-z0-9._-]+)$/i.test(parts[1]!.trim())
}

async function parseConfirmBody(c: AdminContext, fieldName: 'userId' | 'albumId'): Promise<string | null> {
  const body = await parseUrlEncodedForm(c.req.raw, MAX_HARD_DELETE_FORM_BYTES)
  if (body === null) return null
  if (Object.keys(body).length !== 1) return null
  const id = body[fieldName]
  if (typeof id !== 'string') return null
  if (id.length === 0 || !isValidId(id)) return null
  return id
}

async function parseDeleteBody(c: AdminContext): Promise<{ token: string; phrase: string } | null> {
  const body = await parseUrlEncodedForm(c.req.raw, MAX_HARD_DELETE_FORM_BYTES)
  if (body === null) return null
  if (Object.keys(body).length !== 2) return null
  const token = body['token']
  const phrase = body['phrase']
  if (typeof token !== 'string' || typeof phrase !== 'string') return null
  if (token.length === 0 || token.length > 2048) return null
  if (phrase.length === 0 || phrase.length > 64) return null
  return { token, phrase }
}

function badRequest(c: AdminContext): Response {
  c.header('Cache-Control', 'no-store')
  return c.text('Bad Request', 400)
}

function internalError(c: AdminContext): Response {
  c.header('Cache-Control', 'no-store')
  return c.text('Internal Server Error', 500)
}

async function readTarget(
  deps: HardDeleteDeps,
  kind: TargetKind,
  targetId: string,
): Promise<UserForHardDelete | AlbumForHardDelete | null> {
  if (kind === 'user') return deps.userRepo.getUserForHardDelete(targetId)
  return deps.albumRepo.getAlbumForHardDelete(targetId)
}

function targetLabel(kind: TargetKind): string {
  return kind === 'user' ? 'ユーザー' : 'アルバム'
}

function targetBackHref(kind: TargetKind): string {
  return kind === 'user' ? '/admin/users' : '/admin/albums'
}

function deleteAction(kind: TargetKind): string {
  return kind === 'user' ? '/admin/users/delete' : '/admin/albums/delete'
}

export async function handleUserHardDeleteConfirm(c: AdminContext, deps: HardDeleteDeps): Promise<Response> {
  return handleHardDeleteConfirm(c, deps, 'user')
}

export async function handleAlbumHardDeleteConfirm(c: AdminContext, deps: HardDeleteDeps): Promise<Response> {
  return handleHardDeleteConfirm(c, deps, 'album')
}

export async function handleUserHardDeletePreview(c: AdminContext, deps: HardDeleteDeps): Promise<Response> {
  return handleHardDeletePreview(c, deps, 'user')
}

export async function handleAlbumHardDeletePreview(c: AdminContext, deps: HardDeleteDeps): Promise<Response> {
  return handleHardDeletePreview(c, deps, 'album')
}

async function handleHardDeleteConfirm(
  c: AdminContext,
  deps: HardDeleteDeps,
  kind: TargetKind,
): Promise<Response> {
  if (!isSameOrigin(c)) return forbiddenResponse(c)
  if (!isFormContentType(c.req.header('Content-Type'))) return badRequest(c)

  const targetId = await parseConfirmBody(c, kind === 'user' ? 'userId' : 'albumId')
  if (targetId === null) return badRequest(c)

  if (typeof deps.hmacKey !== 'string' || deps.hmacKey.length < HARD_DELETE_HMAC_MIN_KEY_LEN) {
    return internalError(c)
  }

  let target: UserForHardDelete | AlbumForHardDelete | null
  try {
    target = await readTarget(deps, kind, targetId)
  } catch {
    return internalError(c)
  }

  if (target === null) {
    c.header('Cache-Control', 'no-store')
    return c.html(<HardDeleteTargetMissingPage kind={kind} />)
  }

  let issuedAt: number
  try {
    issuedAt = deps.clock().valueOf()
  } catch {
    return internalError(c)
  }

  const payload: HardDeleteTokenPayload = {
    schema: 1,
    issuedAt,
    expiresAt: issuedAt + HARD_DELETE_TOKEN_TTL_MS,
    category: CATEGORIES[kind],
    targetId,
  }

  let token: string
  try {
    token = await signHardDeleteToken(deps.hmacKey, payload)
  } catch {
    return internalError(c)
  }

  c.header('Cache-Control', 'no-store')
  return c.html(<HardDeleteConfirmPage kind={kind} target={target} token={token} />)
}

async function handleHardDeletePreview(
  c: AdminContext,
  deps: HardDeleteDeps,
  kind: TargetKind,
): Promise<Response> {
  if (!isSameOrigin(c)) return forbiddenResponse(c)
  if (!isFormContentType(c.req.header('Content-Type'))) return badRequest(c)

  const fields = await parseDeleteBody(c)
  if (fields === null) return badRequest(c)
  if (fields.phrase !== PHRASES[kind]) return badRequest(c)

  if (typeof deps.hmacKey !== 'string' || deps.hmacKey.length < HARD_DELETE_HMAC_MIN_KEY_LEN) {
    return internalError(c)
  }

  let nowMs: number
  try {
    nowMs = deps.clock().valueOf()
  } catch {
    return internalError(c)
  }

  let tokenPayload: HardDeleteTokenPayload | null
  try {
    tokenPayload = await verifyHardDeleteToken(deps.hmacKey, fields.token, nowMs)
  } catch {
    return badRequest(c)
  }
  if (tokenPayload === null || tokenPayload.category !== CATEGORIES[kind]) return badRequest(c)

  let target: UserForHardDelete | AlbumForHardDelete | null
  try {
    target = await readTarget(deps, kind, tokenPayload.targetId)
  } catch {
    return internalError(c)
  }
  if (target === null) {
    c.header('Cache-Control', 'no-store')
    return c.html(<HardDeleteTargetMissingPage kind={kind} />)
  }

  if (kind === 'user') {
    const userTarget = target as UserForHardDelete
    try {
      await deps.userRepo.deleteUser(tokenPayload.targetId)
    } catch {
      return internalError(c)
    }

    c.header('Cache-Control', 'no-store')
    return c.html(<UserHardDeleteCompletedPage target={userTarget} />)
  }

  const albumTarget = target as AlbumForHardDelete
  let publishedAt: string
  try {
    publishedAt = deps.clock().toISOString()
  } catch {
    return internalError(c)
  }

  try {
    await deps.syncTargetRepo.removeTarget(tokenPayload.targetId, publishedAt)
  } catch {
    return internalError(c)
  }

  try {
    await deps.albumRepo.deleteAlbum(tokenPayload.targetId)
  } catch {
    return internalError(c)
  }

  c.header('Cache-Control', 'no-store')
  return c.html(<AlbumHardDeleteCompletedPage target={albumTarget} />)
}

function HardDeleteTargetMissingPage({ kind }: { kind: TargetKind }) {
  return (
    <Layout title={`${targetLabel(kind)}削除確認`} area="admin">
      <a class="admin-back-link" href={targetBackHref(kind)}>
        ← {targetLabel(kind)}一覧へ
      </a>
      <h1 class="admin-page-title">{targetLabel(kind)}削除確認</h1>
      <p class="admin-notice admin-notice-empty">対象は見つかりませんでした。削除フォームは表示しません。</p>
    </Layout>
  )
}

function HardDeleteConfirmPage({
  kind,
  target,
  token,
}: {
  kind: TargetKind
  target: UserForHardDelete | AlbumForHardDelete
  token: string
}) {
  const isUser = kind === 'user'
  return (
    <Layout title={`${targetLabel(kind)}削除確認プレビュー`} area="admin">
      <a class="admin-back-link" href={targetBackHref(kind)}>
        ← {targetLabel(kind)}一覧へ
      </a>
      <h1 class="admin-page-title">{targetLabel(kind)}削除確認プレビュー</h1>
      <section class="admin-panel admin-danger-panel">
        {isUser ? (
          <p>
            <strong>注意:</strong> このフォームを送信すると、ユーザー行を D1 から削除します。
          </p>
        ) : (
          <p>
            <strong>注意:</strong> このフォームを送信すると、対象の同期ターゲットを先に削除してから、アルバム行を D1 から削除します。
          </p>
        )}
        <div class="admin-table-scroll">
          <table class="admin-table">
            <tbody>
              <tr>
                <th>{isUser ? 'ユーザーID' : 'アルバムID'}</th>
                <td>{target.id}</td>
              </tr>
              <tr>
                <th>{isUser ? '表示名' : 'タイトル'}</th>
                <td>{isUser ? (target as UserForHardDelete).display_name : (target as AlbumForHardDelete).title}</td>
              </tr>
              <tr>
                <th>状態</th>
                <td>{target.enabled === 1 ? '有効' : '無効'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {isUser ? (
          <p class="admin-notice admin-notice-warning">
            このユーザー行の削除により、セッションとアルバム権限は D1 の cascade で削除されます。
          </p>
        ) : (
          <div>
            <p class="admin-notice admin-notice-warning">
              このアルバムの権限は、D1 の既存 foreign-key cascade により削除されます。
            </p>
            <p class="admin-notice admin-notice-warning">
              R2 アルバムオブジェクトは削除されません。D1 行削除後に孤立プレフィックスとしてクリーンアップレポートに表示される場合があります。
            </p>
          </div>
        )}
        <p>
          続行するには <code>{PHRASES[kind]}</code> を正確に入力してください。トークンは 15 分間有効です。
        </p>
        <form class="admin-form" method="post" action={deleteAction(kind)}>
          <input type="hidden" name="token" value={token} />
          <label class="admin-field">
            確認フレーズ
            <input type="text" name="phrase" required autocomplete="off" />
          </label>
          <button type="submit" class="admin-button admin-button-danger">{isUser ? 'ユーザーを完全削除' : 'アルバムを完全削除'}</button>
        </form>
      </section>
    </Layout>
  )
}

function UserHardDeleteCompletedPage({ target }: { target: UserForHardDelete }) {
  return (
    <Layout title="User hard delete completed" area="admin">
      <a class="admin-back-link" href="/admin/users">
        Back to users
      </a>
      <h1 class="admin-page-title">User hard delete completed</h1>
      <p class="admin-notice admin-notice-info">The user row was deleted from D1.</p>
      <div class="admin-table-scroll">
        <table class="admin-table">
          <tbody>
            <tr>
              <th>User ID</th>
              <td>{target.id}</td>
            </tr>
            <tr>
              <th>Display name</th>
              <td>{target.display_name}</td>
            </tr>
            <tr>
              <th>Previous status</th>
              <td>{target.enabled === 1 ? 'enabled' : 'disabled'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="admin-notice admin-notice-empty">
        Sessions and album permissions are removed by the existing D1 foreign-key cascade.
      </p>
    </Layout>
  )
}

function AlbumHardDeleteCompletedPage({ target }: { target: AlbumForHardDelete }) {
  return (
    <Layout title="Album hard delete completed" area="admin">
      <a class="admin-back-link" href="/admin/albums">
        Back to albums
      </a>
      <h1 class="admin-page-title">Album hard delete completed</h1>
      <p class="admin-notice admin-notice-info">The sync target entry was removed first, then the album row was deleted from D1.</p>
      <div class="admin-table-scroll">
        <table class="admin-table">
          <tbody>
            <tr>
              <th>Album ID</th>
              <td>{target.id}</td>
            </tr>
            <tr>
              <th>Title</th>
              <td>{target.title}</td>
            </tr>
            <tr>
              <th>Previous status</th>
              <td>{target.enabled === 1 ? 'enabled' : 'disabled'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="admin-notice admin-notice-empty">
        Album permissions are removed by the existing D1 foreign-key cascade.
      </p>
      <p class="admin-notice admin-notice-empty">
        R2 album objects were not deleted. They may appear as orphaned prefixes in /admin/r2-cleanup.
      </p>
    </Layout>
  )
}
