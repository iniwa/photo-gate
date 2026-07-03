# E2E Security Smoke Report (2026-07-03)

実施日時: 2026-07-03 01:34-01:36 UTC  
対象: `https://share-photo.iniwach.com`  
対象 Worker: commit `0864043`, version `940fd57d-6836-4875-97f5-cbb14f586356`

## 1. 変更ファイル

| ファイル | 変更種別 |
|---|---|
| `docs/handoffs/2026-07-03-e2e-security-smoke-report.md` | 新規作成 |
| `docs/fable/current-state.md` | Verification Baseline に非認証 smoke 結果を追記 |
| `docs/fable/progress.md` | Next Priority を Final Hardening 進捗状態に更新 |

コード変更はありません。

## 2. 非認証 smoke 結果

curl による read-only HTTP 確認を実施しました。Cookie、認証ヘッダー、secret は使用していません。

| # | リクエスト | 期待値 | 実結果 | 判定 |
|---|---|---|---|---|
| S-1 | `GET /` | 200、ログインページ | 200、`Cache-Control: private, no-cache` | 合格 |
| S-2 | `GET /albums` | 303 -> `/`、`no-store` | 303、`Location: /`、`Cache-Control: no-store` | 合格 |
| S-3 | `GET /img/probe-album/preview/probe-photo` | 401、`no-store` | 401、`Cache-Control: no-store` | 合格 |
| S-4 | `GET /download/probe-album/preview/probe-photo` | 401、`no-store` | 401、`Cache-Control: no-store` | 合格 |
| S-5 | `GET /albums/probe-album/photos/probe-photo` | 303 -> `/`、`no-store` | 303、`Location: /`、`Cache-Control: no-store` | 合格 |
| S-6 | `GET /api/probe` | 401、`no-store` | 401、`Cache-Control: no-store` | 合格 |
| S-7 | `GET /admin` | Cloudflare Access 302 intercept | 302、`Www-Authenticate: Cloudflare-Access` | 合格 |
| S-8 | `GET /admin/r2-cleanup` | Cloudflare Access 302 intercept | 302、`Www-Authenticate: Cloudflare-Access` | 合格 |

S-7 / S-8 は Cloudflare Access が Worker 到達前に intercept していることを確認しました。

## 3. 認証済みオペレーターブラウザ確認チェックリスト

エージェント環境から Cloudflare Access の認証済みブラウザセッションを使えないため、以下はオペレーターがブラウザで確認しました。破壊的操作は実施していません。

- [x] A. `/admin` が管理コンソールを返し、secret、token、R2 key、PhotoPrism UID、bucket 名が画面に表示されない。
- [x] B. `/admin/users` が読み取り可能なユーザー一覧を返す。
- [x] C. `/admin/albums` がアルバム一覧と catalog picker を返す。
- [x] D. `/admin/permissions` が権限一覧と安全な dropdown UI を返す。
- [x] E. `/admin/sync` が sanitized sync status を表示し、R2 key、URL、token、PhotoPrism UID を表示しない。
- [x] F. `/admin/r2-cleanup` が dry-run 表示のみで、実削除ボタンや実削除フォームを表示しない。full R2 key、bucket credential、PhotoPrism UID/URL/token を表示しない。
- [x] G. hard-delete preview controls が admin 認証下でのみ表示され、二段階確認フローであることを確認する。最終 submit は押さない。
- [x] H. 認証済み viewer で album list、album detail grid、photo preview page、preview JPEG download が動作する。
- [x] I. disabled album や unauthorized viewer の拒否確認は、実データ変更が必要なため今回は実施しない。必要なら別途非破壊の検証データを用意する。

## 4. セキュリティ・プライバシー観察

### 4.1 セキュリティヘッダー

確認したレスポンスでは以下のヘッダーが一貫して適用されています。

| ヘッダー | 値 |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'` |
| `Referrer-Policy` | `same-origin` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |

### 4.2 Cache-Control

| ルート種別 | Cache-Control | 評価 |
|---|---|---|
| `/` | `private, no-cache` | 適切 |
| 保護リソース 401 | `no-store` | 適切 |
| 未認証 viewer redirect 303 | `no-store` | 適切 |
| Cloudflare Access 302 | Cloudflare Access 側の no-store/no-cache 系ヘッダー | 適切 |

### 4.3 機密情報の露出

非認証レスポンスに secret、R2 key、PhotoPrism UID、bucket credential、token、stack trace、SQL は含まれていませんでした。

## 5. スキップ・保留チェック

| チェック | 理由 |
|---|---|
| 認証済みブラウザ確認 | 2026-07-03 にオペレーターが §3 A-I を確認済み |
| disabled album / unauthorized viewer の実地拒否確認 | 実ユーザーまたは実アルバムの状態変更が必要なため、非破壊 smoke では実施しない |
| `wrangler secret list` | ローカルトークンは D1 権限のみ。過去に必要 secret 登録は確認済み |

## 6. Fable ドキュメント更新

- `docs/fable/current-state.md`: Verification Baseline に非認証 smoke 8 件合格を追記。
- `docs/fable/progress.md`: Final Hardening の進捗を更新し、認証済みブラウザ確認完了を記録。
- `docs/fable/roadmap.md`: E2E authorization/privacy review と Final Hardening 完了状態を記録。

## 7. 検証結果

- `git diff --check`: 差分エラーなし。`current-state.md` の CRLF warning のみ。
- `git diff HEAD -- workers/`: 差分なし。
- `git diff HEAD -- docker/`: 差分なし。
- `git diff HEAD -- workers/migrations/`: 差分なし。
- `git diff HEAD -- .github/workflows/`: 差分なし。

## 8. 変更していない領域

`workers/`, `docker/`, `workers/migrations/`, `.github/workflows/`, `docs/decisions/`, `docs/operations/` は変更していません。R2/D1/Cloudflare/GitHub/GHCR/Portainer/PhotoPrism/NAS への変更もありません。

## 9. 今後の推奨

1. Level 3 完了宣言を Fable docs に記録する。
2. `ci-hardening` と `deploy-log-backfill` は Level 3 後の別フェーズで扱う。

## 10. Codex 判断

非認証 E2E smoke は合格です。認証済み browser smoke もオペレーター確認済みです。Definition of Done の "Final end-to-end privacy and authorization review passes" を満たしたと判断します。
