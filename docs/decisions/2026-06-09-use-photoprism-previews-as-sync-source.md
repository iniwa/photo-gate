# PhotoPrism生成previewを同期元として使う

## Context

Pi Docker ServiceでRAWや原本からthumb / previewを生成する代わりに、PhotoPrismが作成したサムネイルおよびRAW変換済み画像を利用できるか調査した。

確認結果:

- PhotoPrismはRAW等をindex/import時にJPEG/PNG sidecarへ変換し、thumbnail生成に利用する。
- `GET /api/v1/photos?s={albumUid}&primary=true...` でアルバム写真とprimary fileのSHA1 `Hash` を取得できる。
- 写真検索レスポンスの `X-Preview-Token` と `Hash` を使い、`GET /api/v1/t/{hash}/{token}/{size}` から `fit_720`、`fit_1920`、`fit_3840` 等を取得できる。
- 高解像度thumbnailはPhotoPrism設定により事前生成またはオンデマンド生成され、最大サイズ制限がある。
- PhotoPrism公式デモから取得した `fit_1920` にはEXIF metadata blockが残っていた。PhotoPrism生成画像が常にメタデータ除去済みであるとは扱えない。
- PhotoPrismはRAWまたはXMP変更時に関連JPEG sidecarを自動再生成しない。

## Decision

- Pi Docker ServiceはPhotoPrism Thumbnail APIの生成済みpreviewを通常の同期元として使う。
- thumbには `fit_720`、previewには `fit_3840` を基本入力とする。
- 取得したPhotoPrism生成画像はR2へ直接コピーせず、必ずPi側で再エンコードする。
- 再エンコード後、EXIF / XMP / IPTC / GPS等が残っていないことを検証してからR2へアップロードする。
- RAW現像と原本取得を通常経路から除外する。
- PhotoPrism側でRAW現像結果を更新した場合は、sidecar更新・再変換後にphoto-gate同期を行う。

## Constraints Introduced

- PhotoPrismのpreview最大サイズとオンデマンド生成設定をデプロイ前に確認する。
- 最大サイズ不足時に暗黙で原本へfallbackしない。
- PhotoPrism APIには公式deprecation policyがないため、API契約を統合テストで確認する。
- 原本取得fallbackを追加する場合は、責務・負荷・セキュリティを再検討する。

## Sources

- https://docs.photoprism.app/developer-guide/api/search/
- https://docs.photoprism.app/developer-guide/api/thumbnails/
- https://docs.photoprism.app/developer-guide/media/raw/
- https://docs.photoprism.app/getting-started/config-options/
- https://docs.photoprism.app/getting-started/faq/
