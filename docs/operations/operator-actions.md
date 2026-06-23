# オペレーター対応事項と全体進捗 (2026-06-23 更新)

このドキュメントは「人間(オペレーター)が手を動かす必要がある作業」と
「プロジェクト全体の現在地」を 1 枚にまとめたものです。状態の最終的な
正は `docs/fable/progress.md` / `roadmap.md` ですが、まず本書を見れば
次にやることが分かるようにしてあります。

---

## A. いま対応が必要なこと(優先度順)

### A-0. 【要対応】sync イメージを `0.2.1` に上げる(ログ漏えい修正)

**背景**: 2026-06-15 に本番ログを確認したところ、0.2.0 のデーモンが
httpx のリクエストログ(`HTTP Request: GET <URL>`)を出力しており、
その URL に **PhotoPrism のプレビュートークンとホスト名が露出**して
いた。デーモンのログ設定がルートロガーを INFO にしていたのが原因
(0.2.0 のリグレッション)。0.2.1 でルートロガーを WARNING に戻し、
`photo_gate.*` のみ INFO・httpx 等を WARNING に固定して修正した。

**対応手順**:

1. docker-ci(`sync-v0.2.1` タグ)で GHCR に `0.2.1` が公開されるのを待つ。
2. Portainer → Stacks → `iniwa-photo-gate` → `image:` のタグを
   `0.2.1` に変更 → **Update the stack**(`command:` ブロックの変更は
   不要。0.2.0 から据え置き)。
3. 起動ログに `photo-gate-sync 0.2.1 starting ...` が出て、`HTTP Request:`
   行が**出ていない**ことを確認する。

> **漏えいの影響について**: プレビュートークンは sync のたびに
> PhotoPrism から取り直す短命なトークンで、ログを見られる範囲も
> Portainer にアクセスできる運用者に限られる。実害は限定的だが、
> 不変条件(ログにトークン・URL を出さない)違反なので修正する。
> 既に表示された分のトークンは次回 sync で自然に切り替わるため、
> 緊急の無効化操作は不要。

### A-1. 【完了 2026-06-15】R2 アクセスキーの再発行

**症状**: sync 0.2.0 デーモンは正常に起動しているが、R2 への書き込みが
`Unauthorized` で失敗している。

```
INFO photo-gate-sync 0.2.0 starting: album_id=ise-ryokou-id interval=86400s preview_size=fit_1920 concurrency=2
INFO album ise-ryokou-id: 234 photos to sync
Sync failed ... ObjectStoreError: R2 put failed ... (caused by ClientError: ... (Unauthorized) ... PutObject ... Unauthorized)
```

**原因(推定)**: 2026-06-12 に Cloudflare API トークンを再作成/ロール
した際、Pi の sync が使っていた **R2 用の認証情報(S3 互換アクセスキー)**
も無効化されたとみられる。0.1.6 では同じキーで成功していたため時期が
一致する。

**解決済み (2026-06-15)**: 運用者が photo-gate 限定の
Object Read & Write キーを再発行し Portainer env を更新。0.2.0 デーモン
が 234/234 を同期、cover + manifest を更新、`sync attempt 1 succeeded
in 134.1s` を確認した。本番は 0.2.x で完全稼働(ただし A-0 のログ修正
を 0.2.1 で適用すること)。

<details><summary>当時の対応手順(記録)</summary>

1. Cloudflare ダッシュボード → **R2** → **API** →
   **Manage API tokens**(R2 専用のトークン管理画面。プロフィールの
   API Tokens とは別物)
2. **Create API token**:
   - Permissions: **Object Read & Write**
   - Specify bucket: **`photo-gate` のみ**に限定(最小権限)
   - TTL: 無期限(期限付きにすると失効で再発する)
3. 表示される **Access Key ID** と **Secret Access Key** を控える
   (この画面でしか表示されない)
4. Portainer → Stacks → `iniwa-photo-gate` → **Environment variables**:
   - `R2_ACCESS_KEY_ID` を新しい Access Key ID に置換
   - `R2_SECRET_ACCESS_KEY` を新しい Secret Access Key に置換
   - **Update the stack** で再デプロイ
5. コンテナログで復旧確認:
   - `synced <uid> (N/234)` が流れる
   - 最後に `uploaded cover ...` と `uploaded manifest ...`
   - 起動から約 2 分後、Portainer のコンテナに **healthy** バッジ

> 値は Portainer の環境変数にのみ入れる。リポジトリには絶対に
> コミットしない(`R2_ENDPOINT_URL` / `R2_BUCKET` も同様に env 管理)。

</details>

### A-2. 【任意・急がない】ローカルトークンへ Workers 権限を追加

現在のローカルトークン(`~\.photo-gate-cf-token`)は **D1 権限のみ**。
そのため `wrangler d1 export`(バックアップ)は成功するが、
`wrangler versions list` / `wrangler rollback` / ローカルからの緊急
`wrangler deploy` は 403 になる。**通常のデプロイは CI 経由なので実害
なし。** 緊急ローカルデプロイ手段が欲しい場合のみ対応する。

**対応手順(値は変わらないのでファイル差し替え不要)**:

1. https://dash.cloudflare.com/profile/api-tokens
2. 当該トークンの **⋯ → Edit**(**Roll は押さない**。押すと値が変わり
   A-1 と同じ事故になる)
3. Permissions に **Account → Workers Scripts → Edit** を追加
4. **Continue to summary → Save**

完了後にエージェントへ伝えれば、`wrangler versions list` の疎通確認と
`deploy-log.md` への本番バージョン ID 追記を行う。

---

## B. トークンに関する整理(今後の事故防止)

photo-gate は **3 種類**の Cloudflare 認証情報を使う。混同が今回の
R2 停止の原因になったため、用途と保管先を明確にしておく。

| 認証情報 | 用途 | 保管先 | 必要権限 |
|---|---|---|---|
| ローカル API トークン | 手元からの `wrangler`(D1 操作・バックアップ・任意でデプロイ) | `~\.photo-gate-cf-token`(リポジトリ外) | D1 Edit(+任意で Workers Scripts Edit) |
| GitHub Actions トークン | CI からの Workers デプロイ・D1 migration | GitHub repo secrets `CLOUDFLARE_API_TOKEN` | D1 Edit + Workers Scripts Edit |
| R2 アクセスキー(S3 互換) | Pi の sync が R2 へ画像をアップロード | Portainer env `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 Object Read & Write(photo-gate のみ) |

**鉄則**:

- 既存トークンを更新したいときは **Edit のみ**。**Roll/Delete は値を
  変え、それを使っている経路を黙って壊す**(今回 R2 が停止した原因)。
- R2 アクセスキーと API トークンは**別物**。R2 のキーは R2 専用画面で
  発行し、Pi の Portainer env だけに入れる。
- いずれの値も**表示・ログ出力・コミットをしない**。差し替えは
  `scripts/update-cf-token.ps1`(SecureString 入力・自動検証)を使う。

---

## C. 全体進捗

### 完了レベル

- **Level 1(Securely Usable): 完了**(2026-06-12)。本番で 1 アルバム
  234 枚を end-to-end 配信し、ブラウザでログイン→一覧→サムネイル→
  プレビュー→カバー表示まで人間が確認済み。
- **Level 2(Operable): ほぼ完了**。残りは下表の 2 点のみ。

### Level 2 詳細

| 項目 | 状態 |
|---|---|
| Workers CI(lint/typecheck/test/build/deploy) | ✅ 完了。CI 自動デプロイを実地検証済み(c884256) |
| Docker CI(libvips テスト + container-test ゲート + GHCR リリース) | ✅ 完了 |
| Portainer スタック自動更新 | ✅ 廃止(CE に webhook なし。手動タグ更新が正式運用) |
| デプロイ版数記録 + ロールバック手順 | ✅ `deploy-log.md` / `rollback.md` |
| ネイティブスケジュール同期 | ✅ sync 0.2.0 `sync-daemon`(GHCR 公開済み) |
| ヘルス/レディネス | ✅ health file + `healthcheck` + Dockerfile HEALTHCHECK |
| サニタイズ済み運用ログ | ✅ daemon/sync の INFO ログ(URL/トークン/タイトル非出力) |
| D1/設定のバックアップ・リカバリ手順 | ✅ `backup.md`(D1 export を実地検証・初回ダンプ取得済み) |
| **本番での同期成功の確認** | ✅ 完了。0.2.1 が Pi 上で稼働・234/234 同期確認済み(2026-06-23) |
| Worker ロールバック手順の検証記録 | ✅ 完了(2026-06-23)。`wrangler rollback` で往復確認・スモーク全 5 項目合格。Docker ロールバックは Portainer スタック操作が必要で未検証 |

### Level 3(Feature Complete): 進行中

- `/admin` の Cloudflare Access 保護: 実装・デプロイ・Access アプリ設定・
  3 値登録・オペレーター確認済み (2026-06-23)
- 管理機能: ユーザー/アルバム/権限の読み取り専用一覧・権限 grant/revoke・
  アルバム/ユーザー有効化/無効化を実装・デプロイ済み。より広範なユーザー/
  アルバム操作・同期管理・監査情報は未実装
- R2 安全クリーンアップ(ADR + dry-run 先行、削除は人間承認まで無効)
- 最終ハードニング(依存関係・サプライチェーン・GitHub Actions 権限の
  レビュー、SHA pinning 等)

### 本番トポロジー(現状)

- Workers: https://share-photo.iniwach.com (CI デプロイ運用、カスタムドメイン)
  旧 `photo-gate.iniwaiwana.workers.dev` ルートは無効化済み (404 を返す)
- D1 `photo-gate`(APAC)/ R2 `photo-gate`(非公開)
- Pi 上 Portainer スタック `iniwa-photo-gate`:
  `ghcr.io/iniwa/photo-gate-sync:0.2.1`(sync-daemon、interval 86400s、
  preview_size fit_1920)
- GHCR 公開タグ: `0.1.6`(旧稼働)/ `0.1.7`(スキップ)/ `0.2.0`(ログ漏えい修正前)/ `0.2.1`(現行)
- Cloudflare Access: `/admin` パス限定アプリを設定済み・3 値登録済み・
  オペレーター動作確認済み (2026-06-23)

---

## D. 次のエージェント作業

1. (A-2 完了時)`wrangler versions list` 疎通確認 → ローカルトークンへの
   Workers Scripts Edit 権限追加を確認する。緊急時の備えとして任意。
2. Docker ロールバック検証: Portainer スタックのイメージタグを前版に切り替え・
   同期確認後、現行タグに戻す。手順は `rollback.md` セクション 2 に記載。
3. Level 3 の次の項目(より広範なユーザー/アルバム管理・同期管理・監査情報)を
   Codex と検討する。
