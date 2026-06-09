# AGENTS.md

## Project Summary

- Project: `photo-gate`
- Purpose: PhotoPrism / NAS の写真を、PhotoPrism本体や原本を共有ユーザーへ公開せず、安全に配信する写真共有ゲートウェイ
- Repository: `D:/Git/photo-gate`
- Development host: Windows 11 Sub PC
- Runtime targets:
  - Cloudflare Workers + R2 + D1
  - Raspberry Pi 4 (8GB RAM, `linux/arm64`) 上のDocker同期サービス
- Primary design source: `photo-gate-design.md`

現時点では設計フェーズであり、実装ディレクトリや各種コマンドはまだ作成されていない。実装時は設計書のPhase 1から順に進める。

## Architecture Invariants

通常の写真閲覧はCloudflare Workersと非公開R2だけで完結させる。

- PhotoPrism / NASは原本とアルバムの管理に専念する。
- 共有ユーザーをPhotoPrismへ直接アクセスさせない。
- PhotoPrism共有リンクを一般共有の仕組みとして使わない。
- Workersは認証、権限判定、ページ/API/管理画面、R2上の生成済みデータ配信を担当する。
- WorkersでRAW現像、画像リサイズ、EXIF削除、大量画像生成、NASファイルの直接処理を行わない。
- Pi Docker同期サービスはPhotoPrism Thumbnail APIの生成済みpreviewを優先的に取得し、共有用画像への再エンコード、メタデータ除去、R2同期、manifest生成を担当する。
- Pi Docker同期サービスは共有ページ、閲覧者認証、共有ユーザーへの直接配信を担当しない。
- D1は共有ユーザー、アルバム設定、閲覧権限、同期ジョブ状態を保持する。

責務境界を変更する実装は、コード編集前に設計判断として確認する。

## Security And Privacy Invariants

- R2 bucketは公開しない。画像はWorkers経由でのみ返す。
- R2にRAW、RW2、JPEG原本、全写真ライブラリ、PhotoPrism DB、位置情報付き原本を置かない。
- R2へ置ける画像はEXIFを削除した共有用thumb / preview / coverに限る。
- PhotoPrism生成previewにもEXIF metadata blockが残り得るため、R2へそのままコピーしない。Pi側で必ず再エンコードし、EXIF / XMP / IPTC / GPS等が残っていないことを検証する。
- PhotoPrismはCloudflare Access配下に置き、WorkerまたはPiサービスだけがService Token等で到達する。
- Pi同期APIは直接外部公開しない。Cloudflare Tunnel + Access + Service Token + `SYNC_API_TOKEN` で保護する。
- secrets、資格情報、`.env`、実値入りローカル設定をコミットしない。
- 認証、認可、R2キー構築では、ユーザー入力を信用せずalbum/photo権限を必ず検証する。

## Data Consistency Rules

R2の標準配置を維持する。

```text
albums/{albumId}/manifest.json
albums/{albumId}/cover.webp
albums/{albumId}/thumbs/{photoId}.webp
albums/{albumId}/previews/{photoId}.jpg
```

- `manifest.json` の `schemaVersion` は明示し、互換性を壊す変更は設計判断として扱う。
- 同期では画像アップロードと不要画像処理を終えてから、最後にmanifestを更新する。
- manifestが参照するファイルがR2に存在しない状態を公開しない。
- R2削除処理は高リスク。安全方式が確定するまで、dry-runまたは明示的な保護策なしに破壊的削除を実装しない。
- 同期処理は再実行可能にし、同一入力に対する不要な再生成・再アップロードを避ける。
- PhotoPrism APIの写真 `Hash` と `X-Preview-Token` を使ってThumbnail APIから取得する。通常経路でRAW現像や原本取得を行わない。
- PhotoPrismはRAW/XMP変更時に関連JPEG sidecarを自動再生成しないため、PhotoPrism側の再変換後にphoto-gate同期を行う。

## Planned Repository Boundaries

```text
workers/   # TypeScript: Cloudflare Workers、共有UI、管理UI、API、D1/R2連携
docker/    # Python 3.12: Pi同期API、PhotoPrism/R2 client、画像処理、manifest、cleanup
docs/      # アーキテクチャ、デプロイ、セキュリティ、データモデル、判断記録
```

- WorkersとDocker間の契約はHTTP APIおよびmanifest schemaとして明示する。
- 両コンポーネントで共有する概念は、暗黙に重複させず契約・型・テストで整合性を確認する。
- WorkersからNASや原本へ到達する依存を追加しない。
- Docker側に閲覧者向け機能やD1依存を追加しない。

## Planned Technology And Deployment

### Workers

- Node.js 22
- TypeScript
- Cloudflare Workers / R2 / D1
- package manager: npm
- 初期デプロイは `npx wrangler deploy` による手動実行
- UI方式と管理者認証方式は未決定。実装前に確認する。

### Docker Sync Service

- Python 3.12
- 画像処理はpyvips推奨。初期実装ではPillowも可だが、採用前に依存性とPi上のメモリ使用量を確認する。
- image: `ghcr.io/iniwaiwana/photo-gate-sync`
- multi-arch: `linux/amd64,linux/arm64`
- Pi運用では `restart: unless-stopped` と `TZ=Asia/Tokyo` を設定する。
- 原則としてPhotoPrism Thumbnail APIを生成元にする。最大previewサイズ不足時の挙動と、原本取得fallbackを提供するかは未決定。

### Delivery

- Workers CI: lint、typecheck、test、build
- Docker CI: lint、test、build、multi-arch build、GHCR push
- Docker安定運用ではバージョンタグ固定を推奨する。
- Workers自動デプロイのタイミングは未決定。勝手に自動化しない。
- Cloudflare Tunnel、Access、R2/D1 binding、Portainer Stackなど運用設定を無断で変更しない。

## Implementation Order

設計書のフェーズ順を基本とする。

1. Docker同期処理
2. Workers閲覧ページ
3. 認証・権限
4. 管理画面
5. CI/CD

後続フェーズのために必要以上の先行実装を行わない。

## Verification Expectations

実装後は、変更したコンポーネントに応じて以下を実行する。コマンドは各設定ファイル作成後に有効になる予定。

```powershell
Set-Location workers
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

```powershell
Set-Location docker
python -m pip install -e ".[dev]"
python -m pytest
```

Docker関連変更では、可能な範囲で次も確認する。

```powershell
docker build -t photo-gate-sync:local docker
docker buildx build --platform linux/amd64,linux/arm64 docker
```

- セキュリティ境界、権限判定、manifest整合性、同期差分、EXIF削除、削除保護には重点的にテストを追加する。
- 実行できない検証は省略せず、理由を報告する。
- デプロイ、push、実環境のmigration適用は明示依頼なしに行わない。

## Codex / Claude Code Workflow

Codexは要件整理、設計判断、責務境界の維持、handoff作成、実装レビューを担当する。Claude Codeは明確で限定されたhandoffに従い、実装・検証・結果報告を担当する。

handoffを行う場合は `docs/handoffs/YYYY-MM-DD-<short-task>.md` を作成し、最低限以下を記載する。

- Goal
- Background
- Files To Inspect
- Files To Edit
- Constraints
- Non Goals
- Verification
- Expected Report

Claude Codeは、handoff外の編集、設計変更、依存追加、デプロイ変更、secret操作が必要になった場合は編集前に停止して確認する。

## Review Checklist

- Workers / Docker / PhotoPrism / R2 / D1の責務境界を守っているか。
- 原本、RAW/RW2、EXIF/GPS、R2公開設定を誤って露出していないか。
- 認証だけでなくアルバム単位の認可を全経路で確認しているか。
- manifestを最後に更新し、参照切れを公開しないか。
- cleanupが意図しないalbum/prefixを削除できないか。
- API、manifest、D1 schemaの変更に互換性とmigrationがあるか。
- Pi 4のarm64互換性とメモリ制約を考慮しているか。
- 必要なテストと検証が実行され、未実行事項が説明されているか。

## Knowledge Persistence

- `AGENTS.md` には短く耐久性のあるルールを残す。
- 詳細な設計や運用手順は `docs/*.md` に残す。
- 設計判断の経緯は `docs/decisions/` に残す。
- 実装handoffは `docs/handoffs/` に残す。
- `photo-gate-design.md` と実装がずれる場合、黙ってコードだけを変更せず、関連ドキュメントも更新する。

## Handoff Lifecycle

- Active handoffs live directly under `docs/handoffs/`.
- After a handoff implementation is reviewed, accepted, and committed, move its handoff file to `docs/handoffs/archive/`.
- Do not archive incomplete, blocked, or unreviewed handoffs.
- Archived handoffs remain tracked as implementation history.

## Open Design Decisions

以下は未決定であり、関連実装前に確認が必要。

- Workers UI方式
- 管理者認証方式
- 共有ユーザーの単位
- PhotoPrism APIの実際の取得項目
- 画像処理ライブラリ
- PhotoPrism Thumbnail APIの最大サイズ不足時の挙動
- PhotoPrism / NAS原本取得fallbackを提供するか
- R2削除の安全方式
- Workers自動デプロイのタイミング
