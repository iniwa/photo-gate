# 閲覧者ページ(SSR)の設計決定

## 1. Status and Date

- **Status:** Accepted
- **Date:** 2026-06-11
- **Scope:** fixtureページを実D1/R2バックのSSRページへ置き換える際のUX・認可・失敗時挙動

## 2. Decisions

### 2.1 ページ構成(Hono + JSX SSR、クライアントJSなし)

| Route | 内容 |
|---|---|
| `GET /` | ログインフォーム(`POST /api/auth/login`)。ログイン済みなら `303` で `/albums` へ |
| `GET /albums` | 認可済みアルバム一覧(keysetページネーション) |
| `GET /albums/:albumId` | アルバム詳細。検証済みmanifestのphoto一覧をthumbグリッドで表示 |

fixtureページと `fixtures.ts` は同一変更内で削除する。実ルートは最初から
完全な保護チェーンを通す(roadmapの置き換え条件を満たす)。

### 2.2 HTMLページの未認証時はログインへredirect

- HTMLページ(`/albums`、`/albums/:albumId`)はセッション無効時に
  `303 See Other` で `/` へredirectする(`Cache-Control: no-store`)。
  生の401テキストはAPI/imageルート用で、ページUXには使わない。
- 既存 `requireSession` は変更せず、401応答を `303 /` に変換する薄い
  ページ用ラッパー(`requireSessionPage`)を `src/middleware/` に追加する。
  503はそのまま透過する。判定ロジックの重複実装はしない。

### 2.3 ログインフォームと失敗表示

- `POST /api/auth/login` の資格情報失敗(不明ユーザー・パスワード不一致・
  ロック中)は `401` から `303 /?error=1` に変更する。原因によらず同一の
  redirect(列挙不能を維持)。`/` は `error=1` の時だけ汎用文言
  「ユーザーIDまたはパスワードが正しくありません」を表示する。
  query値は `=== '1'` の厳密比較で扱い、内容を反映しない。
- リクエスト形状の不備(Content-Type不正、フィールド欠落、過長)は
  従来どおり `401`(formからは発生しない異常リクエスト)。
  Origin不一致 `403`、依存障害 `503` も変更しない。
- ADR 2026-06-11-viewer-auth-routes §3.1のこの点を本ADRが更新する。

### 2.4 アルバム一覧

- `AuthorizedAlbumRepository.listAuthorizedAlbums(userId, now, 50, after?)`。
- `after` はquery param。`isValidId` で検証し、不正なら無視せず `400` では
  なくcursorなし扱い(fail-safe:先頭ページ表示)。
- 結果が `limit` 件のとき「次へ」リンク(`/albums?after=<lastId>`)を出す。
- 各アルバムはタイトル(D1の値をJSXが自動エスケープ)とcover画像
  (`/img/{albumId}/cover`)、詳細へのリンクを表示する。

### 2.5 アルバム詳細

- チェーン: `requireSessionPage` → `requireAlbumPermission`(403はそのまま、
  ページでも汎用403で良い)→ `getAuthorizedAlbum`(タイトル表示用、D1が
  viewer向けタイトルの正)→ `loadAlbumManifest`。
- photoはmanifest順で `/img/{albumId}/thumb/{photoId}` を表示し、
  `/img/{albumId}/preview/{photoId}` へリンクする(ブラウザ直接表示)。
- **manifest不在は「準備中」ページ(200)**。syncがまだ走っていない正常
  状態であり、404にしない。manifest不正・reader障害は汎用500ページ。
- photoのEXIF系情報は表示しない。表示はthumb画像とアクセシビリティ用の
  代替テキスト(photo title)に限る。title等はJSX自動エスケープに任せ、
  `dangerouslySetInnerHTML` を使わない。

### 2.6 キャッシュとヘッダ

- 認証済みHTMLは既存方針どおり `Cache-Control: private, no-cache`、
  redirect・エラーは `no-store`。共有キャッシュに入れない。
- 既存 `securityHeaders`(CSP等)を変更しない。

## 3. References

- `docs/decisions/2026-06-09-workers-ui-and-auth-foundation.md`(UI方式)。
- `docs/decisions/2026-06-11-viewer-auth-routes.md`(§3.1を本ADR §2.3が更新)。
- `docs/decisions/2026-06-11-private-image-routes.md`。
