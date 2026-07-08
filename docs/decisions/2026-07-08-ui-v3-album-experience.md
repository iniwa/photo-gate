# UI v3 設計案: 「写真アルバムツール」としての体験再構築

Date: 2026-07-08
Status: **Accepted (Codex review complete 2026-07-08)**。
§6 の要決定事項はすべてオペレーターが決定済み。Codex review では
AGENTS.md の不変条件、既存 Dark Gallery ADR、現在の Worker 実装と照合し、
静的アセット以外の公開ルート・認証・認可・R2/manifest membership・
download gating・CSP/セキュリティヘッダーを変えない前提で採用する。

前提 ADR: `2026-07-03-ui-redesign.md`(Dark Gallery)。本設計案はその
トークン体系・ダーク基調・progressive enhancement 方針を**維持**し、
画面の情報設計と体験を作り直す。

---

## 1. 現状評価 — なぜ作り直すか

Dark Gallery(Phase 1–3 実装済み)で「見た目」は写真向けになったが、
**情報設計はまだ「ファイル一覧ビューア」のまま**であり、
「写真アルバムツール」として不足がある。

### 1.1 使われていないデータ

マニフェスト(schemaVersion 1/2)は写真ごとに次を保持しているが、
現行 UI は `id` と `title` しか使っていない:

| フィールド | 現状 | 活用余地 |
|---|---|---|
| `takenAt`(TZ 付き ISO 8601) | **未使用** | 日付グルーピング・撮影日時表示 |
| `width` / `height` | **未使用** | 非クロップ表示・CLS 防止・レイアウト最適化 |
| `photos[]` の順序 | 前後ナビのみ | タイムライン構造 |

### 1.2 体験上の問題

1. **時系列が存在しない。** アルバムは運動会・旅行などイベントの記録
   なのに、日付見出しも撮影日時もどこにも出ない。
2. **正方形クロップが構図を壊す。** contact-sheet は全写真を正方形に
   切り抜くため、縦写真・パノラマの内容が判別しにくい。
3. **ページ遷移がぶつ切り。** サムネイル→プレビュー、前へ/次へが
   毎回白紙からの再描画に見え、「アプリで写真をめくる」感覚がない。
4. **プレビューが素っ気ない。** 撮影日時なし。prefetch は次の1枚のみ
   (ADR §6 の残課題)。`width`/`height` 属性がなく表示までレイアウト
   が不定。
5. **選択 UI が常時出ている。** 閲覧が主目的なのに、download 許可
   アルバムでは全サムネイルに常にチェックボックスが重なる。
6. **スマホのホーム画面から開けない。** 家族の主端末はスマホだが、
   ブックマーク経由でしか到達できない。

---

## 2. コンセプト

**「展示室」から「家族の写真集」へ。**

Dark Gallery の視覚言語(`--bg`/`--surface`/amber、システムフォント、
モバイルファースト)はそのまま、構造を「時間」を軸に組み直す:

- アルバム詳細 = **日付ごとの節を持つタイムライン**。写真は
  **元のアスペクト比のまま**行詰めで並ぶ(justified rows)。
- プレビュー = 撮影日時を持つ**没入ビュー**。前後どちらへも
  瞬時にめくれる。
- 遷移 = **View Transitions(CSS 主体)** で「めくる」「浮かぶ」感覚。
- 選択 = 普段は消えている。**選択モード**に入ったときだけ現れる。
- 入口 = **ホーム画面アイコン**(PWA-lite、Service Worker なし)。

---

## 3. 設計

### 3.1 アルバム詳細: 日付タイムライン + justified grid

```
← アルバム   運動会 2026                124枚

7月5日(日)                                ← 日付見出し (--text-muted)
┌───────┬───────────┬─────┐
│  4:3  │   16:9    │ 3:4 │              ← 元アスペクト比のまま行詰め
├─────┬─┴───┬───────┴─────┤
│ 3:4 │ 1:1 │    パノラマ  │
└─────┴─────┴─────────────┘
7月6日(月)
┌───────────┬───────┬─────┐
│           │       │     │
└───────────┴───────┴─────┘
```

- **日付グルーピング**: `takenAt` の(オフセット込み)ローカル日付で
  節に分割。見出しは `7月5日(日)`、アルバムが年をまたぐ場合のみ
  `2026年7月5日(日)`。マニフェスト順は維持し、並べ替えはしない
  (sync が時系列順で出力している前提。順序が乱れた節が混在しても
  単に見出しが再登場するだけで壊れない)。
- **justified rows**: flexbox のみで実装(JS 不要)。

  ```css
  .timeline-row-grid { display: flex; flex-wrap: wrap; gap: 2px; }
  .tl-cell {
    flex-grow: var(--ar100);            /* aspect ratio x 100 */
    flex-basis: calc(var(--ar100) * 1.4px);
    aspect-ratio: var(--ar100) / 100;
  }
  .timeline-row-grid::after { content: ""; flex-grow: 999999; }
  ```

  **CSP 制約**: `style-src 'self'` はインライン `style=` 属性を
  ブロックするため、`--ar100` は**量子化したクラス**で与える。
  サーバー側で `width/height` からアスペクト比を計算し、
  約 20 段階(0.50〜2.40 目安、それ以外は端値へクランプ)の
  `ar-050` … `ar-240` クラスにマップする。CSS 側に各クラスの
  `--ar100` 定義を静的に持つ。CSP は byte-identical のまま。
- **`<img>` に `width`/`height` 属性**を必ず出力(CLS ゼロ化)。
  `loading="lazy"` は維持。
- **正方形 contact-sheet は廃止**(選択モードでも同じタイムライン
  グリッドを使う)。
- **空アルバム**(マニフェストあり・photos 0 件): 中央に
  `写真がまだありません` + 一覧へ戻るリンク(現在は空グリッドのみ)。
- ページネーションは導入しない(§6-4 参照)。

### 3.2 プレビュー強化

```
▒ ← 運動会 2026              3 / 124 ▒
▒   IMG_2041 ・ 7月5日(日) 14:23     ▒   ← 撮影日時を追加
│                                    │
│              (photo)               │
│                                    │
▒ [  前へ  ]  [ 保存 ▴ ]  [  次へ  ] ▒
```

- **撮影日時表示**: タイトル行に `7月5日(日) 14:23` を併記。
  変換は `takenAt` 文字列に埋め込まれたオフセットのままの壁時計時刻を
  表示する純関数(タイムゾーン変換・Intl 依存なし、テスト可能)。
- **prefetch を前後 2 枚に拡張**(ADR §6 の残課題を採用で決着)。
  `<link rel="prefetch">` を prev/next 両方に出す。
- プレビュー画像に `width`/`height` 属性、`fetchpriority="high"`、
  `decoding="async"` を付与。
- スワイプ/矢印キーは現行 app.js の仕組みを継続。
- フィルムストリップ(前後数枚のサムネイル帯)は**採用しない**
  (§6-5 で不採用理由を記載。オペレーター判断で復活可)。

### 3.3 画面遷移: View Transitions(MPA、progressive enhancement)

- CSS に cross-document view transitions を宣言:

  ```css
  @view-transition { navigation: auto; }
  @media (prefers-reduced-motion: reduce) {
    @view-transition { navigation: none; }
  }
  ```

  対応ブラウザ(Chrome/Edge/Safari 系)ではページ間がクロスフェード。
  非対応ブラウザは現状どおり(機能低下なし)。**fetch もルーティング
  も発生しない**。純粋な CSS 宣言。
- **サムネイル→プレビューのモーフ**: クリックしたサムネイルだけに
  `view-transition-name: photo` を付ける必要がある(全セルに一意名を
  静的付与すると数百〜数千要素で遷移計算が重くなるため不可)。
  これは `pageswap` / `pagereveal` イベントで app.js が
  対象要素 1 つにだけ名前を付ける標準テクニックで実装する。
  JS 無効時は名前が付かず、単なる(または無し)クロスフェードに
  自然degradeする。
- プレビューの 前へ/次へ は既定のクロスフェードのみ(横スライドの
  作り込みは初期スコープ外)。

### 3.4 選択モード v2

- 既定状態ではチェックボックスを表示しない。ヘッダー行に
  `選択` ボタン(quiet)を置き、押すと選択モードに入る:
  チェックサークル出現・選択バー待機・`選択` ボタンは `完了` になる。
- 実装は **CSS `:checked` トグル + JS 補助**の二段構え:
  - no-JS フォールバック: `選択` トグル自体を非表示 hidden checkbox +
    label で実装し、`:has(#select-mode:checked)` でグリッドに選択 UI を
    表示する。**JS 無効でも全機能が使える**(現行の常時表示より一段
    静かな UI になるだけ)。
  - JS 補助(app.js): 選択枚数ライブ表示・全選択/解除(現行機能)に
    加え、**Shift+クリックの範囲選択**(直前にチェックした位置から
    範囲内のチェックボックスを同状態にする。既存 checkbox の checked を
    変えるだけで fetch も URL 構築もしない)。
- 選択バー・variant 選択・POST 先・認可チェーンは一切変えない。

### 3.5 アルバム一覧

構造は現行(カバー主導カード)を維持。小改善のみ:

- カバー画像に `width`/`height`(または CSS `aspect-ratio` の明示)で
  CLS ゼロ化。
- 空状態・ページネーションは現行踏襲。
- 写真枚数・日付範囲の表示は**今回も見送り**(D1 の
  `AuthorizedAlbumSummary` は `id`/`title`/`download_enabled` のみで、
  安価な取得源がない。一覧ページで全アルバムのマニフェストを読むのは
  R2 読み込み N 回で不可)。将来 sync がアルバムメタを別途出力する
  設計を検討する場合は別 ADR。

### 3.6 PWA-lite(ホーム画面インストール)

- `workers/public/manifest.webmanifest` を追加:
  `name: photo-gate` / `display: standalone` /
  `background_color: #131316` / `theme_color: #131316` / アイコン参照。
- アイコン: 自己ホストの静的 PNG(192px / 512px / maskable)。
  デザインは「ダーク地 + amber ドット」のワードマーク簡略形
  (SVG から生成、リポジトリには PNG をコミット)。
- **Service Worker は追加しない。** オフラインキャッシュは私的写真の
  端末残留リスクであり、認証境界の外に写真バイトを置かないという
  方針に反する。インストール性(アイコン・standalone 表示)のみ取る。
- `_headers` に immutable エントリ追加(§3.7 の版数規約に従う。
  webmanifest 自体は変更頻度が低いが、変更時はファイル名版数を上げる)。
- CSP: `manifest.webmanifest` と PNG は same-origin 静的アセットで
  `default-src 'self'` / `img-src 'self'` の範囲内。**CSP は変更しない**
  (検証項目: byte-identical 維持)。

### 3.7 アセット版数と JS ポリシー改訂

- 静的アセットは immutable キャッシュのため、内容変更 = ファイル名
  版数アップ(ADR §2.5 の規約どおり):
  - `styles-v2.css` → **`styles-v3.css`**(v3 完了フェーズで v2 削除)
  - `app.js` → **`app-v2.js`**(同上)
  - 旧 ADR Phase 4 で削除予定の `styles.css` は従来計画どおり削除。
- JS ポリシー(ADR §2.2)の改訂:
  - 予算を **< 10 KB**(unminified)へ拡大。単一ファイル・vanilla・
    ビルドなし・`defer` は不変。
  - 許可リストに追加: view-transition 名の付与(`pageswap`/
    `pagereveal`)、選択モードの補助(範囲選択・枚数表示・全選択/解除)。
  - **禁止事項は不変**: fetch/XHR 禁止、既存 `href` 読み取り以外の
    URL 構築禁止、データ描画禁止、cookie/storage 接触禁止、
    インラインスクリプト禁止。
  - すべての機能は JS 無効で完全動作すること(不変)。

### 3.8 管理画面

対象外。旧 ADR Phase 4(トークン準拠の admin restyle + `styles.css`
削除)を独立トラックとして先行または並行実施する。v3 のクラス変更は
viewer ページと共有コンポーネント(ボタン・フォーム)に限定し、
admin の構造には触れない。

---

## 4. 変えないもの(セキュリティ不変条件)

- ルート・エンドポイント・パラメータ・ステータスコード:変更なし。
  (追加されるのは静的アセットのパスのみ: manifest.webmanifest,
  icon PNG, styles-v3.css, app-v2.js。)
- セッション認証 → アルバム認可 → マニフェスト membership の
  チェーン、download gating、fail-closed 応答:変更なし。
- CSP・cookie 属性・全セキュリティヘッダー: **byte-identical**。
- 外部アセット・CDN・webfont:引き続きゼロ。
- 新規 npm 依存・ビルドステップ:なし。
- `takenAt` の表示について: マニフェストは既に該当ページの描画入力
  であり、撮影日時の表示は新たなデータ経路を作らない。配信画像の
  EXIF 除去(位置情報等)は sync 側の不変条件のまま。
  ※「撮影日時を家族に見せる」こと自体はプロダクト判断として §6-1 で
  オペレーター確認を取る。

---

## 5. 実装フェーズ(各フェーズ = 1 handoff、独立シップ可能)

1. **V3-1 タイムライン**: styles-v3.css 切り替え(全クラス移行)、
   アルバム詳細の日付グルーピング + justified grid + `width`/`height`
   属性 + 空状態、`takenAt` 整形の純関数とテスト。
   一覧・プレビューは新 CSS でクラス互換を維持。
2. **V3-2 プレビュー強化**: 撮影日時表示、prefetch 前後 2 枚、
   画像属性(`width`/`height`/`fetchpriority`/`decoding`)。
3. **V3-3 選択モード v2**: `:has()` トグル、app-v2.js 移行
   (範囲選択・view-transition 準備を含む)。
4. **V3-4 遷移 + PWA-lite**: `@view-transition` CSS、pageswap/
   pagereveal モーフ、manifest.webmanifest + アイコン、`_headers` 整理、
   styles-v2.css / app.js 削除。
5. (独立)旧 ADR Phase 4: admin restyle + styles.css 削除。
   v3 より先に済ませることを推奨(v3 で消す styles-v2 参照が admin に
   残らないよう、admin も V3-1 で styles-v3 に切り替える)。

各フェーズの受け入れ条件・Files To Edit・検証は handoff 化の際に
Codex が確定する。

---

## 6. 要決定事項(オペレーター決定済み: 2026-07-08)

1. **撮影日時の表示可否**: 日付見出し(3.1)と撮影日時(3.2)を
   家族閲覧者に見せる。→ **決定: 表示する**。
2. **justified grid の採用**: 正方形均一グリッドを廃止し、
   非クロップの行詰めにする。均一感は gap 2px と行高目安で担保する。
   → **決定: 採用**。
3. **PWA-lite の採用**: 3.6 の方針で採用。アイコン案は V3-4 handoff
   前に 2〜3 案提示してオペレーターが選ぶ。→ **決定: 採用**。
4. **大規模アルバムのページネーション**: 今回は見送り(現行どおり
   1 ページ全件。lazy loading + width/height で実用上問題ない想定。
   数千枚規模のアルバムを実際に共有する運用になった時点で別途設計)。
   → **決定: 見送り**。
5. **フィルムストリップ(プレビュー下の前後サムネ帯)**: 情報量より
   没入感を優先。→ **決定: 不採用**(将来の復活希望は別途)。

---

## 7. 検証基準(全フェーズ共通)

- `npm run lint` / `typecheck` / `npm test`(既存 2528 件 + 追加分)。
  セキュリティ関連アサーション(ヘッダー・gating・membership)を
  弱めない。
- CSP・セキュリティヘッダーが byte-identical であることのテスト維持。
- `wrangler dev` で 375px / 1280px の全 viewer ページ確認。
  **JS 無効パス**(ログイン→一覧→詳細→選択 DL→プレビュー→保存)の
  完全動作。
- View Transitions 非対応ブラウザ(Firefox 等)での無劣化確認。
- `prefers-reduced-motion: reduce` で遷移アニメーションが無効に
  なることの確認。
- Lighthouse(モバイル)で CLS = 0 近傍、アルバム詳細の LCP 劣化なし
  を目安確認(数値ゲートにはしない)。
