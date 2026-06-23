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

## Docker sync (ghcr.io/iniwa/photo-gate-sync)

| 日付 (JST) | GHCR タグ | コミット | Pi 稼働開始 | 備考 |
|---|---|---|---|---|
| 2026-06-11 | `0.1.6` | `ca6d16f` | 2026-06-12 | プレースホルダー fail-closed + `--photoprism-preview-size`。fit_1920 で 234 枚同期成功 |
| 2026-06-12 | `0.1.7` | `0403c46` | (スキップ) | cover.webp 生成。Pi では未稼働のまま 0.2.0 に置換 |
| 2026-06-12 | `0.2.0` | `5db4c8e` | 2026-06-15 | sync-daemon + HEALTHCHECK + 運用ログ。本番で 234/234 同期成功(R2 キー再発行後)。ただし httpx の INFO ログがプレビュートークンを露出する不具合あり → 0.2.1 で修正 |
| 2026-06-15 | `0.2.1` | (sync-v0.2.1) | (確認 2026-06-23) | ログ漏えい修正: ルートロガーを WARNING に戻し photo_gate.* のみ INFO。Portainer で稼働中 |

公開済みだが Pi で稼働しなかったタグ: `0.1.0`〜`0.1.2`(初期イテレー
ション)、`0.1.3`/`0.1.4` は CI ゲートで失敗したため未公開(欠番)、
`0.1.5` は trixie 移行版(0.1.6 で即置換)。
