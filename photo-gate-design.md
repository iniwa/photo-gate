# photo-gate 設計書

`photo-gate` は、PhotoPrism / NAS の前段に置く写真共有ゲートウェイである。Cloudflare Workers、Cloudflare R2、Raspberry Pi Docker Serviceを組み合わせ、共有ユーザーにはPhotoPrism本体へ直接アクセスさせず、生成済みの共有用画像だけを安全に配信する。

## 1. 概要

`photo-gate` は、PhotoPrismで管理している写真アルバムを、指定した共有ユーザー向けに安全に公開するための写真共有システムである。

基本方針は以下の通り。

- PhotoPrism / NAS は原本管理・アルバム管理に徹する
- PhotoPrismはCloudflare Access配下に置き、一般共有ユーザーには直接アクセスさせない
- Raspberry Pi上のDockerサービスが、共有対象アルバムの派生画像を事前生成する
- Cloudflare R2には、共有用の低解像度サムネイル・高解像度プレビュー・manifestのみを置く
- Cloudflare Workersは、ページ/API/管理画面を提供し、R2上の生成済みデータを返す
- RAW / RW2 / 原本はR2に置かない
- 通常閲覧時はCloudflare Workers + R2で完結させる

---

## 2. 全体アーキテクチャ

```text
共有ユーザー
  ↓
Cloudflare Workers
  - 共有ページ
  - ログイン
  - 権限チェック
  - R2画像配信
  ↓
Cloudflare R2
  - thumb
  - preview
  - manifest.json
```

管理・同期時は以下の流れになる。

```text
管理者
  ↓
Cloudflare Workers 管理画面
  ↓
Pi Docker Sync Service
  ↓
PhotoPrism / NAS
  ↓
thumb / preview 生成
  ↓
Cloudflare R2へアップロード
```

---

## 3. システム構成

```text
photo-gate/
├─ workers/   # Cloudflare Workers / 共有ページ / 管理画面 / API
└─ docker/    # Raspberry Pi上で動く同期・画像生成サービス
```

---

## 4. 各コンポーネントの責務

### 4.1 PhotoPrism / NAS

#### 役割

- 写真原本の管理
- RAW / RW2 / JPEG原本の保持
- PhotoPrism上での写真整理
- PhotoPrism上でのアルバム管理

#### 方針

- Cloudflare Access配下に置く
- 共有ユーザーはPhotoPrismへ直接アクセスしない
- PhotoPrism共有リンクは原則使わない
- WorkerまたはPi Dockerサービスだけが、Service Token等を使って到達する

---

### 4.2 Raspberry Pi Docker Service

#### 役割

- PhotoPrism APIからアルバム一覧を取得
- PhotoPrism APIからアルバム内の写真一覧を取得
- NASまたはPhotoPrismから生成元画像を取得
- 低解像度サムネイルを生成
- 高解像度プレビューを生成
- EXIF削除
- R2へアップロード
- `manifest.json` 生成
- R2上の不要データ削除
- 同期ジョブAPIの提供

#### やらないこと

- 共有ページの提供
- 閲覧者の認証
- 共有ユーザーへの直接配信

---

### 4.3 Cloudflare Workers

#### 役割

- 共有ページのホスト
- 共有ユーザー用ログイン
- セッション管理
- アルバム権限チェック
- R2上のmanifest読み取り
- R2上のthumb / preview返却
- 管理画面
- PhotoPrismアルバム設定
- Pi Docker Serviceへの同期ジョブ要求

#### やらないこと

- RAW現像
- 画像リサイズ
- EXIF削除
- 大量画像生成
- NASファイルの直接処理

---

### 4.4 Cloudflare R2

#### 役割

共有用に生成済みのファイルだけを保存する。

- 低解像度サムネイル
- 高解像度プレビュー
- アルバムmanifest
- カバー画像

#### R2に置かないもの

- RAW
- RW2
- JPEG原本
- 全写真ライブラリ
- PhotoPrism DB
- 位置情報付き原本

---

### 4.5 Cloudflare D1

#### 役割

Workers側の管理データを保存する。

- 共有ユーザー
- アルバム設定
- ユーザーごとのアルバム閲覧権限
- 同期ジョブ状態

---

## 5. ディレクトリ構成

```text
photo-gate/
├─ README.md
├─ docs/
│  ├─ architecture.md
│  ├─ deployment.md
│  ├─ security.md
│  └─ data-model.md
│
├─ workers/
│  ├─ package.json
│  ├─ package-lock.json
│  ├─ wrangler.toml
│  ├─ tsconfig.json
│  ├─ src/
│  │  ├─ index.ts
│  │  ├─ routes/
│  │  │  ├─ public.ts
│  │  │  ├─ auth.ts
│  │  │  ├─ albums.ts
│  │  │  ├─ images.ts
│  │  │  └─ admin.ts
│  │  ├─ services/
│  │  │  ├─ auth.ts
│  │  │  ├─ r2.ts
│  │  │  ├─ d1.ts
│  │  │  ├─ photoprism.ts
│  │  │  └─ sync-api.ts
│  │  ├─ templates/
│  │  │  ├─ layout.ts
│  │  │  ├─ login.ts
│  │  │  ├─ album-list.ts
│  │  │  ├─ album-view.ts
│  │  │  └─ admin.ts
│  │  ├─ middleware/
│  │  │  ├─ session.ts
│  │  │  ├─ admin-auth.ts
│  │  │  └─ security-headers.ts
│  │  └─ types/
│  │     ├─ album.ts
│  │     ├─ user.ts
│  │     ├─ manifest.ts
│  │     └─ env.ts
│  ├─ migrations/
│  │  ├─ 0001_init.sql
│  │  └─ 0002_sync_jobs.sql
│  └─ test/
│     ├─ auth.test.ts
│     ├─ album-permission.test.ts
│     └─ manifest.test.ts
│
├─ docker/
│  ├─ Dockerfile
│  ├─ docker-compose.example.yml
│  ├─ pyproject.toml
│  ├─ README.md
│  ├─ src/
│  │  └─ photo_gate/
│  │     ├─ __init__.py
│  │     ├─ main.py
│  │     ├─ config.py
│  │     ├─ api_server.py
│  │     ├─ photoprism_client.py
│  │     ├─ r2_client.py
│  │     ├─ image_processor.py
│  │     ├─ manifest.py
│  │     ├─ sync.py
│  │     ├─ cleanup.py
│  │     └─ models.py
│  ├─ tests/
│  │  ├─ test_manifest.py
│  │  ├─ test_image_processor.py
│  │  └─ test_sync_plan.py
│  └─ scripts/
│     ├─ run-local.sh
│     └─ sync-once.sh
│
└─ .github/
   └─ workflows/
      ├─ workers-ci.yml
      ├─ docker-ci.yml
      └─ release.yml
```

---

## 6. R2データ配置

R2 bucket名の例：

```text
photo-gate
```

R2内の配置：

```text
albums/
  {albumId}/
    manifest.json
    cover.webp
    thumbs/
      {photoId}.webp
    previews/
      {photoId}.jpg
```

例：

```text
albums/family-trip-2026/
  manifest.json
  cover.webp
  thumbs/
    pp_abc001.webp
    pp_abc002.webp
  previews/
    pp_abc001.jpg
    pp_abc002.jpg
```

---

## 7. 画像生成方針

### 7.1 thumb

| 項目 | 方針 |
|---|---|
| 用途 | 一覧表示 |
| 配置 | R2に常時配置 |
| 推奨サイズ | 長辺640px |
| 推奨形式 | WebP |
| EXIF | 削除 |

### 7.2 preview

| 項目 | 方針 |
|---|---|
| 用途 | クリック時の拡大表示 |
| 配置 | R2に事前配置 |
| 推奨サイズ | 長辺3000〜3840px |
| 推奨形式 | JPEG |
| EXIF | 削除 |

### 7.3 RAW / RW2

| 項目 | 方針 |
|---|---|
| 配置 | NASのみ |
| R2保存 | しない |
| 共有ユーザーへの提供 | 原則しない |

---

## 8. manifest.json

WorkersはR2上の `manifest.json` を読み取り、アルバム表示を構築する。

```json
{
  "schemaVersion": 1,
  "albumId": "family-trip-2026",
  "title": "家族旅行 2026",
  "source": {
    "type": "photoprism",
    "albumUid": "as6g7xxxxxxx"
  },
  "generatedAt": "2026-06-09T09:00:00+09:00",
  "images": {
    "thumb": {
      "longEdge": 640,
      "format": "webp",
      "quality": 80
    },
    "preview": {
      "longEdge": 3840,
      "format": "jpg",
      "quality": 88
    },
    "stripExif": true
  },
  "photos": [
    {
      "id": "pp_abc001",
      "title": "DSC00123",
      "thumb": "thumbs/pp_abc001.webp",
      "preview": "previews/pp_abc001.jpg",
      "takenAt": "2026-06-01T14:22:00+09:00",
      "width": 3840,
      "height": 2560
    }
  ]
}
```

### manifest更新ルール

manifestは最後に更新する。

```text
1. thumb生成
2. preview生成
3. R2へ画像アップロード
4. R2上の不要画像削除
5. manifest.json更新
```

これにより、manifestに載っている画像がR2上に存在しない状態を避ける。

---

## 9. Cloudflare D1データ設計

### 9.1 users

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

例：

```text
family
friends
event_2026_06
```

---

### 9.2 albums

```sql
CREATE TABLE albums (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  photoprism_album_uid TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  thumb_long_edge INTEGER NOT NULL DEFAULT 640,
  thumb_format TEXT NOT NULL DEFAULT 'webp',
  thumb_quality INTEGER NOT NULL DEFAULT 80,
  preview_long_edge INTEGER NOT NULL DEFAULT 3840,
  preview_format TEXT NOT NULL DEFAULT 'jpg',
  preview_quality INTEGER NOT NULL DEFAULT 88,
  strip_exif INTEGER NOT NULL DEFAULT 1,
  download_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

---

### 9.3 album_permissions

```sql
CREATE TABLE album_permissions (
  album_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (album_id, user_id)
);
```

---

### 9.4 sync_jobs

```sql
CREATE TABLE sync_jobs (
  id TEXT PRIMARY KEY,
  album_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  requested_by TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error TEXT
);
```

`status` 候補：

```text
queued
running
success
failed
cancelled
```

---

## 10. Workers API設計

### 10.1 閲覧者用API

```text
POST /api/login
POST /api/logout
GET  /api/me

GET  /api/albums
GET  /api/albums/:albumId
GET  /api/albums/:albumId/photos

GET  /img/:albumId/thumb/:photoId
GET  /img/:albumId/preview/:photoId
```

### 10.2 管理者用API

```text
GET    /admin
GET    /admin/api/photoprism/albums
GET    /admin/api/albums
POST   /admin/api/albums
PATCH  /admin/api/albums/:albumId
DELETE /admin/api/albums/:albumId

POST   /admin/api/albums/:albumId/sync
POST   /admin/api/albums/:albumId/cleanup
GET    /admin/api/jobs
GET    /admin/api/jobs/:jobId
```

---

## 11. Docker同期サービスAPI設計

Pi上のDockerサービスは、Workerから呼ばれる。

```text
GET  /health
POST /jobs/sync-album
POST /jobs/cleanup-album
GET  /jobs/:jobId
```

### 11.1 sync-album リクエスト

```json
{
  "jobId": "job_20260609_0001",
  "album": {
    "id": "family-trip-2026",
    "title": "家族旅行 2026",
    "photoprismAlbumUid": "as6g7xxxxxxx"
  },
  "image": {
    "thumb": {
      "longEdge": 640,
      "format": "webp",
      "quality": 80
    },
    "preview": {
      "longEdge": 3840,
      "format": "jpg",
      "quality": 88
    },
    "stripExif": true
  },
  "deleteMissing": true
}
```

### 11.2 job status

```json
{
  "jobId": "job_20260609_0001",
  "status": "running",
  "albumId": "family-trip-2026",
  "total": 120,
  "processed": 42,
  "uploaded": 40,
  "skipped": 2,
  "deleted": 0,
  "error": null
}
```

---

## 12. Docker同期処理フロー

```text
1. sync-albumジョブを受信
2. PhotoPrism APIからアルバム内写真一覧を取得
3. R2上のmanifest.jsonを取得
4. 差分計算
5. 生成が必要な写真を抽出
6. NAS/PhotoPrismから元画像を取得
7. thumb生成
8. preview生成
9. EXIF削除
10. R2へアップロード
11. 不要ファイル削除
12. manifest.json更新
13. ジョブ完了通知
```

### 推奨画像処理ライブラリ

```text
Python + pyvips
```

理由：

- Raspberry Piでも比較的軽い
- 大きい画像の処理に強い
- Pillowよりメモリ効率が良い

初期実装ではPillowでも可。

---

## 13. Dockerイメージ設計

### 13.1 イメージ名

GitHub Container Registryを使用する。

```text
ghcr.io/<owner>/photo-gate-sync:latest
ghcr.io/<owner>/photo-gate-sync:v0.1.0
```

例：

```text
ghcr.io/iniwaiwana/photo-gate-sync:latest
```

### 13.2 対応アーキテクチャ

Pi運用を前提に、最低限以下を対応する。

```text
linux/arm64
```

開発PCでも動かすなら、multi-arch buildにする。

```text
linux/amd64
linux/arm64
```

推奨は以下。

```text
linux/amd64
linux/arm64
```

---

## 14. Dockerfile案

```dockerfile
FROM python:3.12-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips \
    libvips-tools \
    ca-certificates \
    curl \
  && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY src ./src

RUN pip install --no-cache-dir .

ENV PYTHONUNBUFFERED=1

EXPOSE 8080

CMD ["photo-gate-sync", "serve", "--host", "0.0.0.0", "--port", "8080"]
```

---

## 15. docker-compose.example.yml

```yaml
services:
  photo-gate-sync:
    image: ghcr.io/iniwaiwana/photo-gate-sync:latest
    restart: unless-stopped
    environment:
      PHOTOPRISM_URL: "https://photos.example.com"
      PHOTOPRISM_USERNAME: "${PHOTOPRISM_USERNAME}"
      PHOTOPRISM_PASSWORD: "${PHOTOPRISM_PASSWORD}"

      CF_ACCESS_CLIENT_ID: "${CF_ACCESS_CLIENT_ID}"
      CF_ACCESS_CLIENT_SECRET: "${CF_ACCESS_CLIENT_SECRET}"

      R2_ENDPOINT_URL: "${R2_ENDPOINT_URL}"
      R2_ACCESS_KEY_ID: "${R2_ACCESS_KEY_ID}"
      R2_SECRET_ACCESS_KEY: "${R2_SECRET_ACCESS_KEY}"
      R2_BUCKET: "photo-gate"

      SYNC_API_TOKEN: "${SYNC_API_TOKEN}"

    volumes:
      - ./cache:/app/cache
      - /path/to/photos:/mnt/photos:ro

    ports:
      - "127.0.0.1:8080:8080"
```

Cloudflare Tunnelを使う場合、Tunnelの向き先を `127.0.0.1:8080` にする。

---

## 16. GitHub Actions

GitHub Actionsでは、以下を自動化する。

```text
workers:
  lint
  typecheck
  test
  build

docker:
  lint
  test
  build
  multi-arch build
  GHCRへpush
```

---

### 16.1 .github/workflows/docker-ci.yml

```yaml
name: Docker CI

on:
  push:
    branches:
      - main
    paths:
      - "docker/**"
      - ".github/workflows/docker-ci.yml"
  pull_request:
    paths:
      - "docker/**"
      - ".github/workflows/docker-ci.yml"
  workflow_dispatch:

env:
  IMAGE_NAME: ghcr.io/${{ github.repository_owner }}/photo-gate-sync

jobs:
  test:
    name: Test docker app
    runs-on: ubuntu-latest

    defaults:
      run:
        working-directory: docker

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install system dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y libvips libvips-tools

      - name: Install package
        run: |
          pip install -U pip
          pip install -e ".[dev]"

      - name: Run tests
        run: |
          pytest

  build-and-push:
    name: Build and push Docker image
    runs-on: ubuntu-latest
    needs: test

    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract Docker metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.IMAGE_NAME }}
          tags: |
            type=raw,value=latest,enable={{is_default_branch}}
            type=sha,prefix=sha-
            type=ref,event=tag

      - name: Build Docker image
        uses: docker/build-push-action@v6
        with:
          context: ./docker
          file: ./docker/Dockerfile
          platforms: linux/amd64,linux/arm64
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
```

---

### 16.2 .github/workflows/workers-ci.yml

```yaml
name: Workers CI

on:
  push:
    branches:
      - main
    paths:
      - "workers/**"
      - ".github/workflows/workers-ci.yml"
  pull_request:
    paths:
      - "workers/**"
      - ".github/workflows/workers-ci.yml"
  workflow_dispatch:

jobs:
  workers-ci:
    runs-on: ubuntu-latest

    defaults:
      run:
        working-directory: workers

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
          cache-dependency-path: workers/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: Typecheck
        run: npm run typecheck

      - name: Test
        run: npm test

      - name: Build
        run: npm run build
```

---

### 16.3 .github/workflows/release.yml

```yaml
name: Release

on:
  push:
    tags:
      - "v*.*.*"

env:
  IMAGE_NAME: ghcr.io/${{ github.repository_owner }}/photo-gate-sync

jobs:
  docker-release:
    runs-on: ubuntu-latest

    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract Docker metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=tag
            type=raw,value=latest

      - name: Build and push release image
        uses: docker/build-push-action@v6
        with:
          context: ./docker
          file: ./docker/Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
```

---

## 17. デプロイ運用

### 17.1 Docker

Pi側では以下で更新する。

```bash
docker compose pull
docker compose up -d
```

開発中は `latest` を利用する。

```yaml
image: ghcr.io/iniwaiwana/photo-gate-sync:latest
```

安定運用時はタグ固定を推奨する。

```yaml
image: ghcr.io/iniwaiwana/photo-gate-sync:v0.1.0
```

---

### 17.2 Workers

初期は手動デプロイを推奨する。

```bash
cd workers
npx wrangler deploy
```

D1 migrationやR2 binding確認後、GitHub Actionsで自動デプロイ化する。

---

## 18. 環境変数・Secrets

### 18.1 Workers側

`wrangler secret` で登録する。

```text
SYNC_API_TOKEN
CF_ACCESS_CLIENT_ID
CF_ACCESS_CLIENT_SECRET
PHOTOPRISM_URL
SYNC_API_URL
```

R2/D1は `wrangler.toml` のbindingで設定する。

```toml
[[r2_buckets]]
binding = "PHOTO_BUCKET"
bucket_name = "photo-gate"

[[d1_databases]]
binding = "DB"
database_name = "photo-gate"
database_id = "..."
```

---

### 18.2 Docker側

`.env` で管理する。

```env
PHOTOPRISM_URL=https://photos.example.com
PHOTOPRISM_USERNAME=...
PHOTOPRISM_PASSWORD=...

CF_ACCESS_CLIENT_ID=...
CF_ACCESS_CLIENT_SECRET=...

R2_ENDPOINT_URL=https://<account_id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=photo-gate

SYNC_API_TOKEN=...
```

---

## 19. セキュリティ方針

### 19.1 PhotoPrism

```text
Cloudflare Access配下を徹底
一般閲覧者はアクセス不可
Worker / Pi DockerのみService Tokenで通過
```

### 19.2 Pi Sync API

```text
外部公開しない
Cloudflare Tunnel経由
Cloudflare Accessで保護
WorkerからのService Tokenのみ許可
SYNC_API_TOKENでも二重認証
```

### 19.3 R2

```text
public bucketにしない
Worker経由でのみ画像配信
R2の直URLは使わない
```

### 19.4 画像

```text
RW2 / RAWはR2に置かない
EXIF削除済みthumb / previewのみR2へ置く
GPS情報を出さない
```

---

## 20. ワークフロー

### 20.1 管理者による共有設定

```text
1. 管理者が /admin にアクセス
2. PhotoPrismアルバム一覧を取得
3. 共有対象アルバムを選択
4. 見せるユーザーを指定
5. thumb / preview設定を確認
6. 同期ジョブを実行
7. Pi Docker ServiceがR2へ生成済み画像を配置
```

---

### 20.2 共有ユーザーによる閲覧

```text
1. 共有ユーザーが share.example.com にアクセス
2. ID/パスワードでログイン
3. WorkersがD1で認証
4. Workersが閲覧可能アルバムを判定
5. R2のmanifestを読み込む
6. R2のthumbを一覧表示
7. 写真クリック時にR2のpreviewを表示
```

---

### 20.3 同期処理

```text
1. Worker管理画面からsync-albumを要求
2. Pi Docker ServiceがPhotoPrism APIから写真一覧を取得
3. R2 manifestと差分比較
4. 必要なthumb / previewを生成
5. EXIF削除
6. R2へアップロード
7. 不要ファイル削除
8. manifest更新
9. ジョブ状態を更新
```

---

## 21. 初期実装フェーズ

### Phase 1: Docker同期処理

```text
docker/ を作る
PhotoPrismアルバムを1つ指定
thumb / preview生成
R2へアップロード
manifest.json生成
```

### Phase 2: Workers閲覧ページ

```text
workers/ を作る
R2 manifestを読む
アルバム一覧
写真一覧
thumb / preview表示
```

### Phase 3: 認証・権限

```text
D1 users
D1 albums
D1 album_permissions
共有ユーザーログイン
アルバム出し分け
```

### Phase 4: 管理画面

```text
PhotoPrismアルバム一覧取得
共有アルバム登録
ユーザー割り当て
同期ボタン
同期ジョブ表示
```

### Phase 5: CI/CD

```text
workers-ci
docker-ci
GHCR push
release tag
```

---

## 22. 今回決定した重要事項

```text
プロジェクト名:
  photo-gate

フォルダ構成:
  photo-gate/workers/**
  photo-gate/docker/**

Workers:
  ページ/API/管理画面
  R2の生成済みデータを返す
  画像生成しない

Docker:
  Raspberry Pi上で動作
  PhotoPrism/NASから画像取得
  thumb/previewを全件生成
  R2へ同期

R2:
  thumb
  preview
  manifest

R2に置かない:
  RW2
  RAW
  全原本

GitHub Actions:
  workers CI
  docker CI
  docker multi-arch build
  GHCR push
```

---

## 23. 今後詰める項目

- Workers側のUI実装方針
  - HTMLテンプレート直書き
  - Hono + JSX
  - Workers Assets + SPA
- 管理者認証方式
  - Cloudflare Access
  - Worker独自ログイン
- 共有ユーザーの単位
  - family
  - friends
  - event_xxx
- PhotoPrism APIの実際の取得項目確認
- Pi側で原本を読む方法
  - PhotoPrism API経由
  - NASマウント経由
- 画像処理ライブラリ
  - pyvips
  - Pillow
  - ImageMagick
- R2削除の安全設計
  - 即削除
  - dry-run
  - trash prefix
- Workers自動デプロイのタイミング
