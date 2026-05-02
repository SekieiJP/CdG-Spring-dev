# アシスト機能計画（取得/削除おすすめ）

## 目的
現在のターン・ステータス・候補カード情報を入力すると、PRO/FRESHの優秀方略に沿った「おすすめ取得カード」「おすすめ削除カード」を返すアシストJSを提供する。

## 生成物
- `trainingAdvisor.js`
  - pure function中心の推薦モジュール
  - 本編UI未依存（単体テストしやすい）
- `deleteAdvisor.js`
  - 会議フェーズ向け削除推薦モジュール
  - `normal` / `n_only` の削除ルール切替をサポート
- `README.md`
  - 呼び出しI/Fと本編統合手順

## I/F（初版）
- 入力
  - `difficulty`: `'pro' | 'fresh'`（初版はPRO重視、FRESHは簡易）
  - `turn`: `0..7`
  - `status`: `{ experience, enrollment, satisfaction, accounting }`
  - `options`: `string[] | CardLike[]`
    - `CardLike`: `{ cardName, category?, rarity?, effect? }`
  - `cardLookup`（任意）: `{ [cardName]: { category, rarity, effect } }`
- 出力
  - `recommendedCardName`
  - `ranking`: `[{ cardName, score, reasonTags }]`
  - `needsSnapshot`（不足/過剰の判定）
  - `summary`（UI表示向け1文）

## 方針（PRO）
- 指標は `S>=12` / `A+>=10`（`game/data/rankPro.csv` 基準）を重視。
- 退塾（= 経理不足 + 満足不足）抑制を前提にしつつ、満足の過剰取得は抑える。
- 入退差(入塾-退塾)と体験の不足を優先して埋める。
- カード名バイアスを最小限導入（低得点偏重カードは抑制、高得点寄与カードは加点）。

## Assist同期ポリシー（2026-04-13更新）
- 背景: 以前のS率は `points>=8` 前提で算出された可能性があり、PRO実ランク基準 (`S>=12`) と不整合だった。
- 即時対応: `trainingAdvisor.js` は A+率トップ方略（`pro_strategic1_stable` 準拠）に同期。
- 判定ログ: `solver/pro-tune-r68-aplus-sync-decision.md`
- 今後の更新判定:
  - 主指標: A+率 (`points>=10`)
  - 安全指標: S率 (`points>=12`) と平均点
  - 反映条件: 比較試行で A+率が改善し、かつ S率/平均点の大幅悪化がない場合のみ同期。

## 本編統合案
1. `main.js` から `trainingAdvisor.js` を import。
2. 研修候補提示時に `recommendTrainingCard(...)` を実行。
3. 推薦1位カードに「おすすめ」バッジを表示。
4. 会議フェーズ表示時に `deleteAdvisor.js` を呼び出し、削除候補バッジを表示。
5. 任意で「理由表示」トグルを追加し `summary` を表示。
6. 実プレイログを収集し、`reasonTags` と実際の選択差分を検証。

## 観測項目（実装時）
- 推薦一致率（プレイヤー選択が推薦1位だった割合）
- 推薦追従時の最終ランク分布（S/A+/A...）
- 推薦追従時の満足過剰率（`satisfaction > 15`）

## 次の改良候補
- PRO専用で候補3枚の組み合わせ相性（次ターン期待値）を導入。
- 発想/整理/情熱トークン見込みを評価項目へ追加。
- `solver/autoplay-agent.mjs` の重みを JSON 化し、同一重みをアシスト側で再利用。
- 削除おすすめに「削除後デッキ期待値」の簡易先読みを導入。
