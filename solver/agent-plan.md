# 自律プレイ評価エージェント: 概要把握と計画

## 1. ゲーム概要（実装コード起点）

- 難易度: `FRESH` / `PRO`
- 期間: 8ターン
- フェーズ: `training -> action -> meeting`（最終ターンは会議スキップあり）
- 主状態:
  - ステータス: `experience`, `enrollment`, `satisfaction`, `accounting`
  - カード領域: `deck`, `hand`, `placed`
  - トークン: `passion`, `inspiration`, `organize`, `fatigue`
- 主管理クラス:
  - `GameState`: 状態と境界値制御
  - `CardManager`: CSV読込、効果パース、研修プール抽選、効果適用
  - `TurnManager`: ターン/フェーズ進行、アクション実行
  - `ScoreManager`: スコア算出とランク判定
  - `UIController`: DOM描画とユーザー操作

## 2. 直接関与可否（結論）

**直接関与は可能**。

根拠:

- `main.js` で `window.game = game` が公開されている
- Playwrightの `page.evaluate()` から `window.game.*` を呼べる
- 既存テストでも `window.game.gameState.tokens` などの直接操作実績がある

したがって、ブラウザUIのクリック連打ではなく、以下の内部APIを直接呼んで高速実行できる。

- `game.gameState.reset()`
- `game.cardManager.initTrainingPool()`
- `game.cardManager.drawTrainingCards()`
- `game.turnManager.advancePhase()` / `game.turnManager.executeActions()`
- `game.scoreManager.calculateScore()`

## 3. 評価対象

- 戦略比較（ポリシー単位）
  - `random`: ランダムに研修/配置/削除
  - `greedy`: その時点の即時利得が最大の選択
- カード性能評価
  - 出現回数 / 採用回数 / プレイ回数
  - 平均ステータス寄与（体験・入塾・満足・経理）
  - プレイ時の最終スコア相関（カード別）

## 4. 実行アーキテクチャ

1. NodeスクリプトでローカルHTTPサーバを起動（`game/` を配信）
2. Playwrightで `index.html` を1回ロード
3. `page.evaluate()` 内で複数エピソードをループ
4. UI操作を使わず、内部ロジックを直接進行
5. 結果をJSONで `solver/` に保存

## 5. 段階計画

### Phase A: 実行基盤（今回）

- `solver/autoplay-agent.mjs` を追加
- `fresh_adaptive/beam/greedy/random` を実装
- `fresh_adaptive` ではステータス依存の取得・配置・削除重みを動的に変更
- エピソード統計とカード統計をJSON化
- JSONから自然言語レポートを自動生成

### Phase B: 精度改善

- 1ターン先読み（Beam Search）導入
- PRO専用トークン価値の重み最適化
- 研修リフレッシュ意思決定（PRO）を最適化

### Phase C: 分析可視化

- 結果CSV出力（カード別寄与ランキング）
- 難易度別の比較レポート自動生成
- プレイログから代表プレイラインを抽出

## 6. 「直接関与できない」場合に必要な改造点

現状は直接関与可能だが、より堅牢・高速化するなら以下を推奨。

- `game/js/main.js`
  - `window.game` に加えて `window.cdgEngine`（UI非依存API）を公開
- `game/js/turnManager.js`
  - `runTrainingPhaseChoice()` / `runActionPhaseChoice()` / `runMeetingPhaseChoice()` のような純ロジックAPIを追加
- `game/js/uiController.js`
  - アニメーション・confirm依存を切る `headlessMode` を追加
- `game/js/cardManager.js`
  - 効果評価用の `simulateCardEffect(card, staff, stateSnapshot)` を追加（非破壊）
- `game/js/logger.js`
  - ログ無効化フラグを追加し大量試行時のオーバーヘッドを低減

## 7. 受け入れ基準

- 200エピソード以上を1コマンドで完走
- `random` と `greedy` の比較結果がJSONで出る
- カード別に `plays` と平均寄与が計算される
- 実行時にUIクリック操作を使わない
