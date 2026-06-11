# オペレーター向けブートストラップ手順

photo-gate を初めて本番環境へ接続するための手順書です。
このドキュメントはリソースの作成、マイグレーションの適用、
初期ユーザー・アルバムの登録までをカバーします。

> **前提知識**: `wrangler` コマンドとCloudflare D1/R2の基本的な操作を
> 把握していることを前提とします。

---

## 1. 前提: wrangler ログイン

すべての操作は人間のオペレーターが対話的に実行します。
`wrangler login` によるブラウザ認証を事前に完了させてください。

```sh
wrangler login
```

アカウントが複数ある場合はログイン後に `wrangler whoami` で
対象アカウントを確認し、必要に応じて `CLOUDFLARE_ACCOUNT_ID`
環境変数または `--account-id` フラグで指定してください。

> **責務分担**: `wrangler login` とアカウント選択は
> `docs/fable/autonomy-contract.md` により人間のみが行います。ログイン完了後の
> リソース作成・additive migration適用・行INSERTは、オペレーターが本書どおり
> 実行するか、契約の範囲内で自律エージェントが実行できます。

---

## 2. D1 データベースの作成

```sh
wrangler d1 create photo-gate
```

成功すると以下のような出力が得られます。

```
✅ Successfully created DB 'photo-gate'

[[d1_databases]]
binding = "DB"
database_name = "photo-gate"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

出力された `database_id` で `workers/wrangler.toml` のプレースホルダー
(`database_id = "00000000-0000-0000-0000-000000000000"`)を置き換えてください。

```toml
[[d1_databases]]
binding = "DB"
database_name = "photo-gate"
database_id = "<出力された database_id>"
```

> **コミットしてよい値**: `database_id` はリソースの識別子であり、
> シークレットではありません。`wrangler.toml` へのコミットは問題ありません。
> パスワード・ハッシュ・実際のユーザーIDをコミットしないよう注意してください。

---

## 3. R2 バケットの作成

```sh
wrangler r2 bucket create photo-gate
```

バケットは非公開のまま使用します。**パブリックアクセスを有効化しないでください。**
画像はすべてWorkers経由で配信します。

> バケット名 `photo-gate` もシークレットではなくリソース識別子です。
> `wrangler.toml` の `bucket_name` に記載してコミットできます。

---

## 4. マイグレーションの適用

D1に対してスキーマを適用します。マイグレーションは追記専用(additive-only)です。

```sh
cd workers
wrangler d1 migrations apply photo-gate --remote
```

適用されるマイグレーション:

- `0001_users_sessions.sql` — `users` テーブル / `sessions` テーブル
- `0002_albums_permissions.sql` — `albums` テーブル / `album_permissions` テーブル

マイグレーション一覧と適用済み状態を確認する場合:

```sh
wrangler d1 migrations list photo-gate --remote
```

---

## 5. 最初のユーザーの作成

### 5.1 パスワードハッシュの生成

パスワードハッシュの生成はローカルで実行します。
パスワードはstdinから読み込まれ、argv・環境変数には渡されません。

```sh
cd workers
node scripts/hash-password.mjs
```

プロンプトが表示されたらパスワードを入力してください。
出力された1行(`pbkdf2-sha256$100000$...`)をコピーしておきます。

> **注意 (Windows)**: Windows環境ではreadlineがエコーを抑制できないため、
> 入力中のパスワードが画面に表示されます。セキュアな端末セッションで
> 実行してください。

### 5.2 ユーザー行の INSERT

タイムスタンプは `Date.toISOString()` 形式(例: `2026-06-11T00:00:00.000Z`)
を使用します。

```sh
wrangler d1 execute photo-gate --remote --command \
  "INSERT INTO users (id, display_name, password_hash, enabled, fail_count, locked_until, created_at, updated_at) VALUES ('<USER_ID>', '<DISPLAY_NAME>', '<HASH>', 1, 0, NULL, '<NOW_ISO>', '<NOW_ISO>')"
```

| プレースホルダー | 説明 |
|---|---|
| `<USER_ID>` | 英数字・`_`・`-`のみ、1〜128文字、先頭は英数字 |
| `<DISPLAY_NAME>` | 表示名(任意の文字列) |
| `<HASH>` | `hash-password.mjs` が出力したハッシュ行 |
| `<NOW_ISO>` | 現在時刻の ISO 8601 UTC 文字列 (例: `2026-06-11T09:00:00.000Z`) |

---

## 6. アルバムの作成と権限付与

### 6.1 アルバム行の INSERT

```sh
wrangler d1 execute photo-gate --remote --command \
  "INSERT INTO albums (id, title, photoprism_album_uid, enabled, expires_at, thumb_long_edge, thumb_format, thumb_quality, preview_long_edge, preview_format, preview_quality, strip_exif, download_enabled, created_at, updated_at) VALUES ('<ALBUM_ID>', '<ALBUM_TITLE>', '<PHOTOPRISM_ALBUM_UID>', 1, NULL, 640, 'webp', 80, 3840, 'jpg', 88, 1, 0, '<NOW_ISO>', '<NOW_ISO>')"
```

| プレースホルダー | 説明 |
|---|---|
| `<ALBUM_ID>` | 英数字・`_`・`-`のみ、1〜128文字、先頭は英数字 |
| `<ALBUM_TITLE>` | アルバムの表示名 |
| `<PHOTOPRISM_ALBUM_UID>` | PhotoPrismのアルバムUID(Docker syncが参照する) |
| `<NOW_ISO>` | 現在時刻の ISO 8601 UTC 文字列 |

デフォルト値:
- `strip_exif = 1` — EXIFは必ず除去する(変更しないこと)
- `download_enabled = 0` — ダウンロードは初期状態で無効
- `expires_at = NULL` — 有効期限なし

### 6.2 アルバム権限の付与

```sh
wrangler d1 execute photo-gate --remote --command \
  "INSERT INTO album_permissions (album_id, user_id, created_at) VALUES ('<ALBUM_ID>', '<USER_ID>', '<NOW_ISO>')"
```

複数ユーザーへ付与する場合は、ユーザーごとに上記コマンドを繰り返してください。

---

## 7. Docker sync の実行

R2 へのmanifest・画像ファイルの配置はDocker syncサービスが行います。
具体的な実行コマンドと設定については `docker/README.md` を参照してください。

Docker syncが完了すると、R2に以下のオブジェクトが配置されます:
- `albums/<ALBUM_ID>/cover.webp`
- `albums/<ALBUM_ID>/thumbs/<PHOTO_ID>.webp`
- `albums/<ALBUM_ID>/previews/<PHOTO_ID>.jpg`
- `albums/<ALBUM_ID>/manifest.json`

> **重要**: manifestは画像アップロードの最後に書き込まれます。
> manifestが存在しない間、アルバムページは「準備中」と表示されます。

---

## 8. 動作確認(スモークテスト)

### 8.1 ログイン確認

1. `wrangler dev` または本番Workers URLにアクセスします。
2. `<USER_ID>` と設定したパスワードでログインします。
3. ログイン成功後、`/albums` へリダイレクトされることを確認します。

### 8.2 アルバム表示確認

1. `/albums` にアクセスし、作成したアルバムのタイトルが表示されることを確認します。
2. アルバムをクリックし、サムネイル一覧が表示されることを確認します。
   - Docker syncが未完了の場合は「準備中」と表示されます。

### 8.3 画像表示確認

1. サムネイルをクリックしてプレビューが表示されることを確認します。
2. `/img/<ALBUM_ID>/cover` にアクセスしてカバー画像が返ることを確認します。

### 8.4 R2 直接URLが使えないことの確認

R2バケットはパブリックアクセスを無効化しているため、
`https://<ACCOUNT_ID>.r2.cloudflarestorage.com/photo-gate/albums/...`
への直接アクセスは拒否されます(403または404)。

画像はすべてWorkers経由(`/img/...`)のみ配信されることを確認してください。
Workers経由でも未認証アクセスは `401` を返します。

---

## 9. 注意事項

### コミットしてよいもの
- `database_id`(D1リソースID)
- R2バケット名

### コミットしてはいけないもの
- パスワード(平文・ハッシュいずれも)
- 実際のユーザーIDや表示名
- `wrangler.toml` 以外の設定ファイルへの実値記載

### アカウントロックアウトへの対処

5回連続でログイン失敗するとアカウントが15分間ロックされます。
ロックを解除するにはD1で `locked_until` を `NULL` にリセットしてください。

```sh
wrangler d1 execute photo-gate --remote --command \
  "UPDATE users SET locked_until = NULL, fail_count = 0, updated_at = '<NOW_ISO>' WHERE id = '<USER_ID>'"
```

### パスワードの変更

新しいハッシュを生成してUPDATEします。

```sh
wrangler d1 execute photo-gate --remote --command \
  "UPDATE users SET password_hash = '<NEW_HASH>', updated_at = '<NOW_ISO>' WHERE id = '<USER_ID>'"
```
