import type { AdminAlbumPage } from '../types/admin-album.js'
import type { AdminAlbumCatalogEntry } from '../types/admin-album-catalog.js'
import type { AdminAlbumReadiness } from '../types/admin-album-readiness.js'
import type { AdminOpsSummary } from '../types/admin-ops.js'
import type { AssignmentOptions } from '../types/admin-permission.js'
import type { AdminR2CleanupReport } from '../types/admin-r2-cleanup.js'
import type { AdminSyncResult } from '../types/admin-sync-result.js'
import type { AdminSyncStatus } from '../types/admin-sync-status.js'
import type { AdminUserPage } from '../types/admin-user.js'
import { Layout } from '../templates/layout.js'

/**
 * Minimal admin home page with links to the inventories.
 */
export function AdminHome() {
  return (
    <Layout title="管理コンソール" area="admin">
      <section class="admin-home">
        <h1 class="admin-page-title">管理コンソール</h1>
        <nav class="admin-nav" aria-label="管理メニュー">
          <ul class="admin-nav-list">
            <li><a class="admin-nav-link" href="/admin/users">ユーザー一覧</a></li>
            <li><a class="admin-nav-link" href="/admin/albums">アルバム一覧</a></li>
            <li><a class="admin-nav-link" href="/admin/permissions">権限一覧</a></li>
            <li><a class="admin-nav-link" href="/admin/ops">運用サマリ</a></li>
            <li><a class="admin-nav-link" href="/admin/sync">同期状態</a></li>
            <li><a class="admin-nav-link" href="/admin/r2-cleanup">R2 クリーンアップレポート（ドライラン）</a></li>
          </ul>
        </nav>
      </section>
    </Layout>
  )
}

/**
 * User inventory page with create-user form and per-row password-reset form.
 * password_hash is never selected, returned, rendered, or logged.
 */
export function AdminUsersPage({ page }: { page: AdminUserPage }) {
  const { users, hasMore } = page
  const lastId = users.length > 0 ? users[users.length - 1]!.id : undefined

  return (
    <Layout title="ユーザー一覧" area="admin">
      <a class="admin-back-link" href="/admin">
        ← 管理コンソールへ
      </a>
      <h1 class="admin-page-title">ユーザー一覧</h1>
      <form class="admin-form admin-panel" method="post" action="/admin/users/create">
        <h2 class="admin-section-heading">ユーザーを作成</h2>
        <label class="admin-field">
          ユーザーID
          <input type="text" name="userId" required />
        </label>
        <label class="admin-field">
          表示名
          <input type="text" name="displayName" required />
        </label>
        <label class="admin-field">
          パスワード
          <input type="password" name="password" required />
        </label>
        <button type="submit" class="admin-button admin-button-primary">作成</button>
      </form>
      {users.length === 0 ? (
        <p class="admin-notice admin-notice-empty">ユーザーがいません</p>
      ) : (
        <div class="admin-table-scroll">
          <table class="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>表示名</th>
                <th>状態</th>
                <th>ログイン失敗回数</th>
                <th>ロック</th>
                <th>作成日時</th>
                <th>更新日時</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.id}</td>
                  <td>{u.display_name}</td>
                  <td>{u.enabled === 1 ? '有効' : '無効'}</td>
                  <td>{u.fail_count}</td>
                  <td>
                    {u.locked_until === null
                      ? 'なし'
                      : `ロック中 (${u.locked_until})`}
                  </td>
                  <td>{u.created_at}</td>
                  <td>{u.updated_at}</td>
                  <td>
                    <div class="admin-action-group">
                      {u.enabled === 1 ? (
                        <form class="admin-row-form" method="post" action="/admin/users/disable">
                          <input type="hidden" name="userId" value={u.id} />
                          <button type="submit" class="admin-button admin-button-secondary">無効化</button>
                        </form>
                      ) : (
                        <form class="admin-row-form" method="post" action="/admin/users/enable">
                          <input type="hidden" name="userId" value={u.id} />
                          <button type="submit" class="admin-button admin-button-secondary">有効化</button>
                        </form>
                      )}
                      <form class="admin-row-form" method="post" action="/admin/users/update-display-name">
                        <input type="hidden" name="userId" value={u.id} />
                        <input type="text" name="displayName" value={u.display_name} required />
                        <button type="submit" class="admin-button admin-button-secondary">表示名変更</button>
                      </form>
                      <form class="admin-row-form" method="post" action="/admin/users/reset-password">
                        <input type="hidden" name="userId" value={u.id} />
                        <input type="password" name="password" required />
                        <button type="submit" class="admin-button admin-button-secondary">パスワードリセット</button>
                      </form>
                      <form class="admin-row-form" method="post" action="/admin/users/confirm-delete">
                        <input type="hidden" name="userId" value={u.id} />
                        <button type="submit" class="admin-button admin-button-danger">削除確認プレビュー</button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasMore && lastId !== undefined ? (
        <nav class="admin-pagination" aria-label="ユーザー一覧のページ送り">
          <a class="admin-pagination-link" href={`/admin/users?after=${lastId}`}>
            次へ
          </a>
        </nav>
      ) : null}
    </Layout>
  )
}

/**
 * Read-only album inventory page.
 * photoprism_album_uid, transform settings, and strip_exif are never selected,
 * returned, rendered, or logged.
 */
export function AdminAlbumsPage({
  page,
  catalog,
  readinessByAlbumId,
}: {
  page: AdminAlbumPage
  catalog: { status: 'missing' } | { status: 'available'; publishedAt: string; albums: AdminAlbumCatalogEntry[] }
  readinessByAlbumId: ReadonlyMap<string, AdminAlbumReadiness>
}) {
  const { albums, hasMore } = page
  const lastId = albums.length > 0 ? albums[albums.length - 1]!.id : undefined
  const catalogEntries = catalog.status === 'available' ? catalog.albums : []

  return (
    <Layout title="アルバム一覧" area="admin">
      <a class="admin-back-link" href="/admin">
        ← 管理コンソールへ
      </a>
      <h1 class="admin-page-title">アルバム一覧</h1>
      <p class="admin-notice admin-notice-info">
        共有手順: カタログを更新 → 同期対象を設定 → 同期 → 有効化 → 権限を付与。準備状態は安全な集計情報だけで確認できます。
      </p>
      <form class="admin-form admin-panel" method="post" action="/admin/albums/create">
        <h2 class="admin-section-heading">アルバムを作成</h2>
        <label class="admin-field">
          アルバムID
          <input type="text" name="albumId" required />
        </label>
        <label class="admin-field">
          タイトル
          <input type="text" name="title" required />
        </label>
        <label class="admin-field">
          PhotoPrism album UID
          <input type="text" name="photoprismAlbumUid" required />
        </label>
        <label class="admin-field">
          有効期限
          <input type="text" name="expiresAt" placeholder="YYYY-MM-DDTHH:mm:ss.sssZ または空" />
        </label>
        <label class="admin-field">
          ダウンロード
          <select name="downloadEnabled">
            <option value="0" selected>不可</option>
            <option value="1">許可</option>
          </select>
        </label>
        <button type="submit" class="admin-button admin-button-primary">作成</button>
      </form>
      {albums.length === 0 ? (
        <p class="admin-notice admin-notice-empty">アルバムがありません</p>
      ) : (
        <div class="admin-table-scroll">
          <table class="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>タイトル</th>
                <th>状態</th>
                <th>共有準備</th>
                <th>有効期限</th>
                <th>ダウンロード</th>
                <th>作成日時</th>
                <th>更新日時</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {albums.map((a) => (
                <tr key={a.id}>
                  <td>{a.id}</td>
                  <td>{a.title}</td>
                  <td>{a.enabled === 1 ? '有効' : '無効'}</td>
                  <td>{readinessByAlbumId.get(a.id)?.label ?? '状態確認不可'}</td>
                  <td>{a.expires_at === null ? 'なし' : a.expires_at}</td>
                  <td>{a.download_enabled === 1 ? '許可' : '不可'}</td>
                  <td>{a.created_at}</td>
                  <td>{a.updated_at}</td>
                  <td>
                    <div class="admin-action-group">
                      {a.enabled === 1 ? (
                        <form class="admin-row-form" method="post" action="/admin/albums/disable">
                          <input type="hidden" name="albumId" value={a.id} />
                          <button type="submit" class="admin-button admin-button-secondary">無効化</button>
                        </form>
                      ) : (
                        <form class="admin-row-form" method="post" action="/admin/albums/enable">
                          <input type="hidden" name="albumId" value={a.id} />
                          <button type="submit" class="admin-button admin-button-secondary">有効化</button>
                        </form>
                      )}
                      <form class="admin-row-form" method="post" action="/admin/albums/update-public-metadata">
                        <input type="hidden" name="albumId" value={a.id} />
                        <input type="text" name="title" value={a.title} required />
                        <input type="text" name="expiresAt" value={a.expires_at ?? ''} placeholder="YYYY-MM-DDTHH:mm:ss.sssZ または空" />
                        <select name="downloadEnabled">
                          <option value="0" selected={a.download_enabled === 0}>不可</option>
                          <option value="1" selected={a.download_enabled === 1}>許可</option>
                        </select>
                        <button type="submit" class="admin-button admin-button-secondary">メタデータ更新</button>
                      </form>
                      {catalogEntries.length > 0 ? (
                        <form class="admin-row-form" method="post" action="/admin/albums/sync-target-upsert">
                          <input type="hidden" name="albumId" value={a.id} />
                          <select name="catalogId" required>
                            {catalogEntries.map(entry => (
                              <option key={entry.catalogId} value={entry.catalogId}>
                                {entry.title} ({entry.photoCount !== null ? `${entry.photoCount}枚` : '不明'}, {entry.updatedAt ?? '不明'})
                              </option>
                            ))}
                          </select>
                          <button type="submit" class="admin-button admin-button-secondary">同期ターゲット設定</button>
                        </form>
                      ) : (
                        <p class="admin-notice admin-notice-empty">カタログ未取得</p>
                      )}
                      <form class="admin-row-form" method="post" action="/admin/albums/sync-target-remove">
                        <input type="hidden" name="albumId" value={a.id} />
                        <button type="submit" class="admin-button admin-button-secondary">同期ターゲット削除</button>
                      </form>
                      <form class="admin-row-form" method="post" action="/admin/albums/confirm-delete">
                        <input type="hidden" name="albumId" value={a.id} />
                        <button type="submit" class="admin-button admin-button-danger">削除確認プレビュー</button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasMore && lastId !== undefined ? (
        <nav class="admin-pagination" aria-label="アルバム一覧のページ送り">
          <a class="admin-pagination-link" href={`/admin/albums?after=${lastId}`}>
            次へ
          </a>
        </nav>
      ) : null}
    </Layout>
  )
}

/**
 * Read-only operational summary page. Displays only aggregate counts.
 * No row-level identity, title, hash, token, PhotoPrism UID, or R2 data.
 */
export function AdminOpsPage({ summary }: { summary: AdminOpsSummary }) {
  return (
    <Layout title="運用サマリ" area="admin">
      <a class="admin-back-link" href="/admin">
        ← 管理コンソールへ
      </a>
      <h1 class="admin-page-title">運用サマリ</h1>
      <p class="admin-meta">生成日時: {summary.generatedAt}</p>
      <h2 class="admin-section-heading">ユーザー</h2>
      <div class="admin-table-scroll">
        <table class="admin-table">
          <tbody>
            <tr><th>合計</th><td>{summary.users.total}</td></tr>
            <tr><th>有効</th><td>{summary.users.enabled}</td></tr>
            <tr><th>無効</th><td>{summary.users.disabled}</td></tr>
            <tr><th>ロック中</th><td>{summary.users.locked}</td></tr>
          </tbody>
        </table>
      </div>
      <h2 class="admin-section-heading">アルバム</h2>
      <div class="admin-table-scroll">
        <table class="admin-table">
          <tbody>
            <tr><th>合計</th><td>{summary.albums.total}</td></tr>
            <tr><th>有効</th><td>{summary.albums.enabled}</td></tr>
            <tr><th>無効</th><td>{summary.albums.disabled}</td></tr>
            <tr><th>期限切れ</th><td>{summary.albums.expired}</td></tr>
            <tr><th>まもなく期限切れ (7日以内)</th><td>{summary.albums.expiringSoon}</td></tr>
            <tr><th>ダウンロード許可</th><td>{summary.albums.downloadable}</td></tr>
          </tbody>
        </table>
      </div>
      <h2 class="admin-section-heading">権限</h2>
      <div class="admin-table-scroll">
        <table class="admin-table">
          <tbody>
            <tr><th>合計</th><td>{summary.permissions.total}</td></tr>
          </tbody>
        </table>
      </div>
      <h2 class="admin-section-heading">セッション</h2>
      <div class="admin-table-scroll">
        <table class="admin-table">
          <tbody>
            <tr><th>合計</th><td>{summary.sessions.total}</td></tr>
            <tr><th>期限切れ</th><td>{summary.sessions.expired}</td></tr>
          </tbody>
        </table>
      </div>
    </Layout>
  )
}

/**
 * Permission assignment page. Renders safe select menus (album title, user
 * display_name, enabled status) for the grant form and existing revoke forms.
 *
 * Selected/rendered fields only:
 *   users  — id (hidden value), display_name (option label), enabled (status badge)
 *   albums — id (hidden value), title (option label), enabled (status badge)
 *   album_permissions — album_id, user_id, created_at
 *
 * Never renders: password_hash, session tokens, photoprism_album_uid, R2 keys,
 * transform settings, fail_count, locked_until, or PhotoPrism/NAS source data.
 */
export function AdminPermissionsPage({ options }: { options: AssignmentOptions }) {
  const { users, albums, permissions, hasMore } = options
  const last = permissions.length > 0 ? permissions[permissions.length - 1] : undefined

  return (
    <Layout title="権限一覧" area="admin">
      <a class="admin-back-link" href="/admin">
        ← 管理コンソールへ
      </a>
      <h1 class="admin-page-title">権限一覧</h1>
      <form class="admin-form admin-panel" method="post" action="/admin/permissions/grant">
        <h2 class="admin-section-heading">権限を付与</h2>
        <label class="admin-field">
          アルバム
          <select name="albumId" required>
            {albums.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}{a.enabled === 0 ? ' (無効)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label class="admin-field">
          ユーザー
          <select name="userId" required>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name}{u.enabled === 0 ? ' (無効)' : ''}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" class="admin-button admin-button-primary">付与</button>
      </form>
      {permissions.length === 0 ? (
        <p class="admin-notice admin-notice-empty">権限がありません</p>
      ) : (
        <div class="admin-table-scroll">
          <table class="admin-table">
            <thead>
              <tr>
                <th>アルバムID</th>
                <th>ユーザーID</th>
                <th>作成日時</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {permissions.map((p) => (
                <tr key={`${p.album_id}/${p.user_id}`}>
                  <td>{p.album_id}</td>
                  <td>{p.user_id}</td>
                  <td>{p.created_at}</td>
                  <td>
                    <div class="admin-action-group">
                      <form class="admin-row-form" method="post" action="/admin/permissions/revoke">
                        <input type="hidden" name="albumId" value={p.album_id} />
                        <input type="hidden" name="userId" value={p.user_id} />
                        <button type="submit" class="admin-button admin-button-secondary">取り消し</button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasMore && last !== undefined ? (
        <nav class="admin-pagination" aria-label="権限一覧のページ送り">
          <a class="admin-pagination-link" href={`/admin/permissions?after_album=${last.album_id}&after_user=${last.user_id}`}>
            次へ
          </a>
        </nav>
      ) : null}
    </Layout>
  )
}

function triggerKindLabel(kind: 'scheduled' | 'manual' | null): string {
  if (kind === 'scheduled') return '定期実行'
  if (kind === 'manual') return '手動実行'
  return '未報告'
}

function syncOperationLabel(operation: AdminSyncResult['operation']): string {
  return operation === 'sync' ? '画像同期' : 'カタログ更新'
}

function syncResultLabel(result: AdminSyncResult['result']): string {
  if (result === 'ok') return '成功'
  if (result === 'partial') return '一部失敗'
  return '失敗'
}

/**
 * Sync status page. Renders sanitized operational fields, a pending indicator,
 * and a no-JS form to trigger a manual sync.
 * No album title, PhotoPrism UID/URL/token, R2 credentials, raw JSON,
 * pending request ID, or pending timestamp is rendered.
 */
export function AdminSyncPage({
  syncStatus,
  isSyncPending,
  isCatalogRefreshPending,
  syncResult,
}: {
  syncStatus: AdminSyncStatus | null
  isSyncPending: boolean
  isCatalogRefreshPending: boolean
  syncResult: AdminSyncResult | null
}) {
  return (
    <Layout title="同期状態" area="admin">
      <a class="admin-back-link" href="/admin">
        ← 管理コンソールへ
      </a>
      <h1 class="admin-page-title">同期状態</h1>
      {isSyncPending && (<p class="admin-notice admin-notice-warning">画像同期リクエスト処理待ち</p>)}
      {isCatalogRefreshPending && (<p class="admin-notice admin-notice-warning">カタログ更新リクエスト処理待ち</p>)}
      <form class="admin-action-form" method="post" action="/admin/sync/request">
        <input type="hidden" name="kind" value="sync-now" />
        <button type="submit" class="admin-button admin-button-primary">今すぐ同期</button>
      </form>
      <form class="admin-action-form" method="post" action="/admin/catalog-refresh/request">
        <input type="hidden" name="kind" value="publish-catalog" />
        <button type="submit" class="admin-button admin-button-secondary">カタログを更新</button>
      </form>
      <p class="admin-meta">カタログ更新はアルバム一覧だけを更新し、画像の同期・アップロードは行いません。</p>
      <h2 class="admin-section-heading">直近の処理結果</h2>
      {syncResult === null ? (
        <p class="admin-notice admin-notice-empty">集計はまだ報告されていません</p>
      ) : (
        <div class="admin-table-scroll">
          <table class="admin-table">
            <tbody>
              <tr><th>処理</th><td>{syncOperationLabel(syncResult.operation)}</td></tr>
              <tr><th>実行契機</th><td>{syncResult.triggerKind === 'manual' ? '手動実行' : '定期実行'}</td></tr>
              <tr><th>結果</th><td>{syncResultLabel(syncResult.result)}</td></tr>
              <tr><th>開始日時</th><td>{syncResult.startedAt}</td></tr>
              <tr><th>完了日時</th><td>{syncResult.completedAt}</td></tr>
              <tr><th>対象</th><td>試行 {syncResult.targets.attempted} / 成功 {syncResult.targets.succeeded} / 失敗 {syncResult.targets.failed}</td></tr>
              <tr><th>写真</th><td>合計 {syncResult.photos.total} / 更新 {syncResult.photos.uploaded} / スキップ {syncResult.photos.skipped}</td></tr>
              <tr><th>カタログ</th><td>{syncResult.catalogRefreshed ? '更新済み' : '未更新'}</td></tr>
            </tbody>
          </table>
        </div>
      )}
      <h2 class="admin-section-heading">デーモン状態</h2>
      {syncStatus === null ? (
        <p class="admin-notice admin-notice-empty">未報告 (status not reported yet)</p>
      ) : (
        <>
          <p class="admin-meta">公開日時: {syncStatus.publishedAt}</p>
          <div class="admin-table-scroll">
            <table class="admin-table">
              <tbody>
                <tr><th>アルバムID</th><td>{syncStatus.albumId}</td></tr>
                <tr><th>同期間隔 (秒)</th><td>{syncStatus.intervalSeconds}</td></tr>
                <tr><th>開始日時</th><td>{syncStatus.startedAt}</td></tr>
                <tr><th>最終ハートビート</th><td>{syncStatus.heartbeatAt}</td></tr>
                <tr><th>最終試行開始</th><td>{syncStatus.lastAttemptStartedAt ?? '未実行'}</td></tr>
                <tr><th>最終試行完了</th><td>{syncStatus.lastAttemptCompletedAt ?? '未完了'}</td></tr>
                <tr><th>最終結果</th><td>{syncStatus.lastResult ?? '未実行'}</td></tr>
                <tr><th>最終エラー</th><td>{syncStatus.lastError ?? 'なし'}</td></tr>
                <tr><th>連続失敗回数</th><td>{syncStatus.consecutiveFailures}</td></tr>
                <tr><th>完了回数</th><td>{syncStatus.runsCompleted}</td></tr>
                <tr><th>トリガー種別</th><td>{triggerKindLabel(syncStatus.lastTriggerKind)}</td></tr>
                {syncStatus.lastHandledRequestId !== null && (
                  <tr><th>最終処理リクエストID</th><td>{syncStatus.lastHandledRequestId}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Layout>
  )
}

function categoryLabel(category: 'owned-active' | 'owned-disabled' | 'orphan'): string {
  if (category === 'owned-active') return '所有（有効）'
  if (category === 'owned-disabled') return '所有（無効）'
  return '孤立'
}

export function AdminR2CleanupPage({ report }: { report: AdminR2CleanupReport }) {
  const orphanCount = report.albums.filter((e) => e.category === 'orphan').length
  return (
    <Layout title="R2 クリーンアップレポート" area="admin">
      <a class="admin-back-link" href="/admin">
        ← 管理コンソールへ
      </a>
      <h1 class="admin-page-title">R2 クリーンアップレポート（ドライラン）</h1>
      <p class="admin-notice admin-notice-info">このレポートは読み取り専用です。R2 オブジェクトの削除は行いません。</p>
      {report.truncated ? (
        <p class="admin-notice admin-notice-warning">
          警告: オブジェクト数または取得ページ数が上限に達しました。結果が切り詰められています。
        </p>
      ) : null}
      <h2 class="admin-section-heading">アルバムプレフィックス</h2>
      {report.albums.length === 0 ? (
        <p class="admin-notice admin-notice-empty">アルバムプレフィックスがありません</p>
      ) : (
        <div class="admin-table-scroll">
          <table class="admin-table">
            <thead>
              <tr>
                <th>カテゴリ</th>
                <th>アルバムID</th>
                <th>オブジェクト数</th>
                <th>合計バイト数（概算）</th>
              </tr>
            </thead>
            <tbody>
              {report.albums.map((entry) => (
                <tr key={entry.albumId}>
                  <td>{categoryLabel(entry.category)}</td>
                  <td>{entry.albumId}</td>
                  <td>{entry.objectCount}</td>
                  <td>{entry.totalBytes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2 class="admin-section-heading">集計</h2>
      <div class="admin-table-scroll">
        <table class="admin-table">
          <tbody>
            <tr>
              <th>不正形式オブジェクト数</th>
              <td>{report.malformedCount}</td>
            </tr>
            <tr>
              <th>不正形式合計バイト数</th>
              <td>{report.malformedBytes}</td>
            </tr>
            <tr>
              <th>除外 ops/ オブジェクト数</th>
              <td>{report.excludedOpsCount}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {!report.truncated && orphanCount > 0 ? (
        <section class="admin-panel admin-danger-panel">
          <h2 class="admin-section-heading">孤立プレフィックス確認プレビュー（Phase 2）</h2>
          <p>
            孤立プレフィックスの確認プレビューを開始できます。実際の R2
            オブジェクト削除は行われません。サーバー側で再スキャンと候補セット検証のみ行います。
          </p>
          <form class="admin-action-form" method="post" action="/admin/r2-cleanup/confirm">
            <button type="submit" class="admin-button admin-button-danger">孤立プレフィックス確認プレビューを開始</button>
          </form>
        </section>
      ) : null}
    </Layout>
  )
}
