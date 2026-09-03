# ロールバック手順

Workers と Docker sync を既知の正常版へ戻す手順です。
「どの版が正常だったか」は `deploy-log.md` で特定します。

> **前提**: ロールバックは非破壊操作のみで構成されています。D1 スキーマ
> の巻き戻し(destructive migration)はここに含まれず、実施には AGENTS.md の
> approval gates に従った現在のユーザーによる明示的な承認が必要です。

---

## 1. Workers のロールバック

### 1.1 推奨: 既知の正常コミットを再デプロイ(git ベース)

最も確実で、追加のトークン権限が不要な方法です。CI 経由なら履歴も
git に残ります。

```sh
# 問題を持ち込んだコミットを打ち消して push(CI が自動デプロイ)
git revert <bad-commit>
git push
```

CI を待てない緊急時はローカルから直接デプロイします:

```sh
git checkout <known-good-commit>
cd workers
npm ci
npx wrangler deploy        # 出力の Current Version ID を deploy-log.md に記録
git checkout main          # 作業後は必ず main に戻す
```

> ローカルデプロイには有効な Cloudflare 認証と、現在のユーザーによる
> 明示的な承認が必要です
> (`wrangler login`、または有効な `CLOUDFLARE_API_TOKEN`)。

### 1.2 代替: wrangler のバージョンロールバック

```sh
cd workers
npx wrangler versions list           # 版数と作成日時の一覧
npx wrangler rollback [<version-id>] # 指定版へ戻す
```

> **検証済み (2026-06-23)**: `wrangler rollback <version-id> --name photo-gate --yes`
> で指定バージョンへの即時切り替えを本番で確認済み(往復・スモーク全合格)。
> `versions list` と `rollback` には OAuth セッション、または
> Workers Scripts Edit 権限付きトークンが必要。ローカルトークンは D1 権限のみ
> のため、実行は `wrangler login` の OAuth セッションを使用した。
> 通常は 1.1 の git ベース手順(CI がデプロイ)を優先する。

> **警告: `wrangler rollback` はシークレット(secrets)を復元しない。**
> Cloudflare はロールバック先バージョンのスクリプトコードのみを適用し、
> シークレット/変数は「connected resource」として扱われるため巻き戻されない。
> シークレットを持たないバージョンへロールバックすると、それ以降のバージョンへ
> 復帰してもシークレットは消えたままになる。ロールバック後は必ず 1.3 の
> シークレット確認手順を実行すること。

### 1.3 ロールバック後の確認

**A. シークレット確認(必須・最初に実施)**

```sh
cd workers
npx wrangler secret list
```

以下の **5 件すべて**が表示されることを確認する。
1 件でも欠けていたら、以下で再登録してから次の手順へ進むこと:

| シークレット名 | 欠落時の影響 |
|---|---|
| `CF_ACCESS_TEAM_DOMAIN` | `/admin` が全員 403 |
| `CF_ACCESS_AUD` | `/admin` が全員 403 |
| `ADMIN_EMAILS` | `/admin` が全員 403 |
| `HARD_DELETE_HMAC_KEY` | ハードデリート confirm-delete/delete ルートが 500 |
| `R2_CLEANUP_HMAC_KEY` | `/admin/r2-cleanup/confirm` ルートが 500 |

```sh
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN   # <team>.cloudflareaccess.com 形式
npx wrangler secret put CF_ACCESS_AUD           # Cloudflare One ダッシュボードからコピー
npx wrangler secret put ADMIN_EMAILS            # カンマ区切りメールアドレス
npx wrangler secret put HARD_DELETE_HMAC_KEY    # 安全な乱数値 (32 bytes 以上推奨)
npx wrangler secret put R2_CLEANUP_HMAC_KEY     # 安全な乱数値 (32 bytes 以上推奨)
```

> 値は対話入力のみ。スクリプト引数・シェル履歴・ログへの書き込みは禁止。
> 再登録後、新しいバージョン ID が発行される。`wrangler secret list` で 5 件を
> 再確認してから次へ進む。
>
> **CF_ACCESS_AUD は必ず Cloudflare One ダッシュボードからコピー貼り付けすること。**
> Cloudflare One → Access → Applications → アプリを Configure → Overview タブ。
> 手入力・記憶入力は 1 文字の差異で /admin が 403 になる(2026-06-23 に実際に発生)。

**B. スモーク確認**

1. `https://share-photo.iniwach.com/` がログインフォームを返す (200)
2. 未認証で `/albums` → `/` へ 303
3. 未認証で `/img/…` → 401 `Cache-Control: no-store`
4. 未認証で `/api/…` → 401 `Cache-Control: no-store`
5. 未認証で `/admin` → Cloudflare Access が 302 でインターセプト
6. ブラウザでログイン → アルバム一覧 → サムネイル表示
   (curl だけでは不十分。Referrer-Policy 事故の教訓により、ブラウザ
   経路の確認を必ず含めること)
7. 認証済みで `/admin` → 管理コンソールが表示される(シークレット再登録確認)

**C. 記録**

8. `deploy-log.md` に実施した操作の行を追記

上記 B-(1)〜(5) の curl スモークは 2026-06-23 のロールバック検証で実施・全合格済み。
シークレット消失は同検証で判明(A の手順はこの事故を受けて追加)。

---

## 2. Docker sync のロールバック

GHCR のタグは immutable 運用(タグの付け替えをしない)なので、
ロールバック = Portainer スタックのイメージタグを前の版に戻すこと、
です。

> **運用方針 (2026-06-23)**: この手順は障害対応用に維持するが、
> 正常稼働中の本番コンテナを往復させる定期的な実地検証は要求しない。
> 既知のセキュリティ不具合を含む版を検証目的で起動しないこと。

1. `deploy-log.md` で直前の正常タグを特定する(例: `0.1.6`)。
2. Portainer でスタック `iniwa-photo-gate` を開き、compose 内
   `image: ghcr.io/iniwa/photo-gate-sync:<TAG>` のタグを書き換えて
   再デプロイする(人間が作成した既存スタックの専用更新経路のみを使う)。
3. コンテナログで起動と次回 sync の成功を確認する。

> sync は manifest を最後にアップロードする設計のため、途中で失敗・
> 中断しても R2 上のアルバムは「最後に成功した同期」の整合状態を保ち
> ます。sync 側のロールバックで閲覧側が壊れることはありません。

### 2.1 R2 上のデータの巻き戻しについて

R2 のオブジェクトは PhotoPrism から再生成可能なキャッシュです。
内容を戻したい場合は、正常版の sync イメージで再同期すれば上書き
されます。**R2 オブジェクトの削除はロールバックに不要であり、人間の
承認なしに行わないこと。**

---

## 3. D1 マイグレーションとの順序

workers-ci の deploy ジョブは additive migration を適用してから
`wrangler deploy` を実行します(新コードが古いスキーマで動かない事故
の防止)。マイグレーションは追記専用なので、**Workers を古い版に戻して
もスキーマはそのままで安全**です(古いコードは新しい列・テーブルを
参照しないだけ)。スキーマ自体を戻す操作は destructive であり、本書の
範囲外です。
