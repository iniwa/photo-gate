import type { Context } from 'hono'
import type { Env } from '../types/env.js'
import type { AdminR2CleanupReport } from '../types/admin-r2-cleanup.js'
import { Layout } from '../templates/layout.js'
import { forbiddenResponse } from '../middleware/auth-response.js'
import {
  type CleanupTokenPayload,
  R2_CLEANUP_HMAC_MIN_KEY_LEN,
  R2_CLEANUP_TOKEN_TTL_MS,
  computeOrphanFingerprint,
  signCleanupToken,
  verifyCleanupToken,
} from '../services/admin-r2-cleanup-delete-token.js'

type AdminContext = Context<{ Bindings: Env }>

export const R2_CLEANUP_CONFIRM_MAX_ORPHAN_PREFIXES = 50
export const R2_CLEANUP_CONFIRM_MAX_OBJECTS = 500

export type R2CleanupConfirmDeps = {
  hmacKey: string | undefined
  r2CleanupRepo: { getReport(): Promise<AdminR2CleanupReport> }
  clock: () => Date
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

export async function parseConfirmBody(
  c: AdminContext,
): Promise<Record<never, never> | null> {
  let body: Record<string, string | File | (string | File)[]>
  try {
    body = await c.req.parseBody({ all: true })
  } catch {
    return null
  }
  if (Object.keys(body).length !== 0) return null
  return {}
}

export async function parseDeleteBody(
  c: AdminContext,
): Promise<{ token: string; phrase: string } | null> {
  let body: Record<string, string | File | (string | File)[]>
  try {
    body = await c.req.parseBody({ all: true })
  } catch {
    return null
  }
  if (Object.keys(body).length !== 2) return null
  const token = body['token']
  const phrase = body['phrase']
  if (typeof token !== 'string' || typeof phrase !== 'string') return null
  if (token.length === 0 || token.length > 2048) return null
  if (phrase.length === 0 || phrase.length > 64) return null
  return { token, phrase }
}

export function extractOrphanEntries(
  report: AdminR2CleanupReport,
): { albumId: string; objectCount: number; totalBytes: number }[] {
  return report.albums
    .filter((e) => e.category === 'orphan')
    .map((e) => ({ albumId: e.albumId, objectCount: e.objectCount, totalBytes: e.totalBytes }))
}

export async function handleR2CleanupConfirm(
  c: AdminContext,
  deps: R2CleanupConfirmDeps,
): Promise<Response> {
  if (!isSameOrigin(c)) return forbiddenResponse(c)
  if (!isFormContentType(c.req.header('Content-Type'))) {
    c.header('Cache-Control', 'no-store')
    return c.text('Bad Request', 400)
  }
  const fields = await parseConfirmBody(c)
  if (fields === null) {
    c.header('Cache-Control', 'no-store')
    return c.text('Bad Request', 400)
  }

  const { hmacKey, r2CleanupRepo, clock } = deps
  if (typeof hmacKey !== 'string' || hmacKey.length < R2_CLEANUP_HMAC_MIN_KEY_LEN) {
    c.header('Cache-Control', 'no-store')
    return c.text('Internal Server Error', 500)
  }

  let report: AdminR2CleanupReport
  try {
    report = await r2CleanupRepo.getReport()
  } catch {
    c.header('Cache-Control', 'no-store')
    return c.text('Internal Server Error', 500)
  }

  if (report.truncated) {
    c.header('Cache-Control', 'no-store')
    return c.text('Bad Request', 400)
  }

  const orphanEntries = extractOrphanEntries(report)
  const orphanPrefixCount = orphanEntries.length
  const orphanObjectCount = orphanEntries.reduce((s, e) => s + e.objectCount, 0)
  const orphanTotalBytes = orphanEntries.reduce((s, e) => s + e.totalBytes, 0)

  if (orphanPrefixCount > R2_CLEANUP_CONFIRM_MAX_ORPHAN_PREFIXES) {
    c.header('Cache-Control', 'no-store')
    return c.text('Bad Request', 400)
  }
  if (orphanObjectCount > R2_CLEANUP_CONFIRM_MAX_OBJECTS) {
    c.header('Cache-Control', 'no-store')
    return c.text('Bad Request', 400)
  }

  let fingerprint: string
  try {
    fingerprint = await computeOrphanFingerprint(orphanEntries)
  } catch {
    c.header('Cache-Control', 'no-store')
    return c.text('Internal Server Error', 500)
  }

  const issuedAt = clock().valueOf()
  const expiresAt = issuedAt + R2_CLEANUP_TOKEN_TTL_MS
  const payload: CleanupTokenPayload = {
    schema: 1,
    issuedAt,
    expiresAt,
    category: 'orphan',
    fingerprint,
    orphanPrefixCount,
    orphanObjectCount,
  }

  let token: string
  try {
    token = await signCleanupToken(hmacKey, payload)
  } catch {
    c.header('Cache-Control', 'no-store')
    return c.text('Internal Server Error', 500)
  }

  c.header('Cache-Control', 'no-store')
  return c.html(
    <AdminR2CleanupConfirmPage
      orphanPrefixCount={orphanPrefixCount}
      orphanObjectCount={orphanObjectCount}
      orphanTotalBytes={orphanTotalBytes}
      token={token}
    />,
  )
}

export async function handleR2CleanupDelete(
  c: AdminContext,
  deps: R2CleanupConfirmDeps,
): Promise<Response> {
  if (!isSameOrigin(c)) return forbiddenResponse(c)
  if (!isFormContentType(c.req.header('Content-Type'))) {
    c.header('Cache-Control', 'no-store')
    return c.text('Bad Request', 400)
  }
  const fields = await parseDeleteBody(c)
  if (fields === null) {
    c.header('Cache-Control', 'no-store')
    return c.text('Bad Request', 400)
  }

  if (fields.phrase !== 'DELETE ORPHANS') {
    c.header('Cache-Control', 'no-store')
    return c.text('Bad Request', 400)
  }

  const { hmacKey, r2CleanupRepo, clock } = deps
  if (typeof hmacKey !== 'string' || hmacKey.length < R2_CLEANUP_HMAC_MIN_KEY_LEN) {
    c.header('Cache-Control', 'no-store')
    return c.text('Internal Server Error', 500)
  }

  const nowMs = clock().valueOf()
  let tokenPayload: CleanupTokenPayload | null
  try {
    tokenPayload = await verifyCleanupToken(hmacKey, fields.token, nowMs)
  } catch {
    c.header('Cache-Control', 'no-store')
    return c.text('Bad Request', 400)
  }
  if (tokenPayload === null) {
    c.header('Cache-Control', 'no-store')
    return c.text('Bad Request', 400)
  }

  let report: AdminR2CleanupReport
  try {
    report = await r2CleanupRepo.getReport()
  } catch {
    c.header('Cache-Control', 'no-store')
    return c.text('Internal Server Error', 500)
  }

  if (report.truncated) {
    c.header('Cache-Control', 'no-store')
    return c.text('Bad Request', 400)
  }

  const orphanEntries = extractOrphanEntries(report)
  const orphanPrefixCount = orphanEntries.length
  const orphanObjectCount = orphanEntries.reduce((s, e) => s + e.objectCount, 0)

  if (orphanPrefixCount > R2_CLEANUP_CONFIRM_MAX_ORPHAN_PREFIXES) {
    c.header('Cache-Control', 'no-store')
    return c.text('Bad Request', 400)
  }
  if (orphanObjectCount > R2_CLEANUP_CONFIRM_MAX_OBJECTS) {
    c.header('Cache-Control', 'no-store')
    return c.text('Bad Request', 400)
  }

  let currentFingerprint: string
  try {
    currentFingerprint = await computeOrphanFingerprint(orphanEntries)
  } catch {
    c.header('Cache-Control', 'no-store')
    return c.text('Internal Server Error', 500)
  }

  if (currentFingerprint !== tokenPayload.fingerprint) {
    c.header('Cache-Control', 'no-store')
    return c.text('Bad Request', 400)
  }

  // Phase 2: deletion not yet enabled.
  c.header('Cache-Control', 'no-store')
  return c.html(<AdminR2CleanupDeletePreviewPage />)
}

function AdminR2CleanupConfirmPage({
  orphanPrefixCount,
  orphanObjectCount,
  orphanTotalBytes,
  token,
}: {
  orphanPrefixCount: number
  orphanObjectCount: number
  orphanTotalBytes: number
  token: string
}) {
  return (
    <Layout title="R2 孤立オブジェクト削除確認プレビュー" area="admin">
      <a class="admin-back-link" href="/admin/r2-cleanup">
        ← R2 クリーンアップレポートへ
      </a>
      <h1 class="admin-page-title">R2 孤立オブジェクト削除確認プレビュー</h1>
      <section class="admin-panel admin-danger-panel">
        <p>
          <strong>注意:</strong> これは Phase 2 の確認プレビューです。このフォームを送信しても R2
          オブジェクトは削除されません。
        </p>
        <h2 class="admin-section-heading">孤立プレフィックス集計（再スキャン結果）</h2>
        <div class="admin-table-scroll">
          <table class="admin-table">
            <tbody>
              <tr>
                <th>孤立アルバムプレフィックス数</th>
                <td>{orphanPrefixCount}</td>
              </tr>
              <tr>
                <th>孤立オブジェクト総数</th>
                <td>{orphanObjectCount}</td>
              </tr>
              <tr>
                <th>孤立オブジェクト総バイト数（概算）</th>
                <td>{orphanTotalBytes}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="admin-notice admin-notice-warning">この確認トークンは 15 分間有効です。期限切れ後はレポートページから再度開始してください。</p>
        <h2 class="admin-section-heading">削除フレーズ確認（Phase 2 プレビュー）</h2>
        <p>
          確認するには、以下のフォームに正確に <code>DELETE ORPHANS</code> と入力して送信してください。
        </p>
        <form class="admin-form" method="post" action="/admin/r2-cleanup/delete">
          <input type="hidden" name="token" value={token} />
          <label class="admin-field">
            確認フレーズ
            <input type="text" name="phrase" required autocomplete="off" />
          </label>
          <button type="submit" class="admin-button admin-button-danger">確認送信（Phase 2: 削除は無効）</button>
        </form>
      </section>
    </Layout>
  )
}

function AdminR2CleanupDeletePreviewPage() {
  return (
    <Layout title="R2 削除プレビュー結果" area="admin">
      <a class="admin-back-link" href="/admin/r2-cleanup">
        ← R2 クリーンアップレポートへ
      </a>
      <h1 class="admin-page-title">R2 削除プレビュー結果</h1>
      <section class="admin-panel admin-danger-panel">
        <p>確認フレーズと候補セットの検証に成功しました。</p>
        <p class="admin-notice admin-notice-warning">
        R2 オブジェクトの削除は現在このフェーズでは有効ではありません。Phase 3
        で個別の承認後に有効になります。
        </p>
      </section>
    </Layout>
  )
}
