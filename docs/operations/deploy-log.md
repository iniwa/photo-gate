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

## Workers (photo-gate.iniwaiwana.workers.dev)

| 日付 (JST) | バージョン ID | コミット | 方法 | 備考 |
|---|---|---|---|---|
| 2026-06-11 | `70f9fc60` | (Level 1 初回) | 手動 `wrangler deploy` | 初回本番デプロイ、cron 有効 |
| 2026-06-12 | `131a0632` | `94f2e7d` 相当 | 手動 `wrangler deploy` | Referrer-Policy: same-origin 修正(ブラウザログイン 403 解消) |
| 2026-06-12 | (未記録)| `c884256` | CI (workers-ci) | CI 自動デプロイの初観測。deploy ジョブ全ステップ実行・スモーク良好。バージョン ID はトークン復旧後に `wrangler deployments list` で補記 |
| 2026-06-19 | `01c96d15-5565-451f-98ba-f1071decfbcc` | `729dc72` | CI (workers-ci) | 管理アルバム有効化/無効化。checks/deploy 成功、未認証 GET/enable/disable は 403 no-store |

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
