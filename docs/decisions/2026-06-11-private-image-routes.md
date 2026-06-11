# Private画像ルート(/img)の設計決定

## 1. Status and Date

- **Status:** Accepted
- **Date:** 2026-06-11
- **Scope:** 実R2読み出しを行う閲覧者向け画像route群の形と認可チェーン

## 2. Decisions

### 2.1 ルート構成(GETのみ)

```text
GET /img/:albumId/cover                -> albums/{albumId}/cover.webp
GET /img/:albumId/thumb/:photoId       -> albums/{albumId}/thumbs/{photoId}.webp
GET /img/:albumId/preview/:photoId     -> albums/{albumId}/previews/{photoId}.jpg
```

上記以外の `/img` 配下(`/img` 自体、未知のサブパス、GET以外のメソッド)は
既存の予約401 catch-allへフォールスルーする。manifest本文を返すrouteは
作らない(photo一覧は後続のSSRアルバム詳細ページがサーバ側で使う)。

### 2.2 認可チェーン(project-contextのMandatory Request Boundaryどおり)

1. `requireSession` — 無効なら401。以降を実行しない。
2. `requireAlbumPermission` — 不許可なら403。R2へ到達しない。
3. thumb/preview: `loadManifestAuthorizedThumb/Preview` — 検証済みmanifestの
   厳密ID一致が先、画像読み出しは一致後のみ。
4. cover: `loadAlbumCover`。**coverはphoto単位オブジェクトではなく、Docker
   syncがアルバム単位で公開する資産なので、manifest membershipは要求しない。
   アルバム権限が境界である。**manifest不在でもcoverは配信できる(syncは
   cover/画像を先に、manifestを最後にアップロードするため、この方が整合的)。
5. 応答は既存 `privateImageResponse`(kind固定Content-Type、
   `private, no-store`、nosniff、メタデータ非転送)のみ。

### 2.3 失敗の対応表

| 状態 | 応答 |
|---|---|
| セッション無効 | 401(汎用) |
| アルバム権限なし / albumId不正 | 403(汎用) |
| photoId形式不正 | 404(R2読み出しなし) |
| manifest不在 / photo未掲載 / 画像不在 | 404(汎用、区別不能) |
| manifest不正 / reader障害 / その他例外 | 500(汎用) |
| D1障害(セッション・権限) | 503(汎用) |

404/500/503はIDもキーも原因も含まない。未掲載photoの画像キーは
プローブしない(存在を漏らさない)。

### 2.4 依存注入

`(env) => deps` ファクトリで `PrivateR2Reader(env.PHOTO_BUCKET)`、
`SessionRepository(env.DB)`、`PermissionRepository(env.DB)` を構築する。
binding未設定時はrepo/readerが拒否し401/403/503/500へ閉じる。

## 3. References

- `docs/fable/project-context.md` Mandatory Request Boundary。
- `docs/decisions/2026-06-11-viewer-auth-routes.md`(DIとfail-closed方針)。
- `docs/handoffs/archive/2026-06-09-phase-3-manifest-authorized-photo-loading.md`。
