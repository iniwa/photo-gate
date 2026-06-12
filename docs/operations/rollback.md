# ロールバック手順

Workers と Docker sync を既知の正常版へ戻す手順です。
「どの版が正常だったか」は `deploy-log.md` で特定します。

> **前提**: ロールバックは非破壊操作のみで構成されています。D1 スキーマ
> の巻き戻し(destructive migration)はここに含まれず、実施には人間の
> 明示的な承認が必要です(`docs/fable/autonomy-contract.md`)。

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

> ローカルデプロイには有効な Cloudflare 認証が必要です
> (`wrangler login`、または有効な `CLOUDFLARE_API_TOKEN`)。

### 1.2 代替: wrangler のバージョンロールバック

```sh
cd workers
npx wrangler versions list           # 版数と作成日時の一覧
npx wrangler rollback [<version-id>] # 指定版へ戻す
```

> **検証状況 (2026-06-12)**: この経路は未検証です。`versions list` /
> `rollback` / ローカル `wrangler deploy` には API トークンの
> **Account → Workers Scripts → Edit** 権限が必要で、現在のローカル
> トークンは D1 権限のみのため 403 になります。必要になったら
> ダッシュボードでトークンに権限を追加するか、`wrangler login` の
> OAuth セッションで実行してください。通常は 1.1 の git ベース手順
> (CI がデプロイ)を優先します。

### 1.3 ロールバック後の確認

1. `https://photo-gate.iniwaiwana.workers.dev/` がログインフォームを返す
2. 未認証で `/albums` → `/` へ 303
3. ブラウザでログイン → アルバム一覧 → サムネイル表示
   (curl だけでは不十分。Referrer-Policy 事故の教訓により、ブラウザ
   経路の確認を必ず含めること)
4. `deploy-log.md` に 1 行追記

---

## 2. Docker sync のロールバック

GHCR のタグは immutable 運用(タグの付け替えをしない)なので、
ロールバック = Portainer スタックのイメージタグを前の版に戻すこと、
です。

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
