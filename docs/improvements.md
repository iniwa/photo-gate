# プログラム改善チェックリスト

コードベースを調査して洗い出した改善候補の一覧(初回作成: 2026-07-08)。

**運用方法**: 着手したい項目にチェック `[x]` を入れる → Codex が要件・
保護境界・検証を確認し、必要なら handoff (`docs/handoffs/`)を作成する。
設計が確定した複数ステップの実装は、原則として native
`bounded_implementer` 1名に一貫して委譲する。小粒で会話依存の作業は
primary session が直接扱ってよい。チェックは候補選択を示すだけで、push、
deploy、本番変更、保護情報アクセス、破壊的操作の承認にはならない。
実装完了した項目は「完了アーカイブ」へ移動する。

- 機能追加・未検証項目はこのファイルの対象外(`docs/iniwa-issues.md` で管理)。
- UI リデザイン Phase 4(admin restyle + `styles.css` 削除)は
  `docs/decisions/2026-07-03-ui-redesign.md` のロードマップ項目であり、
  このファイルでは扱わない。
- 優先度: **高** = 稼働中の安定性に直結 / **中** = 保守性・性能 / **低** = 任意。

---

## 1. Workers (TypeScript / Hono)

- [x] **【中】`src/routes/admin.tsx` を機能別ルーターに分割する**
  - 現状: 1800 行・route ハンドラ 27 個(GET 7 / POST 20)。ユーザー管理・
    アルバム管理・権限管理・sync 管理・ops サマリ・カタログピッカー・
    R2 cleanup レポートの 7 責務が同居。ハードデリート
    (`admin-hard-delete.tsx` 417 行)と R2 cleanup 削除
    (`admin-r2-cleanup-delete.tsx` 323 行)は既に別ファイルに分割済みで
    パターンが存在する。
  - 対応案: 既存の分割パターンに従い、users / albums / permissions / sync /
    ops の単位でファイルを分け、`createAdminRoutes` で合成する。
    挙動不変の機械的分割。
  - 制約: ルート・レスポンス・認可チェーン(Access JWT + allowlist →
    same-origin → Content-Type → フィールド検証)を一切変えない。
    既存の認可・レスポンス契約を維持し、全体テストで回帰がないこと。
  - 完了: 2026-08-13。`admin.tsx` はAccess guard・合成・破壊的確認ルートに限定し、inventory、sync、通常mutation、form validationを専用モジュールへ抽出した。巨大な既存テストファイルの分割は次項として残す。

- [ ] **【低】`test/admin-routes.test.ts` を admin.tsx の分割に合わせて分割する**
  - 現状: 6534 行(テスト全体 23906 行の 27%)。単一ファイルで
    admin 全サーフェスを検証しており、追記のたびに肥大化する。
  - 対応案: admin.tsx の分割単位に対応するテストファイルへ機械的に移動。
    上記【中】項目と同一 handoff で実施してよい。
  - 制約: テスト内容・件数を変えない(移動のみ)。

- [ ] **【低】Workers 側のテストカバレッジ計測手段を用意する**
  - 現状: `@vitest/coverage-v8` が devDependencies に無く、カバレッジを
    一度も計測できていない(2026-07-08 時点でテスト 2528 件 / 40 ファイル
    は全合格だが、行カバレッジは不明)。Docker 側は pytest-cov で 84% と
    計測済み。
  - 対応案: devDependency として `@vitest/coverage-v8` を追加し
    `npm run coverage` スクリプトを定義する(CI には組み込まない)。
    依存追加を伴うため、承認済みのタスク範囲と既存方針に沿って
    依存・ビルドへの影響を明示して検証し、重要な変更として報告する。
  - 制約: CI ワークフローと本番依存(dependencies)には変更を加えない。

## 2. Docker sync (Python)

- [ ] **【中】`src/photo_gate/main.py` を責務別モジュールに分割する**
  - 現状: 1037 行(docker/src 全体 2764 行の 38%)。ロギング設定・CLI
    引数解析・sync-once 実行・マルチターゲット実行・publish-catalog 実行・
    daemon ループ・sync リクエスト消費・ステータス発行ヘルパーが同居。
  - 対応案: 挙動不変の機械的分割。例: `runners.py`(run_sync_once /
    multi-target / publish-catalog)と `daemon.py`(daemon ループ・
    リクエスト消費・ステータス発行)を切り出し、`main.py` は CLI 解析と
    ディスパッチのみ残す。
  - 制約: CLI インターフェース・ログ出力(サニタイズ規約含む)・終了コードを
    変えない。既存テスト 441 件(+46 skip)が無修正で通ること。
    ログへの URL/トークン/UID 漏えい防止の既存対策
    (`_NOISY_LOGGER_NAMES`・`_describe_error`)を移動時に壊さない。

- [ ] **【低】`r2_store.py` の boto3 Config に明示的な timeout / retry 設定を追加する**
  - 現状: `r2_store.py:155-158` の `Config` は `signature_version` と
    `addressing_style` のみ指定で、`connect_timeout` / `read_timeout` /
    `retries` は botocore デフォルト(60s / 60s / legacy モード)に依存。
    PhotoPrism 側 httpx クライアントは明示 timeout 済み
    (`photoprism_client.py:78`)なのに対し非対称。
  - 対応案: `connect_timeout` / `read_timeout` と
    `retries={"mode": "standard"}` を明示する。実質挙動はほぼ不変
    (デフォルト依存の明示化)。
  - 制約: Pi 上の実運用アップロード(数 MB の preview JPEG)が
    タイムアウトしない値にする。CI の container-test が通ること。

---

## 完了アーカイブ

(なし)
