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

## FRESH取得アシストの分析

ゲーム本体の `freshAcquisitionAdvisor.js` と同じ数式を、取得判断だけに適用できます。配置・削除は `--policies` に指定した方略を維持します。実際のゲーム操作・得点計算はブラウザで実行し、Node側は起動と記録集計を担当します。推薦には公開済み情報だけを渡し、実プレイのseedや隠れた山札順を渡しません。ゲーム画面での推薦はこの数式のみで計算し、繰り返しシミュレーションを実行しません。

```bash
node solver/autoplay-agent.mjs --difficulty fresh --episodes 200 --policies fresh_stable --acquisition-model reach --seed fresh-assist-v1-dev --output solver/local-runs/fresh-assist/dev-reach.json --no-report
node solver/fresh-assist-analysis.mjs solver/local-runs/fresh-assist/dev-baseline.json solver/local-runs/fresh-assist/dev-reach.json --output-dir solver/local-evaluation/fresh-assist/dev
```

- `--acquisition-model balanced|safety|reach|supply`：比較する重み。未指定なら従来の取得方略。
- `--acquisition-ablation experience|enrollment|satisfaction|accounting|threshold|precision|risk`：指定した評価特徴の寄与だけをゼロにする比較。
- `--episode-offset N`：分割実行時にseedの末尾番号をNから開始する。同じseedを重複して集計しない。
- `--seed PREFIX`：各ゲームは `PREFIX:番号`。開発・検証・最終評価でPREFIXを変え、同じ比較内では揃える。

分析ツールは `index.html`、`summary.json`、`contexts.csv` を出力します。HTMLでカード／ターン／不足状況を絞り、評価項目の寄与と実際の選択を確認できます。S率・中央値・p10と、対応するseedを使ったブートストラップ95%区間を表示します。カード／ランク／ルール版が異なる記録は比較せず、同条件で結果が競合する重複seedはエラーにします。生ログ・出力はGit除外対象です。

### 公開された取得場面からの再試行

HTMLの代表例をJSON保存するか、指定したゲームの取得判断を取り出します。判断番号は0始まりです。

```bash
node solver/fresh-assist-analysis.mjs --extract solver/local-runs/fresh-assist/dev-reach.json --seed fresh-assist-v1-dev:0 --decision 2 --output-dir solver/local-evaluation/fresh-assist/scene
node solver/autoplay-agent.mjs --difficulty fresh --episodes 100 --policies fresh_stable --acquisition-model reach --decision-file solver/local-evaluation/fresh-assist/scene/decision.json --forced-choice 0 --seed fresh-assist-scene-0 --output solver/local-runs/fresh-assist/scene-choice0.json --no-report
```

同じ状況・同じ新しいseed群で `--forced-choice 1`、`2` などを比較します。初回なら `0,1` のように2枚指定し、発想の取得辞退は `skip` とします。既知の所有カード・状態・過去提示枚数を復元し、以後の未公開の並びを新たなseedで生成します。元ゲームの隠れた並びを復元するツールではありません。推薦の局所的な弱点を調べる条件付き実験として扱ってください。

計画・表示仕様は [FRESH取得アシスト計画](../docs/CdG-FRESH-Assist-Plan.md)、重みの選定と結果は [分析記録](../docs/CdG-FRESH-Assist-Analysis.md) を参照してください。

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

## PROのS+取得推薦

[計画](../docs/CdG-PRO-Assist-Plan.md)に測定順序と制約を記載。S+以上にはSSを含み、FRESHのS以上と混ぜない。通常モードだけを比較する。公開ゲームの取得推薦は数式で計算し、分析用の配置探索は自動プレイ時だけに使う。

```sh
node solver/autoplay-agent.mjs --difficulty pro --episodes 200 --policies pro_goal --acquisition-model pro_splus --seed pro-assist-example --output solver/local-runs/pro-assist/example.json --no-report
node solver/acquisition-analysis.mjs --difficulty pro solver/local-runs/pro-assist/example.json --output-dir solver/local-evaluation/pro-assist/example
node solver/acquisition-benchmark.mjs solver/local-runs/pro-assist/example.json --output solver/local-evaluation/pro-assist/benchmark.json
```

- 取得式：`pro_balanced`（安定）、`pro_engine`（回転）、`pro_bridge`（高満足）、`pro_precision`（動員・入退差）、`pro_splus`（入退差と経理を補強）、`pro_lean`（希釈・コストへの慎重さ）。数値・既定の採用モデルは`game/js/proAcquisitionAdvisor.js`に集約する。
- 新しい配置・削除方略：`pro_goal`、`pro_engine`、`pro_bridge`、`pro_precision`。`--acquisition-model`も指定する。ブラウザ内で既知の手札を比較し、本体と共通の効果解決を使う。配置は室長→講師→事務の順。探索は幅180、最大12枚まで。未知の未来の山札・抽選は読まない。
- 数式を使うPROのリフレッシュは、公開カタログと提示・除外履歴の比較で判断する。発想の取得では希釈を避けるため辞退も評価する。旧方略の再現時は従来のリフレッシュ方略を使う。
- `--acquisition-ablation goal|points|engine|accounting|...`で一つの寄与を除外できる。能力・条件の投影式は同じにして、意思決定への寄与を測る。
- `acquisition-analysis.mjs --extract ... --seed ... --decision ...`と`autoplay-agent.mjs --decision-file ... --forced-choice 0|1|2|skip`で公開場面の候補別再試行を行う。新しい共通seedを使い、元の非公開の抽選順を復元しない。PROの使用済みプール・永久除外は記録された履歴だけから復元する。除外履歴のない旧記録は完全な同条件復元ではないため使わない。
- HTMLでカード・ターン・不足・構築傾向を絞り、重み寄与、状態、トークン、デッキ枚数、取得時と提示時の同伴成績を確認できる。後者は相関・選択の偏りを含む。モデル変更は開発・検証群までで行い、凍結後の評価群を再調整に使わない。
- `fresh-assist-analysis.mjs`は従来のFRESH用入口として維持する。人間のプレイは自動プレイと別にし、実際にアシストを表示したかも区別する。
- `acquisition-benchmark.mjs`は同じMac上のChromiumで画面寸法を変える測定。iPhone 12 Safari／Android実機の処理時間とは区別する。

生の記録・生成HTML/CSV・測定JSONは`solver/local-runs/`と`solver/local-evaluation/`に保存し、公開配信やGitコミットに含めない。
