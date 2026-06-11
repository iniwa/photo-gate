# 配信パイプライン(CI/CD・GHCR・Portainer)の設計決定

## 1. Status and Date

- **Status:** Accepted
- **Date:** 2026-06-11
- **Scope:** GitHub Actions構成、Dockerイメージ配布、Portainerスタック、Workersデプロイ自動化

## 2. Context

Gitea(canonical)→GitHubミラー(`iniwa/photo-gate`)は構成済み。GitHub
ActionsがCI/CD実行基盤(autonomy-contract)。Docker syncはRaspberry Pi 4
(`linux/arm64`)のPortainerスタックで動かす。初期スタック作成・secrets投入は
人間の責務。

## 3. Decisions

### 3.1 Workers CI/CD(`.github/workflows/workers-ci.yml`)

- トリガー: `push`(main)と`pull_request`の`workers/**`変更、および
  `workflow_dispatch`。
- checks job: `npm ci` → lint → typecheck → test → build(dry-run)→
  `npm audit --audit-level=high`。
- deploy job: mainのみ、checks成功後。`CLOUDFLARE_API_TOKEN` /
  `CLOUDFLARE_ACCOUNT_ID` secretsが存在する場合のみ実行(secrets未登録の
  間はスキップ成功とし、CIを赤にしない)。`wrangler deploy`。
  ※ wrangler.tomlのD1 placeholderが実IDに置換されるまでsecretsを登録
  しないこと(登録した時点でデプロイが有効になる)。

### 3.2 Docker CI/CD(`.github/workflows/docker-ci.yml`)

- トリガー: `push`(main)/`pull_request`の`docker/**`変更、tag
  `sync-v*`、`workflow_dispatch`。
- test job: Ubuntu上で `apt-get install libvips` →
  `pip install -e ".[dev]"` → `pytest` → `python -m compileall src`。
- release job(tag `sync-v*` のみ、test成功後): `docker buildx` で
  `linux/amd64,linux/arm64` をビルドし GHCR へpush。
- イメージ名: `ghcr.io/iniwa/photo-gate-sync`。
- タグ: immutable `sync-vX.Y.Z` → イメージタグ `X.Y.Z` と `sha-<short>`。
  `latest` は付けない(安定運用にlatestを使わない方針)。
- Portainer更新: release成功後、`PORTAINER_WEBHOOK_URL` secretが存在する
  場合のみPOST(人間が専用webhookを用意するまでスキップ)。

### 3.3 GitHub Actions共通方針

- `permissions` は最小権限(デフォルト `contents: read`、releaseのみ
  `packages: write`)。
- actionはメジャーバージョン固定以上(`actions/checkout@v4` 等)。
- 信頼できないissue/PRテキストをシェル・エージェント入力にしない。
- secretsはログへ出さない。

### 3.4 Portainerスタック(`deploy/portainer-stack.yml`)

- 単一サービス `photo-gate-sync`。`restart: unless-stopped`、
  `TZ=Asia/Tokyo` を維持。イメージはGHCRのimmutableタグを明示。
- 設定はすべてPortainer側のenvironment variables / secretsで注入し、
  リポジトリに実値を置かない(`PHOTOPRISM_URL` / `PHOTOPRISM_TOKEN` /
  `R2_ENDPOINT_URL` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` /
  `R2_BUCKET` / 任意で `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`)。
- **暫定運用:** ネイティブなスケジュール実行(roadmap Level 2 item 5)が
  実装されるまで、compose側のshellループで1アルバムを
  `SYNC_INTERVAL_SECONDS`(既定86400)ごとに `sync-once --confirm-upload`
  する。アルバム指定は `ALBUM_ID` / `ALBUM_TITLE` / `PHOTOPRISM_ALBUM_UID`
  環境変数。複数アルバムはサービスの複製で対応。スケジュール実行の
  実装後にこのループは置き換える。
- 失敗してもループは継続する(次周期で再試行)。同期は再実行可能。

## 4. Consequences

- mainへのpushでCIが常時走る。Workersデプロイとイメージ配布はsecrets/tag
  を人間が用意した時点で自動有効化される(fail-safeに段階導入)。
- `sync-v*` タグ運用はGitea側でタグをpushし、ミラー経由でGitHubに届く。

## 5. References

- `docs/fable/autonomy-contract.md`(配信権限・人間責務)。
- `docs/fable/engineering-rules.md`(Git And Delivery)。
