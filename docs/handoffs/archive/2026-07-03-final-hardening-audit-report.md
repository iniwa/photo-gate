# Final Hardening Audit Report

作成日: 2026-07-03  
対象ブランチ: `main`  
対象本番 Worker: commit `0864043`, version `940fd57d-6836-4875-97f5-cbb14f586356`

## 1. 変更ファイル

| ファイル | 種別 | 内容 |
|---|---|---|
| `docs/handoffs/2026-07-03-final-hardening-audit-report.md` | 新規 | 本監査レポート |
| `docs/fable/roadmap.md` | 修正 | 管理機能 item 6 を `[x]` に更新 |
| `docs/fable/current-state.md` | 修正 | アルバム削除完了と E2E 非認証 smoke 結果を追記 |
| `docs/fable/progress.md` | 修正 | Next Priority を Final Hardening 中心に更新 |
| `docs/operations/operator-actions.md` | 修正 | 現行運用向けに全面書き直し |
| `docs/operations/rollback.md` | 修正 | Worker secret 確認対象を 3 件から 5 件に更新 |

コード変更はありません。`workers/`, `docker/`, `workers/migrations/`, `.github/workflows/` には差分がありません。

## 2. 監査範囲

以下を確認しました。

- `AGENTS.md`, `FABLE.md`
- `docs/fable/project-context.md`
- `docs/fable/current-state.md`
- `docs/fable/roadmap.md`
- `docs/fable/progress.md`
- `docs/fable/definition-of-done.md`
- `docs/fable/autonomy-contract.md`
- `docs/operations/*.md`
- `.github/workflows/workers-ci.yml`
- `.github/workflows/docker-ci.yml`
- `workers/package.json`
- `workers/wrangler.toml`
- `docker/pyproject.toml`
- `docker/Dockerfile`

## 3. Final Hardening 状態表

| 項目 | 状態 | 根拠 |
|---|---|---|
| Cloudflare Access + Worker JWT 検証 | 完了 | 管理画面は Access 配下、Worker 側 allowlist 検証済み |
| 管理機能 | 完了 | user / album / permission / sync / ops / cleanup / hard delete が実装・デプロイ済み |
| R2 cleanup ADR | 完了 | `docs/decisions/2026-06-30-r2-cleanup-dry-run.md` |
| R2 cleanup dry-run | 完了 | `/admin/r2-cleanup` デプロイ済み |
| R2 cleanup deletion preview | 完了 | HMAC 確認 preview 実装済み、実削除は disabled |
| 実 R2 削除 | 意図的に未実装 | 明示的人間承認まで禁止 |
| operator docs | 完了 | `operator-actions.md` を現行状態に書き直し、`rollback.md` を更新 |
| E2E 非認証 security smoke | 完了 | 2026-07-03 に 8 件合格 |
| E2E 認証済み browser smoke | 未完了 | オペレーターのブラウザ確認待ち |
| CI supply-chain hardening | 後続 | SHA pinning 等は Level 3 後の別フェーズ |
| deploy-log pending backfill | 後続 | 古い pending version ID の補記は別作業 |

## 4. 所見

### F-1: operator-actions.md が古く、現行運用と乖離していた [MEDIUM]

旧文書は Docker `0.2.1` 時点の内容で、`0.4.2`、browser-complete sync、HMAC secret、hard delete、R2 cleanup preview を反映していませんでした。

対応: `docs/operations/operator-actions.md` を現行運用向けに全面書き直しました。

### F-2: E2E 認証済み browser smoke が未完了 [MEDIUM]

非認証 smoke は合格しましたが、Cloudflare Access 配下の管理画面と認証済み viewer のブラウザ確認はオペレーター作業が必要です。

対応: `docs/handoffs/2026-07-03-e2e-security-smoke-report.md` にチェックリストを記録しました。

### F-3: GitHub Actions の SHA pinning は未実施 [LOW]

`actions/checkout@v4` などタグ参照が残っています。権限スコープは大きな問題なしですが、supply-chain hardening として後続フェーズで扱う価値があります。

対応: Level 3 完了前の必須条件にはせず、後続 `ci-hardening` として推奨します。

### F-4: deploy-log に pending version ID が残っている [LOW]

一部の過去デプロイ行に Worker version ID が pending のまま残っています。

対応: rollback 実務上の最新 version ID は記録済みです。過去分の補記は後続 `deploy-log-backfill` とします。

## 5. 推奨次期ハンドオフ

| 優先 | ハンドオフ案 | 内容 |
|---|---|---|
| 1 | authenticated-browser-smoke | オペレーターによる認証済み browser smoke の記録 |
| 2 | level-3-completion-record | DoD 最終確認と Level 3 完了宣言 |
| 3 | ci-hardening | GitHub Actions SHA pinning、Docker base image pinning 検討 |
| 4 | deploy-log-backfill | 過去 pending version ID の補記 |

## 6. 検証結果

- `git diff --check`: 差分エラーなし。`current-state.md` の CRLF warning のみ。
- `git diff HEAD -- workers/`: 差分なし。
- `git diff HEAD -- docker/`: 差分なし。
- `git diff HEAD -- workers/migrations/`: 差分なし。
- `git diff HEAD -- .github/workflows/`: 差分なし。
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities。

## 7. スキップ・保留チェック

| チェック | 理由 |
|---|---|
| 認証済み browser smoke | Cloudflare Access を通過するオペレーターのブラウザ操作が必要 |
| 実 R2 deletion | 明示的人間承認まで禁止 |
| CI SHA pinning | 本 handoff の scope 外 |
| deploy-log pending backfill | Workers Scripts Edit 権限または Cloudflare dashboard 確認が必要 |

## 8. 変更していない領域

`workers/`, `docker/`, `workers/migrations/`, `.github/workflows/`, `docs/decisions/`, `docs/iniwa-issues.md` は変更していません。R2/D1/Cloudflare/GitHub/GHCR/Portainer/PhotoPrism/NAS への変更もありません。

## 9. Codex 判断

- operator docs rewrite は完了扱いでよいです。
- E2E は非認証 smoke 完了、認証済み browser smoke はオペレーター作業待ちです。
- 認証済み browser smoke が合格し、Fable に記録されれば Level 3 完了宣言に進めます。
- `ci-hardening` は Level 3 後の別フェーズで扱います。
