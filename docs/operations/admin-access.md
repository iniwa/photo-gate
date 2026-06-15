# `/admin` アクセス設定手順 (Cloudflare Access + Worker 側 JWT 検証)

このドキュメントは、`/admin` を Cloudflare Access で保護し、Worker 側で
JWT を検証して管理者メール allowlist と照合するまでの手順をオペレーター向けに
まとめたものです。

**前提**: 本手順を実施する前に、対象 Worker (photo-gate) が Cloudflare に
デプロイ済みであること、および Cloudflare One ダッシュボードへのアクセス権限
があることを確認してください。Access アプリの作成・シークレットの登録・
デプロイはすべて **人間による承認と操作** が必要です。エージェントに実施を
委任しないでください。

---

## 1. 目的

`/admin` パスを Cloudflare Access (Self-hosted アプリケーション) で保護する。
Access が発行した JWT を Worker 自身が検証 (`jose` ライブラリ、
`createRemoteJWKSet` + `jwtVerify`) し、さらに `email` クレームを
管理者メール allowlist と照合する。

- 認証に失敗したリクエスト (未認証・allowlist 外・設定不備) はすべて
  同一の汎用 `403 Forbidden` (`Cache-Control: no-store`) で終端する。
- 原因、メールアドレス、JWT、チームドメイン、AUD タグ、JWKS エラーは
  一切レスポンスにもログにも出力しない。

---

## 2. Cloudflare Access アプリケーションの作成

### 2-1. アプリの新規作成

1. [Cloudflare One](https://one.dash.cloudflare.com/) → **Access** →
   **Applications** → **Add an application**
2. アプリ種別: **Self-hosted** を選択
3. 以下を入力:
   - **Application name**: 任意 (例: `photo-gate-admin`)
   - **Session Duration**: 運用ポリシーに従って設定 (例: `24h`)
   - **Application domain**: Worker のドメインに `/admin` のパスを付けて
     パス限定にする
     ```
     Domain:  <your-worker-domain>
     Path:    /admin
     ```
     (例: `photo-gate.<account>.workers.dev` の場合、Path を `/admin` に設定)

4. **Next** へ進み、**Identity providers** と **Policies** を設定する
   (最低 1 つのポリシーで管理者のみ通過させる。メール照合は Worker 側でも
   行うため、Access ポリシー側でも絞り込んでおくことを推奨)

### 2-2. AUD タグとチームドメインの控え

アプリ作成後、**Settings** タブ (または設定画面内) に表示される値を控える:

| 項目 | 説明 | 例(プレースホルダー) |
|---|---|---|
| **Application Audience (AUD) tag** | JWT の `aud` クレームに入る値 | `<access-aud-tag>` |
| **Team domain** | JWKS エンドポイントと issuer の基底となるホスト名 | `<team>.cloudflareaccess.com` |

> **注意**: AUD タグとチームドメインは機密情報です。リポジトリ、ログ、
> スナップショット、チャット履歴に記録しないでください。

---

## 3. Worker への設定値登録

Worker に登録する値は **3 つ**。いずれも `wrangler.toml` やソースコードには
書きません。`wrangler secret put` (対話入力) を使い、値は入力後に
表示・コミットしない形で登録します。

### 3-1. CF_ACCESS_TEAM_DOMAIN

チームドメインの**ホスト名のみ**を登録します。
`.cloudflareaccess.com` で終わる Cloudflare Access チームドメインだけが
受理されます。スキーム (`https://`)・パス・ポート・末尾スラッシュは
含めないでください。

```sh
wrangler secret put CF_ACCESS_TEAM_DOMAIN
```

プロンプトに対して `<team>.cloudflareaccess.com` 形式のホスト名のみを入力します。

> 正: `<team>.cloudflareaccess.com`
> 誤: `https://<team>.cloudflareaccess.com` (スキーム付きは拒否される)
> 誤: `<team>.cloudflareaccess.com/cdn-cgi/access/certs` (パス付きは拒否される)

### 3-2. CF_ACCESS_AUD

Access アプリケーションの AUD タグを登録します。

```sh
wrangler secret put CF_ACCESS_AUD
```

プロンプトに対して AUD タグ文字列を入力します。

### 3-3. ADMIN_EMAILS

管理者のメールアドレスをカンマ区切りで登録します。

```sh
wrangler secret put ADMIN_EMAILS
```

プロンプトに対してカンマ区切りのメールアドレス一覧を入力します:

```
admin@example.com,another-admin@example.com
```

- 各エントリはトリム・小文字化されて allowlist に登録される
- 空エントリ (末尾カンマなど) は fail-closed として設定全体が拒否される
- `wrangler.toml` には書かない

### 3-4. 登録確認

```sh
wrangler secret list
```

`CF_ACCESS_TEAM_DOMAIN`、`CF_ACCESS_AUD`、`ADMIN_EMAILS` の 3 つが
`secret` として表示されることを確認します。値は表示されません。

---

## 4. fail-closed の挙動

以下のいずれかに該当する場合、Worker は原因を問わず同一の汎用
**`403 Forbidden`** (`Cache-Control: no-store`) を返します:

| 状態 | 結果 |
|---|---|
| 3 値のいずれかが未登録・不正値 | `403` |
| `Cf-Access-Jwt-Assertion` ヘッダーが欠落・空 | `403` |
| JWT の署名検証失敗 | `403` |
| issuer / audience / 有効期限 (`exp` 必須) / `nbf` の不一致 | `403` |
| JWKS フェッチ失敗 | `403` |
| `email` クレームが欠落・文字列以外・空白/制御文字を含む | `403` |
| allowlist に一致するメールアドレスがない | `403` |

`403` レスポンスにはメールアドレス、チームドメイン、AUD、JWT の内容、
JWKS エラー、allowlist の内容は一切含まれません。ログにも出力しません。

---

## 5. デプロイ後のスモーク確認

> **前提**: Access アプリ作成・3 値の登録・Worker デプロイがすべて完了していること。
> このスモーク確認は、それらが別途実施された後に行います。

### 5-1. 管理者アクセス (正常系)

1. allowlist に登録されたメールアドレスの Cloudflare Access セッションで
   `GET /admin` にアクセスする
2. 期待結果: `200 OK`、ページに「管理コンソール」の見出しが表示される
3. レスポンスヘッダーに `Cache-Control: no-store` が含まれることを確認する
4. ページ内にビューワーデータ (アルバム一覧、写真、R2/PhotoPrism/NAS
   由来のデータ) が含まれていないことを確認する

### 5-2. 未認証アクセス (異常系)

1. Access セッションなし (または有効でない JWT) で `GET /admin` にアクセスする
2. 期待結果: `403 Forbidden`、`Cache-Control: no-store`
3. レスポンスボディにメールアドレス、ドメイン、JWT の断片が含まれていない
   ことを確認する

### 5-3. allowlist 外アクセス (異常系)

1. allowlist に含まれないメールアドレスの Access セッションで
   `GET /admin` にアクセスする
2. 期待結果: `403 Forbidden`、`Cache-Control: no-store`

### 5-4. その他パス (認証済み)

1. allowlist に登録された管理者セッションで `GET /admin/anything` にアクセスする
2. 期待結果: `404 Not Found`、`Cache-Control: no-store`
   (管理機能は未実装のため、認証済みでも 404 が返る)

---

## 6. セキュリティ上の注意

- **実メールアドレス・AUD タグ・チームドメイン・トークンをリポジトリに
  コミットしない**。`wrangler.toml` への記載も禁止。
- ログ出力・スナップショット・チャット履歴にも記録しない。
- `wrangler secret put` の対話入力で値を渡す。スクリプト引数やシェル履歴
  に値が残る形での登録は避ける。
- Access アプリ作成・シークレット登録・デプロイ操作はエージェントに
  委任せず、オペレーターが直接実施する。
- `GET /admin` の成功レスポンスには管理機能は未実装である旨のみ表示される。
  ビューワー/アルバム/R2/PhotoPrism/NAS データは含まれない。
