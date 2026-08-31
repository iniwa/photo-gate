# 今後の実装候補

## プレビュー画面
- [x] ログイン後、プレビュー画面の作成
  - 画像単体のページを開く
  - 次の画像に送る
  - 一覧に戻る
  - ダウンロードボタン表示
  - 補足: UIデザイン調整やメタデータ表示は別タスクでまとめて扱う。

## ダウンロード
- [x] 既存R2ストレージ上の生成済み画像をダウンロード
  - 低画質: `thumb` WebP
  - 高画質: `preview` JPEG
  - 実装済み: `GET /download/:albumId/thumb/:photoId`
  - 実装済み: `GET /download/:albumId/preview/:photoId`
  - RAW/original へのリンク・ルートは未実装。

- [ ] RAWデータのダウンロード（保留・別ADR必要）
  - 当初案: NASから元データをダウンロードする。
  - 当初案: RAW画像 / 高画質JPEG / プレビュー用画像から選べるようにする。
  - 現在の決定: `docs/decisions/2026-07-03-download-variants-and-raw-boundary.md` により、共有ビューアでのRAW/originalダウンロードは未実装のまま保留。
  - 理由: 既存の境界では、Workers は NAS/PhotoPrism/RAW/original にアクセスしない。R2にもRAW/RW2/original/location-bearing sourceを置かない。
  - 次に行うこと: RAW/original export を許可するか、許可するなら誰に・どの経路で・どの監査/確認付きで行うかを別ADRで決める。

- [x] 一覧から複数選択してダウンロードするUI
  - thumb/preview の単体ダウンロードに加え、アルバム詳細で1〜100枚を選択できる。
  - JavaScript有効時は、最大20枚の選択済みthumb/previewをブラウザ内で1つの無圧縮ZIPにまとめて保存できる。Workersは既存の認可済み個別ダウンロードだけを返し、ZIP生成・画像処理は行わない。
  - 1枚25 MiB、ZIP合計100 MiBの上限を超える場合は中止し、従来のリンク一覧を使う。JavaScript無効時も `POST /download/:albumId/selection` が選択内容をマニフェストで検証して個別リンクを表示する。
  - RAW/original を含める場合は、先にRAW/original ADRが必要。

## admin画面
- [ ] 全体的にUIの調整（要設計）

### 権限一覧
- [ ] 現状の一覧は分かりにくいため、表示構成を調整したい
  - 「ユーザー一覧」とまとめて、ユーザー詳細の中に許可権限一覧を同梱する案
  - UI要設計
