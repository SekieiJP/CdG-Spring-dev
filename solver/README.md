# Solver Overview

`solver/` は、`game/index.html` で動くゲームを **自律プレイ** し、カード性能・戦略性能を評価するための作業領域です。

## 収録ファイル

- `autoplay-agent.mjs`
  - Playwrightでゲームを起動し、`window.game` の内部マネージャーを直接呼び出して高速シミュレーションする実行スクリプト
  - FRESH方略に加えて、PRO用の `pro_foundation` / `pro_stable` / `pro_upside` を比較可能
- `agent-plan.md`
  - ゲーム概要、直接関与の可否判定、評価軸、実装ロードマップ
- `reportBuilder.mjs`
  - シミュレーションJSONから自然言語レポート（Markdown）を生成
- `render-report.mjs`
  - 既存JSONからレポートのみを再生成するCLI

## 使い方（最小）

```bash
node solver/autoplay-agent.mjs --episodes 200 --difficulty fresh --policies fresh_stable_classic,fresh_adaptive,deep_beam
```

主なオプション:

- `--episodes <number>`: 各ポリシーの試行回数（デフォルト `200`）
- `--difficulty <fresh|pro>`: 難易度（デフォルト `fresh`）
- `--policies <csv>`: 比較するポリシー（未指定時は `fresh` ならFRESH系、`pro` ならPRO系を自動選択）
  - `fresh_stable_classic`: FRESH専用。退塾抑制（経理/満足維持）を最優先する安定方略
  - `fresh_stable`: FRESH専用。安定寄りで入退差も取りに行く派生方略
  - `fresh_upside`: FRESH専用。動員/教務へ寄せた高打点狙い方略（分散高）
  - `fresh_s50`: FRESH専用。S条件（体験12+/入退差12+/退塾1以下）に直結する評価を強めた先読み強化版
  - `fresh_adaptive`: FRESH専用。ステータス不足（体験/入退差/退塾リスク）に応じて取得・配置・削除の重みを動的調整
  - `deep_beam`: 先読み深さ/幅を拡大したビーム探索（低速）
  - `deep_beam_satcap`: `deep_beam` をベースに、満足過剰時の応対評価を抑制
  - `fresh_rule_nonly`: FRESH専用。削除をNカード限定とするルールベース戦略
  - `beam`: 汎用ビーム探索（中速）
  - `pro_foundation`: PRO向け基盤方略。合法手列挙（並行/スタッフ制限/発想/リフレッシュ）を優先
  - `pro_stable`: PRO向け安定方略。退塾抑制と庶務/応対維持を強める
  - `pro_upside`: PRO向け上振れ方略。動員/教務の打点寄り
  - `greedy`: 逐次の即時利得最大化
  - `random`: ランダム（任意。デフォルト比較には含めない）
- `--output <path>`: 結果JSONの出力先（デフォルト `solver/latest-simulation.json`）
- `--report <path>`: 自然言語レポート出力先（デフォルト `solver/latest-report.md`）
- `--no-report`: レポート出力を無効化
- `--headful`: ブラウザを可視で起動（デフォルトはheadless）

## 重要ポイント

- 画面クリック/ドラッグは使わず、`window.game` 内の `gameState` / `turnManager` / `cardManager` / `scoreManager` を直接操作します。
- 既存のUIは初期ロードのみ利用し、評価ループは内部ロジック中心で実行するため、通常のE2E操作より高速です。

## レポート再生成

```bash
node solver/render-report.mjs --input solver/latest-simulation.json --output solver/latest-report.md
```

## FRESH S達成率最適化

```bash
node solver/autoplay-agent.mjs --episodes 300 --difficulty fresh --policies fresh_stable_classic,fresh_adaptive,deep_beam --output solver/fresh-reach50-best.json --report solver/fresh-reach50-best.md
```

- チューニング履歴: `solver/fresh-sopt-history.md`
- 方略比較履歴（Random除外）: `solver/fresh-rule-history.md`
- S+カード/レアリティ評価: `solver/fresh-splus-ranking.md`

## PRO基盤評価

```bash
node solver/autoplay-agent.mjs --episodes 200 --difficulty pro --policies pro_foundation,pro_stable,pro_upside --output solver/pro-foundation-r1.json --report solver/pro-foundation-r1.md
```
