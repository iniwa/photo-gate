# デプロイ記録 (Deploy Log)

本番環境に「何が・いつ・どのコミットから」デプロイされたかの記録です。
ロールバック時はこの表で直前の正常版を特定し、`rollback.md` の手順で
戻します。

運用ルール:

- Workers をデプロイしたら(手動・CI とも)1 行追加する。
  バージョン ID は `wrangler deploy` / CI ログの
  `Current Version ID:` 行から取る。
- Docker sync は GHCR にタグが公開された時点と、Portainer スタックの
  イメージタグを実際に切り替えた時点の両方を記録する。
- 値はすべて非シークレット(バージョン ID・タグ・コミット SHA のみ)。
  ユーザー ID・アルバム ID・トークン類は書かないこと。

## Workers (share-photo.iniwach.com)

| 日付 (JST) | バージョン ID | コミット | 方法 | 備考 |
|---|---|---|---|---|
| 2026-06-11 | `70f9fc60` | (Level 1 初回) | 手動 `wrangler deploy` | 初回本番デプロイ、cron 有効 |
| 2026-06-12 | `131a0632` | `94f2e7d` 相当 | 手動 `wrangler deploy` | Referrer-Policy: same-origin 修正(ブラウザログイン 403 解消) |
| 2026-06-12 | (未記録)| `c884256` | CI (workers-ci) | CI 自動デプロイの初観測。deploy ジョブ全ステップ実行・スモーク良好。バージョン ID はトークン復旧後に `wrangler deployments list` で補記 |
| 2026-06-19 | `01c96d15-5565-451f-98ba-f1071decfbcc` | `729dc72` | CI (workers-ci) | 管理アルバム有効化/無効化。checks/deploy 成功、未認証 GET/enable/disable は 403 no-store |
| 2026-06-23 | `0fa7821a-850f-46d5-bddb-7f2a8c6d009a` | `42a7b56` | CI (workers-ci 再実行) | 管理ユーザー有効化/無効化。Cloudflare token/account 修正後 checks/deploy 成功、未認証 GET/enable/disable は 403 no-store |
| 2026-06-23 | `0fa7821a-850f-46d5-bddb-7f2a8c6d009a` | `42a7b56` | `wrangler rollback` (OAuth) | ロールバック検証。スモーク全 5 項目合格 |
| 2026-06-23 | `495c9ae6-3cf5-4a04-a8f0-d93017468811` | `42a7b56` 相当 | `wrangler rollback` (OAuth) | ロールバック検証後リストア。スモーク全 5 項目合格。その後シークレット復旧版に更新 |
| 2026-06-23 | `08e567cf-76a8-4151-8f76-d92783b73af0` | `42a7b56` 相当 | Dashboard / `wrangler secret put` | ロールバックで消失した Access シークレット 3 件を復旧。AUD をダッシュボード値で再登録し、管理コンソール復旧確認済み。本番はこの版で稼働中 |
| 2026-06-26 | `b30250aa-0289-4758-b1fe-3376beba0afe` | `a1a5c2e` | 手動 `wrangler deploy` (OAuth) | Worker 側の手動同期機能(request writer, status schema 2 rendering, admin sync UI)を本番デプロイ。Docker daemon consumer は未リリース。未認証スモーク全 5 項目合格。/admin/sync 認証済みブラウザ確認済み(ステータスページ + manual sync ボタン表示) |
| 2026-06-26 | `3c4d4f8e-e13f-4ebd-8ab0-213639b7f90b` | `cd990ae` | 手動 `wrangler deploy` (OAuth) | 管理ブラウザ機能追加を本番デプロイ。ユーザー表示名編集、権限割当ドロップダウン、D1-only アルバム作成 (`enabled=0`, `photoprism_album_uid` create-only) を含む。未認証スモーク 5 項目合格。 |
| 2026-06-29 | `b1874993-7876-4120-a6cf-fe03c44ad4eb` | `de74227` | `wrangler deploy` (OAuth, verified from deployments list) | A1-A3 Worker side deployed: browser-owned sync-target routes and `/admin/albums` catalog picker. Unauthenticated smoke passed: `/` 200, `/albums` 303 to `/`, `/img/probe-nonexistent` 401 no-store, `/api/probe` 401 no-store, `/admin` Cloudflare Access 302. Authenticated `/admin/albums` picker check passed after catalog publication on Docker `0.4.1`; picker shows real PhotoPrism albums only after catalog type-filter hotfix. |
| 2026-06-30 | (pending — CI run `28415678789`) | `b3c434c` | CI (workers-ci) | R2 cleanup dry-run report (`GET /admin/r2-cleanup`). CI checks + deploy both concluded `success` (run `28415678789`). Version ID not retrievable without admin-scoped log access or re-authenticated wrangler. Unauthenticated smoke: `/` 200, `/albums` 303 to `/`, `/img/probe-nonexistent` 401 no-store, `/api/probe` 401 no-store, `/admin` and `/admin/r2-cleanup` intercepted by Cloudflare Access (302). Authenticated browser check passed: `/admin` link visible, dry-run report renders, no delete form/button, and no full R2 keys, photo IDs, bucket name, PhotoPrism UID/URL/token, or credentials visible. |
| 2026-06-30 | (pending - CI/deploy metadata not retrieved) | `d57ba95` | CI (workers-ci after operator push) | R2 cleanup deletion-preview Phase 2. Adds HMAC-signed confirmation preview routes (`POST /admin/r2-cleanup/confirm`, `POST /admin/r2-cleanup/delete`) while actual R2 deletion remains disabled. Operator registered `R2_CLEANUP_HMAC_KEY`. Authenticated `/admin/r2-cleanup` check found no orphan prefixes, so the preview form was hidden as expected; delete preview flow was not exercised because there were no candidates. No R2/D1 mutation. |
| 2026-06-30 | (pending - CI/deploy metadata not retrieved) | `c9409c1` | CI (workers-ci) | Preview JPEG download route (`GET /download/:albumId/preview/:photoId`). Serves only existing generated private R2 preview JPEGs as attachments, gated by session, album permission, manifest membership, and `download_enabled`. Unauthenticated production smoke confirmed `/download/probe-album/preview/probe-photo` returns 401 no-store. |
| 2026-06-30 | (pending - CI/deploy metadata not retrieved) | `84bcbcf` | CI (workers-ci) | Manifest schema 2 Worker hotfix. Workers now accept Docker `0.4.2` manifests with per-photo `sourceHash` while keeping `sourceHash` non-rendered and non-exposed. This fixed album detail 500s after Docker `0.4.2` published schema 2 manifests. |
| 2026-06-30 | (pending - CI run `28427318471`) | `8ef26a4` | CI (workers-ci) | Preview download filename hotfix. Attachment filenames now include the manifest photo ID (`<safe-title>_<photoId>.jpg` or `<photoId>.jpg`) to avoid browser `(1)` duplicate suffixes for common/empty titles. Unauthenticated production smoke passed. |
| 2026-06-30 | (pending - CI run `28428506984`) | `797682e` | CI (workers-ci) | Viewer photo preview page (`GET /albums/:albumId/photos/:photoId`). Album grid thumbnails now open an authenticated HTML preview page with existing `/img` preview embedding, previous/next navigation, back-to-album link, and conditional download link. CI run `28428506984` succeeded. Unauthenticated smoke passed: `/`, `/albums`, `/img`, `/download`, and the new preview page redirect-to-login behavior. |

| 2026-07-02 | (pending - CI run `28558926039`) | `2b0941f` | CI (workers-ci) | Viewer UI cleanup Phase 1. Improves server-rendered viewer presentation for login, album list, album detail grid, photo preview page, and shared viewer controls without changing routes, auth, D1, R2, manifest parsing, image responses, or download responses. CI run `28558926039` succeeded. Unauthenticated smoke passed: `/` 200, `/albums` 303 to `/`, `/img/probe-nonexistent` 401 no-store, `/download/probe-album/preview/probe-photo` 401 no-store, `/albums/probe-album/photos/probe-photo` 303 to `/`, and `/admin` Cloudflare Access 302. |

## Docker sync (ghcr.io/iniwa/photo-gate-sync)

| 日付 (JST) | GHCR タグ | コミット | Pi 稼働開始 | 備考 |
|---|---|---|---|---|
| 2026-06-11 | `0.1.6` | `ca6d16f` | 2026-06-12 | プレースホルダー fail-closed + `--photoprism-preview-size`。fit_1920 で 234 枚同期成功 |
| 2026-06-12 | `0.1.7` | `0403c46` | (スキップ) | cover.webp 生成。Pi では未稼働のまま 0.2.0 に置換 |
| 2026-06-12 | `0.2.0` | `5db4c8e` | 2026-06-15 | sync-daemon + HEALTHCHECK + 運用ログ。本番で 234/234 同期成功(R2 キー再発行後)。ただし httpx の INFO ログがプレビュートークンを露出する不具合あり → 0.2.1 で修正 |
| 2026-06-15 | `0.2.1` | (sync-v0.2.1) | (確認 2026-06-23) | ログ漏えい修正: ルートロガーを WARNING に戻し photo_gate.* のみ INFO。Portainer で稼働中 |
| 2026-06-26 | `0.3.0` | `c225cd8` / `sync-v0.3.0` | 2026-06-26 | 手動同期リリース。Portainer を 0.3.0 に更新し、/admin/sync から手動同期を実行。daemon が request を消費し、234/234 sync、cover + manifest upload、attempt 1 succeeded in 136.5s。/admin/sync は pending なし・failures 0・runsCompleted 1・manual trigger・handled request ID 非 null を確認 |
| 2026-06-29 | `0.4.0` | `2c17c83` / `sync-v0.4.0` | 2026-06-29 (superseded) | A1-A3 browser-complete sync release. docker-ci run `28350063100` succeeded: host tests, container-test, and release all passed. GHCR published `ghcr.io/iniwa/photo-gate-sync:0.4.0` and `ghcr.io/iniwa/photo-gate-sync:sha-2c17c83` for linux/amd64 and linux/arm64. Portainer update exposed that PhotoPrism non-album groupings appeared in the catalog picker; superseded by `0.4.1` before final live smoke closure. |
| 2026-06-29 | `0.4.1` | `61d0278` / `sync-v0.4.1` | 2026-06-29 | Catalog type-filter hotfix. docker-ci run `28353237481` succeeded: host tests, container-test, and release all passed. GHCR published `0.4.1` and `sha-61d0278` for linux/amd64 and linux/arm64. Portainer updated to `0.4.1`; operator ran `photo-gate-sync publish-catalog`; `/admin/albums` picker now lists real PhotoPrism albums only instead of folders/location/date groupings. |
| 2026-06-30 | `0.4.2` | `fb57196` / `sync-v0.4.2` | 2026-06-30 | Reupload suppression release. `main` and `sync-v0.4.2` are pushed to Gitea at `fb57196`; operator reports Docker deploy and Portainer stack update to `0.4.2` are complete. Docker sync now emits manifest `schemaVersion: 2` with per-photo `sourceHash` and can skip unchanged thumb/preview pairs on subsequent syncs while still uploading cover and manifest. Live two-run skip smoke passed: the unchanged follow-up sync skipped 256/256 photo thumb/preview pairs across two targets, still uploaded covers and manifests, and the sync attempt succeeded. |

公開済みだが Pi で稼働しなかったタグ: `0.1.0`〜`0.1.2`(初期イテレー
ション)、`0.1.3`/`0.1.4` は CI ゲートで失敗したため未公開(欠番)、
`0.1.5` は trixie 移行版(0.1.6 で即置換)。
