# Workers UI と認証基盤の設計決定

## 1. Status and Date

- **Status:** Accepted
- **Date:** 2026-06-09
- **Scope:** Phase 2（Workers閲覧ページ）および Phase 3（認証・権限）実装前の設計確定

### Evidence Classification

- **Verified fact:** official Cloudflare or Hono documentation confirms the platform behavior. These claims are cited in Section 14.
- **Project decision:** the architecture selected for photo-gate based on its private-R2 and album-authorization constraints.
- **Assumption/open question:** requires measurement, operator input, or a later implementation decision and is listed in Section 13.

---

## 2. Context and Constraints

### 現状

Phase 1 の Docker 同期 CLI が完成し、`manifest.json`・thumb/preview を非公開 R2 バケットに格納できる状態になった。次のステップは Workers による閲覧サーフェスの構築である。

### 固定制約（AGENTS.md より）

- R2 バケットは非公開を維持する。画像は Workers 経由でのみ返す
- 共有ユーザーは PhotoPrism / NAS に直接アクセスしない
- 認証だけでは不十分。アルバム単位の認可がすべての経路で必須
- Workers は画像処理を行わない
- 通常閲覧は Workers + D1 + 非公開 R2 で完結させる
- 認証されていない Phase 実装が実 R2 データを返すことは許容しない

### 未決定だった事項（本決定で確定）

- Workers UI 実装方式（plain HTML / Hono + JSX / Workers Assets + SPA）
- 管理者認証方式（Cloudflare Access / Worker 独自ログイン）
- Phase 2 を認証なしで安全に実装する方法

---

## 3. Threat Model

本アプリケーションが守るべき対象とリスク。

| リスク | 対策 |
|---|---|
| 未認証ユーザーが R2 の写真を取得 | Workers の全画像・manifest エンドポイントでセッション検証 + アルバム権限確認を必須とする |
| 共有ユーザーが他ユーザーのアルバムを閲覧 | D1 の `album_permissions` を毎リクエストで参照し、アルバム単位で認可する |
| GPS 等の位置情報漏洩 | R2 に配置するのは Docker 側で EXIF 削除・検証済みの thumb/preview のみ（Phase 1 で実装済み） |
| パスワード漏洩 | PBKDF2-SHA256 によるハッシュ化。平文・可逆暗号は使わない |
| セッション窃取 | HttpOnly + Secure + SameSite=Strict Cookie。セッション ID はランダム 32 バイト。ログイン後にセッション ID を再生成 |
| CSRF | SameSite=Strict Cookie + 状態変更リクエストへの CSRF トークン |
| ブルートフォース | ログイン失敗を D1 に記録し、N 回失敗でアカウントをロック。Cloudflare の Rate Limiting も活用可能 |
| ユーザー列挙 | 不明ユーザーでも PBKDF2 をダミー実行し、一定時間を消費する（タイミング攻撃対策） |
| アルバム ID インジェクション | R2 キー構築前に厳格な正規表現でアルバム ID・写真 ID を検証する |
| Admin エンドポイント不正アクセス | Cloudflare Access の JWT 検証 + Workers 側のロールチェック |

---

## 4. Options Considered

### UI 実装方式

#### A. Plain HTML / tagged template literals（フレームワークなし）

- 追加依存なし。Wrangler だけで動く
- 複雑なレイアウトはコードが煩雑になる
- コンポーネント再利用が手動

#### B. Hono + JSX（**採用**）

- Wrangler が TypeScript + JSX を自動トランスパイル。追加ビルドステップ不要
- `c.html()` でサーバーサイド HTML を返す。async コンポーネント対応
- Hono の`hono/jsx` は React 互換の JSX を Workers ランタイムで動作させる（2026-06-09 公式ドキュメント確認済み）
- ルーティング・ミドルウェア・型付き環境変数が揃っており、小規模プライベートアプリに適合する
- SPA 不要。クライアントサイド JS は最小限に抑えられる

#### C. Workers Assets + SPA（React/Vue/Svelte）

- 独立したフロントエンドビルドパイプラインが必要
- 静的アセットを Workers Assets で配信し、API は Workers で実装する
- 小規模プライベートアプリとして複雑度が過剰
- クライアントサイド認証ロジックが混入するリスクがある

### 管理者認証

#### A. Cloudflare Access for /admin（**採用**）

- Access は `/admin` パス向けの独立したアプリケーションとして設定できる（公式ドキュメント確認済み）
- 認証成功後、Access は `CF-Access-Jwt-Assertion` ヘッダーに JWT を注入する
- Workers 側でこの JWT を検証し、管理者メールアドレスの allowlist と照合する
- ブルートフォース対策・2FA・セッション管理を Cloudflare に委譲できる
- 共有ユーザーのログインとは完全に分離できる

#### B. Worker 独自ログイン for /admin

- 共有ユーザーと同じ仕組みで管理者も管理できる
- しかし管理者向け追加セキュリティ（2FA 等）の実装が重複する
- Cloudflare Access を既に使える環境では非効率

#### C. 両方組み合わせ

- 管理者は Cloudflare Access で認証し、Workers 側でも D1 のロールを確認する（二重確認）
- これが最も堅固だが、Workers 側確認は Access JWT 検証後のロールチェックで十分

### 共有ユーザー認証

#### A. D1 バックドの Workers ログイン（**採用**）

- Worker が `/api/login` で POST を受け取り、D1 の `users` テーブルと照合
- パスワードは PBKDF2-SHA256（100,000+ iterations）でハッシュ化（Web Crypto API で実装可能、2026-06-09 確認済み）
- セッションは D1 の `sessions` テーブルで管理
- Cloudflare Access は閲覧者ログインには不向き（Access は管理されたユーザー向け）

#### B. Cloudflare Access for 閲覧者

- 家族・友人など非技術者向けに Cloudflare One ユーザーを作成する必要がある
- ゲスト招待の運用が複雑
- アルバム単位の権限管理を Access ポリシーで表現するのが難しい

---

## 5. Decision

| 項目 | 決定 |
|---|---|
| UI 実装方式 | **Hono + JSX（サーバーサイドレンダリング）** |
| 静的アセット | Workers Assets（CSS / 最小限の JS）。同一 Worker で配信 |
| 共有ユーザー認証 | **D1 バックドの Workers ログイン（PBKDF2-SHA256）** |
| セッション管理 | **D1 sessions テーブル + 不透明な高エントロピー Cookie。D1 にはトークンの SHA-256 ダイジェストのみ保存** |
| 管理者認証 | **Cloudflare Access（/admin パス）+ Workers 側 JWT 検証 + allowlist** |
| Phase 2 安全方針 | **フィクスチャデータのみ。R2/D1 読み取りは Phase 3 まで実装しない** |

---

## 6. Phase 2 and Phase 3 Boundary

### Phase 2 で実装してよいもの（安全な範囲）

- `workers/` ディレクトリの初期化（`package.json`、`wrangler.toml`、`tsconfig.json`）
- Hono のインストールと基本ルーティング設定
- HTML レイアウト・ページコンポーネント（Hono JSX）
- **フィクスチャデータのみを使ったアルバム一覧・写真一覧の HTML レンダリング**
- 静的 CSS / JS アセットの Workers Assets 配信設定
- セキュリティヘッダーミドルウェア（CSP、X-Content-Type-Options 等）
- `/api/login` エンドポイントのルート定義（**実装は Phase 3**）
- 型定義（`types/album.ts`、`types/manifest.ts` 等）

### Phase 2 で実装してはいけないもの

- R2 バインディングからの実データ読み取り
- D1 バインディングへのクエリ（fixtures の代わりに実データを返すこと）
- セッション検証なしでの実アルバム・manifest・画像の配信
- 本物の認証フロー（これは Phase 3）

### Phase 3 で追加するもの

- D1 スキーマ（`users`、`sessions`、`albums`、`album_permissions`）
- `/api/login`・`/api/logout`・`/api/me` の完全実装
- 全 manifest・画像エンドポイントへのセッション検証とアルバム権限チェックの組み込み
- Phase 2 のフィクスチャ参照を実 D1/R2 参照に置き換え

**Phase 2 と Phase 3 の境界原則：** 「フィクスチャデータを返すルートは存在してよいが、実 R2 データを返すルートが認証・認可なしで存在してはならない。」

---

## 7. Recommended Route / Authentication Flow

### 共有ユーザーログインフロー

```text
POST /api/login
  1. リクエストボディから username / password を取得
  2. D1: SELECT FROM users WHERE id = ? AND enabled = 1
  3. ユーザーが存在しない場合でも PBKDF2 をダミー実行（タイミング攻撃対策）
  4. PBKDF2-SHA256 で入力パスワードをハッシュ化し、D1 の password_hash と定数時間比較
  5. 失敗: D1 の fail_count を加算。閾値超過でアカウントロック。401 を返す
  6. 成功: 旧セッションを D1 から削除（セッション固定化攻撃対策）
  7. crypto.getRandomValues() で 32 バイトの不透明なセッショントークンを生成
  8. D1 の sessions テーブルに SHA-256(token) と expires_at を INSERT。生トークンは保存しない
  9. Set-Cookie: session=<opaque-token>; HttpOnly; Secure; SameSite=Strict; Path=/
  10. 200 を返す
```

### 画像・manifest 配信フロー

```text
GET /img/:albumId/thumb/:photoId
  1. Cookie からセッショントークンを取得
  2. Cookie のトークンを SHA-256 でダイジェスト化
  3. D1 の sessions テーブルで token_hash を確認（存在・有効期限）。なければ 401
  4. D1 の album_permissions で user_id と album_id の組み合わせを確認。なければ 403
  5. アルバム ID・写真 ID を正規表現で検証（r2_store.py の _ALLOWED_KEY と同等）
  6. R2 キー `albums/{albumId}/thumbs/{photoId}.webp` を構築
  7. env.PHOTO_BUCKET.get(key) で R2 から取得。null なら 404
  8. Content-Type: image/webp、Cache-Control: private, no-store を設定して返す。R2 の保存メタデータにある public キャッシュ指定は転送しない
```

### 管理者認証フロー

```text
GET /admin/* (Cloudflare Access がすべてのリクエストをインターセプト)
  1. Cloudflare Access が認証していれば CF-Access-Jwt-Assertion ヘッダーを付与
  2. Workers ミドルウェアがこの JWT を検証（JWKS エンドポイントまたは env.CF_ACCESS_AUD）
  3. JWT の claims から email を取得し、env.ADMIN_EMAILS allowlist と照合
  4. 不一致なら 403。一致すれば /admin ハンドラへ続行
```

### Cookie 属性（必須）

```text
HttpOnly   — JavaScript から読み取り不可（XSS 対策）
Secure     — HTTPS 経由のみ送信
SameSite=Strict — CSRF 対策
Path=/     — アプリケーション全体に適用
Max-Age=<expires> — セッション有効期限と一致させる
```

---

## 8. Recommended D1 Model

設計書 Section 9 の schema を基本とし、`sessions` テーブルを追加する。

### users（設計書 9.1 から変更なし）

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  fail_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**変更点：** `fail_count`、`locked_until` を追加（ブルートフォース対策）。

### sessions（新規）

```sql
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
```

- 生のセッショントークンは `crypto.getRandomValues()` で 32 バイト生成し、Cookie にだけ保持する
- D1 には `SHA-256(token)` のダイジェストだけを `token_hash` として保存する
- `expires_at` はログイン時に設定（例：7日後）
- セッションローテーション：長期セッションの定期的な再発行は Phase 3 実装時に要検討
- 期限切れセッションの定期削除：Cron Triggers（Phase 5 以降）か、ログイン時のクリーンアップ

### albums（設計書 9.2 から変更なし）

設計書 Section 9.2 の定義を採用。Phase 3 のマイグレーションで作成。

### album_permissions（設計書 9.3 から変更なし）

設計書 Section 9.3 の定義を採用。

### sync_jobs（設計書 9.4）

Phase 4（管理画面）まで延期。Phase 3 では不要。

### Phase 3 最小マイグレーション構成

```text
0001_users_sessions.sql   — users + sessions テーブル
0002_albums_permissions.sql — albums + album_permissions テーブル
```

---

## 9. R2 / Manifest Access Rules

### R2 オブジェクト取得

```typescript
// Workers のみが R2 バインディングを持つ。公開 URL は使わない
const object = await env.PHOTO_BUCKET.get(key);
if (object === null) {
  return new Response("Not Found", { status: 404 });
}
```

### キー構築前の検証（TypeScript で実装）

- `albumId`: `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$`（r2_store.py の実装と一致）
- `photoId`: 同上
- R2 キー形式: `albums/{albumId}/thumbs/{photoId}.webp` 等
- パストラバーサル（`..`、`/` で始まる、バックスラッシュ）を拒否

### キャッシュ制御

| リソース | Cache-Control |
|---|---|
| 認証済み `manifest.json` | `private, no-store` |
| 認証済み thumbs（`*.webp`） | `private, no-store` |
| 認証済み previews（`*.jpg`） | `private, no-store` |
| HTML ページ | `private, no-cache` |

R2 オブジェクトに保存された `public, max-age=31536000, immutable` は同期成果物のメタデータであり、認証済み Worker レスポンスへそのまま転送しない。共有キャッシュに認証済み画像を保存すると、後続リクエストが認可処理を迂回する危険があるためである。認可を維持したキャッシュ方式は、実装と脅威評価を伴う将来の別decisionとする。

### レスポンスヘッダー（HTML レスポンス）

```text
Content-Security-Policy: default-src 'self'; img-src 'self'; style-src 'self';
  script-src 'self'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
```

### エラーハンドリング方針

- `manifest.json` が存在しない → 404 JSON `{"error": "album not found"}`
- 画像が存在しない → 404（理由を詳細に返さない）
- R2 読み取りエラー → 500（内部エラーの詳細を漏らさない）

---

## 10. Consequences and Tradeoffs

### 採用することで得られるもの

- **シンプルな実装**：Hono + JSX により、Workers 単体でページ・API・静的アセットを配信できる。フロントエンドビルドパイプラインが不要
- **一貫したセキュリティ境界**：サーバーサイドレンダリングにより、認可ロジックがすべてサーバー側に存在する
- **Cloudflare Access の再利用**：管理者認証の困難な部分（2FA、セッション管理、IdP 連携）を Cloudflare に委譲
- **Workers 標準 API のみ**：Web Crypto の PBKDF2-SHA256 を追加暗号依存なしで使える

### トレードオフ・制約

- **PBKDF2 を初期選択**：PBKDF2-SHA256 は Workers Web Crypto で利用できる。Argon2id/bcrypt は Web Crypto のネイティブ機能ではなく、第三者依存や WebAssembly 等の評価が必要なため初期採用しない。反復回数は Workers CPU 制限下で実測して決定する
- **Hono の JSX は軽量 UI 向き**：複雑な状態管理が必要なリアルタイム UI（将来のギャラリーライトボックス等）は JS を追加実装する必要がある
- **セッション管理が D1 依存**：D1 の読み取り遅延がセッション確認のたびに発生する。Workers の KV や Durable Objects の方が高速だが、D1 は設計書で採用済み
- **Cloudflare Access 設定が前提**：/admin の保護は Cloudflare Access のダッシュボード設定が必要。CI や自動テストでは Access JWT をモックする必要がある

---

## 11. Rejected Alternatives

### Workers Assets + SPA（React 等）

クライアントサイドルーティング・状態管理・独立したビルドパイプラインが必要になる。小規模プライベート写真共有アプリには過剰。認可ロジックがクライアントに漏れるリスクがある。

### 共有ユーザーに Cloudflare Access を使う

Cloudflare One の管理ユーザーとして家族・友人を追加する必要がある。非技術者の招待・削除が複雑。アルバム単位の権限管理を Access ポリシーで表現することが困難。Worker 独自ログインの方がアルバム権限との統合が自然。

### Worker 独自ログイン for /admin

管理者認証の 2FA・レート制限・IdP 連携を自前実装する必要がある。Cloudflare Access を既に利用できる環境では非効率。

### bcrypt / argon2 for パスワードハッシュ

Workers Web Crypto のネイティブ機能ではない。サードパーティライブラリや WebAssembly で実現できる可能性はあるが、CPU時間、互換性、保守性、バンドルサイズへの影響を別途評価する必要があるため初期採用しない。

---

## 12. First Implementation Handoff Recommendation

### Phase 2 最初の Workers handoff の推奨スコープ

```text
workers/ ディレクトリの初期化
  - package.json（Hono + TypeScript）
  - wrangler.toml（Worker と Workers Assets のローカル設定のみ。R2・D1 バインディングは Phase 3 まで追加しない）
  - tsconfig.json（JSX: hono/jsx）
  - src/index.ts（Hono エントリーポイント）

ルート実装（フィクスチャデータのみ）
  - GET  /            → ログインページ HTML
  - GET  /albums      → アルバム一覧 HTML（フィクスチャ）
  - GET  /albums/:id  → 写真一覧 HTML（フィクスチャ）
  - すべてのルートは認証なし画面アクセスで空/フィクスチャを返す
  - GET /api/*, POST /api/*, GET /img/* は 401 を返す（Phase 3 で実装）

ミドルウェア
  - セキュリティヘッダー（CSP 等）

型定義
  - types/manifest.ts（manifest.json の schemaVersion 1 に対応）
  - types/env.ts（Bindings 型）

テスト
  - npm run lint, typecheck, test, build が通ること

Workers Assets
  - 最小限の CSS ファイルの配信確認
```

**実装しない（Phase 3 handoff に残す）**

- D1 クエリ、実際のログイン処理、セッション管理、R2 読み取り、Cloudflare Access JWT 検証

---

## 13. Open Questions Requiring Codex/User Decision

以下は本決定では確定できず、次の handoff 前にユーザーまたは Codex の判断が必要。

1. **`ADMIN_EMAILS` の管理方法**：Cloudflare Workers の `wrangler secret` で管理するか、D1 の管理者テーブルで管理するか。前者はシンプルだが再デプロイが必要。後者は柔軟だが管理画面の鶏卵問題がある。

2. **PBKDF2 の iterations 数**：100,000 を推奨するが、Workers の CPU 制限（デフォルト 10ms、Unbound Workers で 30s）との兼ね合いを実測して確定する必要がある。

3. **セッション有効期限**：7日（スライディング）か、固定か。失効後の再ログイン UX の要件による。

4. **D1 sessions のクリーンアップ方法**：Cron Triggers（Phase 5 まで不要）かログイン時の定期的な削除か。

5. **Cloudflare Access のアプリケーション設定**：`/admin` 向けの Access アプリ作成は手動設定が必要。CF_ACCESS_AUD（Audience tag）を workers の環境変数に設定するタイミングと方法を確認する。

6. **R2 バインディング名の確定**：設計書では `PHOTO_BUCKET`。`wrangler.toml` の binding 名を確定してから wrangler.toml を作成する。

7. **`wrangler.toml` の `workers_dev` 運用**：`wrangler dev` で /admin をテストするとき、Access JWT をモックする仕組みが必要。開発時の bypass 方法を確定する。

8. **アルバム閲覧セッションのリフレッシュ方式**：リクエストごとに `last_seen_at` を更新するとDBへの書き込みが増える。スライディングウィンドウか固定期限かを決める。

---

## 14. Official Sources

| ソース | URL | アクセス日 |
|---|---|---|
| Cloudflare Workers Static Assets | https://developers.cloudflare.com/workers/static-assets/ | 2026-06-09 |
| Cloudflare Static Assets Worker-first routing | https://developers.cloudflare.com/workers/static-assets/routing/worker-script/ | 2026-06-09 |
| Cloudflare Workers HTML Response | https://developers.cloudflare.com/workers/examples/return-html/ | 2026-06-09 |
| Cloudflare Workers Limits | https://developers.cloudflare.com/workers/platform/limits/ | 2026-06-09 |
| Cloudflare Workers Secrets | https://developers.cloudflare.com/workers/configuration/secrets/ | 2026-06-09 |
| Cloudflare D1 Worker API | https://developers.cloudflare.com/d1/worker-api/ | 2026-06-09 |
| Cloudflare R2 Workers API Reference | https://developers.cloudflare.com/r2/api/workers/workers-api-reference/ | 2026-06-09 |
| Cloudflare Workers Web Crypto | https://developers.cloudflare.com/workers/runtime-apis/web-crypto/ | 2026-06-09 |
| Cloudflare Workers Cookies | https://developers.cloudflare.com/workers/runtime-apis/request/ | 2026-06-09 |
| Cloudflare Access Policies | https://developers.cloudflare.com/cloudflare-one/policies/access/ | 2026-06-09 |
| Cloudflare Access JWT validation | https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/ | 2026-06-09 |
| Hono Getting Started (Cloudflare Workers) | https://hono.dev/docs/getting-started/cloudflare-workers | 2026-06-09 |
| Hono JSX Guide | https://hono.dev/docs/guides/jsx | 2026-06-09 |

### 調査時の注意事項

- Cloudflare Access の `/admin` パス保護については、公式ドキュメントがパスプレフィックス単位のアプリ設定を明示的に示していなかった。Access は「アプリケーション単位」で設定するが、アプリケーションに特定パス（例：`example.com/admin`）を指定できることは複数のドキュメントから確認できる
- PBKDF2 の Workers CPU 制限との兼ね合いは実測が必要（上記 Open Questions 参照）
- Hono JSX の Workers ランタイム固有の制限については公式ドキュメントに明示がなく、実装時に確認が必要
