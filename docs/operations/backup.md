# バックアップとリカバリ手順

photo-gate の永続データのうち、失うと再構築に人手が必要なものを
バックアップします。

## 1. 何をバックアップするか

| データ | 場所 | バックアップ要否 |
|---|---|---|
| ユーザー・アルバム・権限 | D1 `photo-gate` | **必要**(本書 §2) |
| セッション | D1 `photo-gate` | 不要(7 日で失効、再ログインで再作成) |
| 画像・manifest | R2 `photo-gate` | 不要(PhotoPrism から sync で再生成可能) |
| Workers コード・設定 | git リポジトリ(Gitea 正・GitHub ミラー) | リポジトリ自体が二重化済み |
| Portainer スタックの環境変数 | Pi 上の Portainer | **必要**(本書 §3) |
| シークレット | ローカルトークンファイル・GitHub Secrets | 再発行で対応(値の複製保管はしない) |

> **バックアップファイルの扱い**: D1 ダンプにはパスワードハッシュと
> 実ユーザー ID・アルバム ID が含まれます。**リポジトリに置かない・
> コミットしない・リポジトリ外の場所**(例: `%USERPROFILE%\photo-gate-backups\`)
> に保管してください。

## 2. D1 のバックアップ

### 2.1 推奨: `wrangler d1 export`(オペレーター実行)

```sh
wrangler login   # OAuth セッション
cd workers
wrangler d1 export photo-gate --remote \
  --output "%USERPROFILE%\photo-gate-backups\d1-YYYYMMDD.sql"
```

> **検証済み (2026-06-12)**: D1 権限を持つスコープ付き API トークンで
> 実行に成功(`wrangler login` 不要)。`Authentication error
> [code: 10000]` が出る場合はトークンの失効か D1 権限の欠落を疑う
> こと(`scripts/update-cf-token.ps1` で差し替え・検証できる)。

### 2.2 代替: SELECT ダンプ(スコープ付きトークンで可)

export が使えない環境では、テーブルごとに JSON で書き出します。

```sh
cd workers
wrangler d1 execute photo-gate --remote --json \
  --command "SELECT * FROM users" > users.json
wrangler d1 execute photo-gate --remote --json \
  --command "SELECT * FROM albums" > albums.json
wrangler d1 execute photo-gate --remote --json \
  --command "SELECT * FROM album_permissions" > album_permissions.json
```

(`sessions` は揮発データなので対象外。)

### 2.3 Time Travel(障害時の最終手段)

D1 には 30 日間のポイントインタイムリストア(Time Travel)があります。

```sh
wrangler d1 time-travel info photo-gate        # 現在のブックマーク確認(読み取りのみ)
wrangler d1 time-travel restore photo-gate --timestamp=<UNIX_TS>
```

> **restore は破壊的操作**(指定時点以降の書き込みが消える)です。
> `docs/fable/autonomy-contract.md` により、実行には人間の明示的な
> 承認が必要です。エージェントが自律的に実行してはいけません。

## 3. 設定のバックアップ

D1 以外に、復旧時に必要な「人間しか持っていない値」は以下です。
パスワードマネージャー等、リポジトリ外の安全な場所に控えてください。

- Portainer スタック `iniwa-photo-gate` の環境変数一式
  (`PHOTOPRISM_URL` / `PHOTOPRISM_TOKEN` / `R2_*` / `ALBUM_*` /
  `PHOTOPRISM_ALBUM_UID` / `SYNC_INTERVAL_SECONDS` /
  `PHOTOPRISM_PREVIEW_SIZE`)。compose 定義自体は
  `deploy/portainer-stack.yml` としてリポジトリにあるので、値だけが
  対象です。
- Cloudflare API トークン・R2 アクセスキーは値を控えるのではなく、
  失効・再発行で対応します(発行手順: Cloudflare ダッシュボード)。

## 4. リカバリ手順

### 4.1 D1 を失った場合

1. `docs/operations/bootstrap.md` §2-4 で D1 作成とマイグレーション適用。
   `wrangler.toml` の `database_id` を新しい ID に更新。
2. バックアップから復元:
   - SQL ダンプがある場合: `wrangler d1 execute photo-gate --remote --file <dump.sql>`
   - JSON ダンプの場合: bootstrap.md §5-6 の INSERT 文に値を移し替えて実行。
3. パスワードハッシュはダンプに含まれるためそのまま戻ります。
   ハッシュを失った場合のみ `hash-password.mjs` で再発行。

### 4.2 R2 を失った場合

1. bootstrap.md §3 でバケット再作成(非公開のまま)。
2. Pi の R2 アクセスキーを再発行して Portainer の環境変数を更新。
3. sync を 1 回実行すれば画像・manifest が再生成されます。

### 4.3 Pi / Portainer を失った場合

1. Portainer でスタックを `deploy/portainer-stack.yml` から再作成。
2. §3 で控えた環境変数を設定し、`deploy-log.md` 記載の正常タグを指定。

## 5. 推奨サイクル

- D1: ユーザー・アルバム・権限を変更したときに都度(変更頻度が低い
  ため定期ジョブは現状不要)。
- 設定: 値を変更したときに都度。
