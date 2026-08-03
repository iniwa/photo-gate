# オペレーター対応事項 (2026-08-03 更新)

このドキュメントは「人間(オペレーター)が手を動かす必要がある作業」を
まとめたものです。現在の本番状態を反映しています。

関連ドキュメント:
- ロールバック手順: `docs/operations/rollback.md`
- バックアップ・リカバリ: `docs/operations/backup.md`
- 管理画面アクセス設定: `docs/operations/admin-access.md`
- 初回ブートストラップ: `docs/operations/bootstrap.md`

---

## A. 通常運用

### A-1. Workers デプロイ (CI 経由)

通常のデプロイは Gitea への push が GitHub にミラーされ、
`workers-ci` ワークフローが自動実行されます。

1. Gitea の `main` ブランチへ push する。
2. GitHub → Actions → `workers-ci` の実行結果を確認する。
   `checks` ジョブと `deploy` ジョブの両方が `success` になることを確認する。
3. `docs/operations/deploy-log.md` にバージョン ID・コミット・備考を記録する。

> バージョン ID は CI ログの `Current Version ID:` 行、または
> Cloudflare ダッシュボード → Workers → photo-gate → Deployments で確認できる。

緊急時のローカルデプロイ・ロールバック手順は `rollback.md` §1 を参照。

### A-2. Docker sync のタグ更新 (Portainer)

Docker sync の新バージョンは `docker-ci` ワークフローが `sync-vX.Y.Z` タグの
push で GHCR に自動公開します。Portainer への適用は手動です。

1. `docker-ci` の `release` ジョブが成功し、
   GHCR に `X.Y.Z` タグが公開されたことを確認する。
2. Portainer → Stacks → `iniwa-photo-gate` → compose 内の
   `image: ghcr.io/iniwa/photo-gate-sync:X.Y.Z` を新タグに書き換え →
   **Update the stack** を実行する。
3. コンテナログで `photo-gate-sync X.Y.Z starting ...` を確認する。
4. `docs/operations/deploy-log.md` に GHCR タグ・コミット・Pi 稼働開始日時を記録する。

> `latest` タグは使用しない。immutable version タグ (`X.Y.Z`) が
> Portainer ロールバックの基点になる。

現在稼働中: `ghcr.io/iniwa/photo-gate-sync:0.4.2`

### A-3. Worker シークレットの確認

以下の 5 件のシークレットが登録されていることを確認する。
**ロールバック後は必ず最初に確認すること。**

```sh
cd workers
npx wrangler secret list
```

| シークレット名 | 用途 | 欠落時の影響 |
|---|---|---|
| `CF_ACCESS_TEAM_DOMAIN` | Cloudflare Access JWT 検証 (チームドメイン) | `/admin` が全員 403 |
| `CF_ACCESS_AUD` | Cloudflare Access JWT 検証 (AUD タグ) | `/admin` が全員 403 |
| `ADMIN_EMAILS` | 管理者メールアドレス allowlist | `/admin` が全員 403 |
| `HARD_DELETE_HMAC_KEY` | ハードデリート確認フォームの HMAC 署名 | confirm-delete/delete ルートが 500 |
| `R2_CLEANUP_HMAC_KEY` | R2 クリーンアップ削除プレビューの HMAC 署名 | /r2-cleanup/confirm が 500 |

1 件でも欠けていたら `docs/operations/rollback.md` §1.3 A の手順で再登録する。

### A-4. アルバムカタログの公開

ビューワー管理画面の同期ターゲット選択に使うカタログを更新する場合:

1. PhotoPrism のアルバム一覧が正しい状態であることを確認する。
2. sync サービスが実行できる環境 (Pi または docker exec) で以下を実行する:

```sh
photo-gate-sync publish-catalog
```

3. 管理画面 `https://share-photo.iniwach.com/admin/albums` で
   カタログの内容が正しく表示されることを確認する。

> publish-catalog は PhotoPrism アルバム UID をハッシュ化した `catalogId` のみを
> R2 の `ops/album-catalog.json` に書き込む。生 UID・URL・トークン・R2 認証情報は
> 公開しない。

### A-5. ブラウザ管理同期ターゲットの設定

管理画面からアルバムの同期ターゲットを設定する場合:

1. まず A-4 でカタログを最新化しておく。
2. 管理画面 `https://share-photo.iniwach.com/admin/albums` を開く。
3. 対象アルバム行のドロップダウンで PhotoPrism アルバムを選択し、
   **Set sync target** を押す。
4. Docker デーモンは次回同期時に `ops/sync-targets.json` を読んで
   選択されたアルバムを同期する。

同期ターゲットを外す場合は **Remove sync target** を押す。

### A-6. 手動同期の実行

デーモンは 86400 秒(約 1 日)ごとに自動同期します。
即時同期をトリガーしたい場合:

1. 管理画面 `https://share-photo.iniwach.com/admin/sync` を開く。
2. **Sync Now** ボタンを押す。
3. ページをリロードし、保留中インジケーターが消え、
   `runsCompleted` が増加していることを確認する。

### A-7. R2 クリーンアップ dry-run の確認

孤立した R2 オブジェクトを確認する場合:

1. 管理画面 `https://share-photo.iniwach.com/admin/r2-cleanup` を開く。
2. アルバムプレフィックスごとのオブジェクト数と分類を確認する。

**実際の削除は現在無効です (§C-2 参照)。削除ボタンは表示されません。**

---

## B. 緊急運用

### B-1. Worker のロールバック

`docs/operations/rollback.md` §1 を参照。
ロールバック後は **必ず §A-3 のシークレット確認を最初に実施すること**。
`wrangler rollback` はシークレットを復元しないため、欠落したシークレットが
原因で管理画面やハードデリートフォームが機能しなくなる。

### B-2. Docker sync のロールバック

`docs/operations/rollback.md` §2 を参照。
GHCR のタグは immutable なので、ロールバック = Portainer のタグを前バージョンに戻すこと。

### B-3. R2 アクセスキーの再発行

**症状**: sync デーモンが R2 書き込みで `Unauthorized` エラーを返す。

1. Cloudflare ダッシュボード → **R2** → **API** → **Manage API tokens**
   (R2 専用管理画面。プロフィールの API Tokens とは別物)
2. **Create API token**:
   - Permissions: **Object Read & Write**
   - Specify bucket: **`photo-gate` のみ** (最小権限)
   - TTL: 無期限
3. 発行された **Access Key ID** と **Secret Access Key** を控える
   (この画面でしか表示されない)
4. Portainer → Stacks → `iniwa-photo-gate` → Environment variables:
   - `R2_ACCESS_KEY_ID` を新しい Access Key ID に置換
   - `R2_SECRET_ACCESS_KEY` を新しい Secret Access Key に置換
   - **Update the stack** で再デプロイ
5. コンテナログで復旧確認 (`synced N/M` が流れ、`uploaded cover` と
   `uploaded manifest` が出る)

> API トークン (Workers 用・D1 用) と R2 アクセスキー (S3 互換) は別物。
> R2 キーの Roll/Delete は R2 アクセスを即座に遮断する。Edit を使うこと。

### B-4. D1 バックアップ・リカバリ

`docs/operations/backup.md` を参照。

---

## C. 人間の明示的承認が必要な操作

以下の操作は `docs/fable/autonomy-contract.md` により
エージェントが単独で実施することを禁止されています。

### C-1. ハードデリート

ユーザーまたはアルバムの本番削除は **取り消せません**。

操作手順: 管理画面の各一覧ページから「削除プレビュー」→「ハードデリート確認」の
2 段階フォームで実施。`HARD_DELETE_HMAC_KEY` シークレットが必要。

**ユーザーハードデリートの注意事項**:
- 対象ユーザーのセッション・アルバム権限も D1 CASCADE で削除される。
- R2 上のデータは削除されない。

**アルバムハードデリートの注意事項**:
- ブラウザ管理同期ターゲット (`ops/sync-targets.json` の該当エントリ) が
  先に除去される。
- アルバムの権限が D1 CASCADE で削除される。
- R2 上のアルバムオブジェクトは削除されない (孤立プレフィックスとして残る)。
  `/admin/r2-cleanup` で確認可能。
- R2 クリーンアップが必要な場合は §C-2 を参照。

### C-2. R2 実削除の有効化

現在、R2 の実削除は無効です。`POST /admin/r2-cleanup/delete` は
"not yet enabled" を返します。

有効化するには:
1. Codex による安全削除設計レビューと承認を取得する。
2. Workers コードの変更を含む専用ハンドオフを経由する。

**現在の handoff・エージェント権限では実施できません。**

### C-3. D1 Time Travel リストア

特定時点以降の書き込みが消える破壊的操作です。
`backup.md` §2.3 を参照し、オペレーターが直接操作してください。

### C-4. シークレットのロール・削除

既存シークレットの値を変更する場合:

```sh
npx wrangler secret put <SECRETNAME>
```

> **Roll/Delete は使用しない**。Cloudflare の Roll はシークレット値を変えるため、
> それを使っている経路が黙って壊れる (2026-06-23 のロールバック事故で確認済み)。

---

## D. 明示的に延期された機能

以下はエージェントが独自判断で実装・有効化してはいけません。

| 機能 | 状態 | 有効化条件 |
|---|---|---|
| R2 実削除 | 意図的に無効 | Codex 設計レビューと専用ハンドオフ (§C-2) |
| RAW/オリジナル画像ダウンロード | 未実装 | 別途 ADR 作成と人間承認 |

---

## E. 不変条件 (エージェント・オペレーター共通)

- R2 は非公開のままにする。画像は Workers 経由のみ配信する。
- Workers は NAS・PhotoPrism に直接アクセスしない。
- Docker sync は D1・ビューワー認証に直接アクセスしない。
- RAW・オリジナル画像・PhotoPrism データ・位置情報付き元ファイルを R2 に配置しない。
- R2 削除は Codex 承認まで dry-run のみ。
- シークレット・認証情報をリポジトリ・ログ・チャット履歴に記録しない。

---

## F. 現在の本番トポロジー (2026-08-03)

| コンポーネント | 現状 |
|---|---|
| Workers | `https://share-photo.iniwach.com` (commit `e9b61ac`, version `db0ac0e5`) |
| D1 `photo-gate` | APAC (`de77cb73-497a-4a41-bd1c-151fd907be3f`), 2 migrations applied |
| R2 `photo-gate` | 非公開, 2 album targets |
| Docker sync | `ghcr.io/iniwa/photo-gate-sync:0.4.2` (Portainer スタック `iniwa-photo-gate`) |
| Cloudflare Access | `/admin` パス限定アプリ, 5 Worker secrets 登録済み |
| cron | 毎日 18:00 UTC (03:00 JST) に期限切れセッション削除 |

旧ルート `photo-gate.iniwaiwana.workers.dev` は無効化済み (404 を返す)。

---

## G. トークン・認証情報の整理

photo-gate では 3 種類の Cloudflare 認証情報を使う。

| 認証情報 | 用途 | 保管先 | 必要権限 |
|---|---|---|---|
| ローカル API トークン | 手元 `wrangler` (D1 操作・バックアップ) | `~\.photo-gate-cf-token` (リポジトリ外) | D1 Edit (+任意で Workers Scripts Edit) |
| GitHub Actions トークン | CI からの Workers デプロイ・D1 migration | GitHub repo secrets `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | D1 Edit + Workers Scripts Edit |
| R2 アクセスキー (S3 互換) | Pi の sync が R2 へアップロード | Portainer env `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 Object Read & Write (photo-gate のみ) |

現在のローカルトークンは **D1 権限のみ**。`wrangler versions list` / `wrangler rollback` /
ローカルからの緊急 `wrangler deploy` には OAuth セッション (`wrangler login`) が必要。
通常のデプロイは CI 経由なので実害なし。

---

## H. Worker シークレットの登録コマンド (値は対話入力のみ)

```sh
cd workers
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN  # <team>.cloudflareaccess.com 形式
npx wrangler secret put CF_ACCESS_AUD          # Cloudflare One ダッシュボードからコピー
npx wrangler secret put ADMIN_EMAILS           # カンマ区切りメールアドレス
npx wrangler secret put HARD_DELETE_HMAC_KEY   # 安全な乱数値 (32 bytes 以上推奨)
npx wrangler secret put R2_CLEANUP_HMAC_KEY    # 安全な乱数値 (32 bytes 以上推奨)
```

> `CF_ACCESS_AUD` は必ず Cloudflare One ダッシュボード → Access → Applications
> → アプリを Configure → Overview タブの値をコピー貼り付けすること。
> 手入力は 1 文字の差異で `/admin` が 403 になる (2026-06-23 に実際に発生)。

> 値は対話入力のみ。argv・スクリプト・ログ・チャット履歴に値を書かないこと。
