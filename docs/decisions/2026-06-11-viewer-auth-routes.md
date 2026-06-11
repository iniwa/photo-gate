# 閲覧者認証ルート(login/logout/me)の設計決定

## 1. Status and Date

- **Status:** Accepted
- **Date:** 2026-06-11
- **Scope:** 最初の実D1接続route群 `/api/auth/*` の形と失敗時の振る舞い

## 2. Context

Phase 3基盤(crypto、repository、middleware、policy)が完成し、`DB` /
`PHOTO_BUCKET` bindingが宣言された。最初の実データrouteとして閲覧者認証を
実装する。UIはHono + JSX SSR(クライアントJSなし)のため、ブラウザからの
ログインはform POSTになる。

## 3. Decisions

### 3.1 ルート構成

- `POST /api/auth/login` — `application/x-www-form-urlencoded`(`userId`,
  `password`)。成功時 `303 See Other` で `/albums` へ。失敗時は一律
  `401`(本文は汎用テキスト)。エラー種別を露出しない。
- `POST /api/auth/logout` — 有効なセッションcookieがあればD1から削除し、
  cookieをクリアして `303` で `/` へ。cookieが無い/不正でも同じ応答
  (冪等)。D1削除失敗時のみ `503` とし、cookieはクリアしない
  (サーバ側に残る生きたセッションをクライアントだけ消して隠さない)。
- `GET /api/auth/me` — 既存 `requireSession` を通し `{ "userId": ... }` を
  返す。スモークテスト・診断用。
- `/api/auth/*` 以外の `/api`、`/img`、`/admin` は引き続き常時401。

### 3.2 ログインの失敗時の一様化(列挙・タイミング対策)

- 不明ユーザー・無効ユーザー・形式不正IDでも、固定のダミーPBKDF2ハッシュ
  に対して `verifyPassword` を実行してから失敗を返す(結果は無視)。
  ロック中アカウントも同様に検証を実行してから失敗を返す。
- 失敗応答はすべて同一(401、汎用本文、`Cache-Control: no-store`)。
- 検証失敗時、`userId` が形式上有効なら `recordLoginFailure(userId, now, 5,
  now+15min)` を常に呼ぶ(不明ユーザーではUPDATEが0行に一致するだけで、
  既知/不明でクエリ数が変わらない)。
- ダミーハッシュはソースに固定で置く公開の囮であり、secretではない。
  ダミー経路の応答は検証結果に関係なく常に失敗。

### 3.3 CSRF・Origin

- セッションcookieは `SameSite=Strict` であり、状態変更routeはさらに
  `Origin` ヘッダが存在する場合にリクエストURLのoriginと一致することを
  要求する(不一致は403、ボディ解析前に拒否)。login CSRFもこれで防ぐ。
- form POSTのみ受け付け、`Content-Type` を検証する。

### 3.4 セッション発行

- 成功時は毎回 `generateSessionToken()` で新規トークンを発行(固定化攻撃
  対策)。D1にはSHA-256 digestのみ保存。raw tokenはcookie以外へ渡さない。
- 有効期限は `sessionExpiresAtFrom(now)`(固定7日、ADR 2026-06-11
  login-session-policy)。cookie `Max-Age` は `SESSION_LIFETIME_SECONDS`。
- ログイン成功で `resetLoginFailure`。

### 3.5 依存注入とfail closed

- route群は `(env) => deps` ファクトリで構築し、テストはfake depsを注入する。
- binding未設定・D1障害・crypto障害はすべて503(汎用本文)で閉じる。
  ボディにID、digest、SQL、内部エラーを含めない。

## 4. Consequences

- `/api/auth/*` が最初の実D1依存routeになる。デプロイ前は実D1が無いため
  本番相当の動作はせず、ローカル検証はfake注入テストで行う。
- ログイン画面(SSR form)のUX(エラーメッセージ表示、redirect先)は
  fixture置き換え時に `303` 先の調整として実装する。

## 5. References

- `docs/decisions/2026-06-09-workers-ui-and-auth-foundation.md` 脅威モデル。
- `docs/decisions/2026-06-11-login-session-policy-and-pbkdf2-iterations.md`。
