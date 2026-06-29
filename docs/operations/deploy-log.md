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

公開済みだが Pi で稼働しなかったタグ: `0.1.0`〜`0.1.2`(初期イテレー
ション)、`0.1.3`/`0.1.4` は CI ゲートで失敗したため未公開(欠番)、
`0.1.5` は trixie 移行版(0.1.6 で即置換)。
