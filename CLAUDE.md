# CLAUDE.md

## Purpose

このファイルは、Claude Codeが`photo-gate`で実装作業を行う際の実行ルールである。編集前に `AGENTS.md` と `photo-gate-design.md` を読み、handoffパスが指定されている場合はそのhandoffも読む。

ユーザーが日本語で依頼した場合は日本語で応答する。

## Current State

- 現在は設計フェーズで、リポジトリには設計書のみが存在する。
- 予定構成は `workers/` と `docker/` の2コンポーネント。
- 未作成のファイル、コマンド、依存関係が存在する前提で進める。
- 設計書のPhase 1から順に実装し、後続フェーズを無断で先行実装しない。

## Execution Rules

- handoffがある場合は、handoff、`AGENTS.md`、既存コード規約の順に従う。
- 変更範囲を小さく保ち、既存の責務境界を維持する。
- 設計変更、handoff外の大幅編集、依存追加、schema/API互換性変更が必要なら編集前に確認する。
- secrets、資格情報、`.env`、実値入り設定を読み書き・コミットしない。
- 明示依頼なしにcommit、push、deploy、migration適用、R2削除、Portainer/Cloudflare設定変更を行わない。
- 既存のユーザー変更を戻さない。
- 作業開始時と完了時に `git status --short` を確認する。

## Architecture Rules

- 通常閲覧はWorkers + 非公開R2で完結させる。
- Workersで画像生成、EXIF削除、NAS直接処理を行わない。
- Docker同期サービスで共有UI、閲覧者認証、共有ユーザーへの直接配信を行わない。
- PhotoPrism / NASの原本を共有ユーザーへ公開しない。
- R2へ置けるのはEXIF削除済みthumb / preview / coverとmanifestだけ。
- PhotoPrism生成previewにもEXIF metadata blockが残り得るため、そのままR2へコピーしない。必ず再エンコードし、EXIF / XMP / IPTC / GPS等の除去を検証する。
- RAW、RW2、JPEG原本、PhotoPrism DB、位置情報付き原本をR2へ置かない。
- manifestは画像アップロードと不要画像処理の後、最後に更新する。
- cleanupは高リスク処理として扱い、安全方式が確定するまで保護策なしの削除を実装しない。

## Component Guidance

### `workers/`

- TypeScript、Node.js 22、npm、Cloudflare Workers / R2 / D1を前提とする。
- 認証、セッション、アルバム単位の認可、入力検証を明示的に実装する。
- R2をpublic bucketにせず、画像をWorkers経由で返す。
- UI方式と管理者認証方式は未決定。関連実装前に確認する。

### `docker/`

- Python 3.12、Raspberry Pi 4 `linux/arm64`で動作する軽量な実装にする。
- 画像処理はメモリ効率を重視し、pyvipsを第一候補とする。
- 通常の生成元はPhotoPrism Thumbnail APIとし、写真検索APIの `Hash` と `X-Preview-Token` を使う。
- RAW現像や原本取得を通常経路へ追加しない。PhotoPrism / NAS原本取得fallbackが必要なら実装前に確認する。
- 同期は再実行可能にし、差分計算で不要な処理を避ける。
- Pi向け設定では `restart: unless-stopped` と `TZ=Asia/Tokyo` を維持する。
- 最大previewサイズ不足時の挙動、原本取得fallback、R2削除方式は未決定。関連実装前に確認する。

## Planned Verification

設定ファイルが存在する場合、変更対象に応じて実行する。

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
docker build -t photo-gate-sync:local .
```

実行できない検証は、理由とともに報告する。デプロイや実環境を変更する検証は行わない。

## Stop And Ask

以下の場合は編集を止め、質問する。

- `AGENTS.md` または設計書の責務・セキュリティ方針に反する。
- 未決定事項の選択が必要。
- handoff外のファイル変更が必要。
- public R2、原本配信、PhotoPrism直接公開につながる。
- secretsや実環境設定へのアクセスが必要。
- 破壊的なR2削除、migration、deploy、pushが必要。

## Handoff Lifecycle

- Read active handoffs from `docs/handoffs/`.
- Do not move or archive the handoff during implementation.
- Codex moves a handoff to `docs/handoffs/archive/` only after review, acceptance, and commit.
- Treat archived handoffs as historical context, not active instructions.

## Expected Report

作業完了時は簡潔に以下を報告する。

- 変更ファイル
- 実装概要
- 検証結果
- 実行できなかった検証と理由
- Codexへ戻すべき設計上の質問

詳細な設計判断は `docs/decisions/`、handoffは `docs/handoffs/`、再利用可能な技術・運用情報は `docs/*.md` に残す。
