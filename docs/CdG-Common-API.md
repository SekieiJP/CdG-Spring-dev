# 共通基盤と難易度モジュールの接続

MASTERのカード・契約条件・核の取得方法を定める文書ではない。既存FRESH・PROのルールを共有するための実装入口を記録する。

## 難易度の登録

`game/js/difficultyExtensions.js`から固有のモジュールをimportし、そのモジュールで`registerDifficulty`を呼ぶ。登録はゲーム起動前に行う。`window.game.registerDifficulty`は開発用の動的登録入口で、再読み込みを跨ぐ登録には拡張モジュールを使う。

```js
registerDifficulty({
    id: 'new-mode', name: '新モード',
    csvPath: 'data/cards_new.csv', rankCsvPath: 'data/rankNew.csv',
    initialStatus: { experience: 0, enrollment: 0, satisfaction: 3, accounting: 5 },
    scoringModel: 'pro',
    turns: [...],
    slots: [{ id: 'leader', name: '室長', capacity: 1, allowParallel: true, persistent: false }, ...],
    cardZones: ['reserve'],
    trainingRefresh: { enabled: true, maxCount: 2 },
    rules: {}
});
```

配置先は1〜4件。配列の順序が効果解決順となる。容量到達後も`allowParallel: true`の配置先では並行カードを重ねられる。`persistent: true`の配置先はターン終了時のデッキ返却から除外する。新しいカード所在は`player.zones[id]`で保持する。具体的な継続タイミングや交代費用は固有ルール側で定義する。

得点は`fresh`・`pro`の既存方式を選ぶか、`custom`と`rules.calculateScore(state, scoreManager)`を組み合わせる。既存方式の得点値・閾値は共通化では変更していない。

未登録のIDは読込み失敗として扱い、FRESHへ変換しない。中断データは保持する。

## 状態とカード

- `state.config`、`slots`、`slotIds`、`staffNames`、`totalTurns`で実行条件を参照する。
- `runId`はゲーム、`definitionId`はカード定義、`instanceId`は所有カードの個体を識別する。研修候補の`poolId`は所有個体と分ける。
- `getOwnedCards()`で山札・手札・全配置先・追加所在を列挙する。
- `ruleState`は固有の実行状態を置く、保存可能なJSONデータである。関数やDOM要素を入れない。
- `SaveManager`は全配置先・追加所在・カードの追加フィールド・`ruleState`を保存する。既存保存の欠けた個体IDは復元時に補う。

## 配置と解決

`getPlacementError(cardManager, state, card, staff, placed)`は配置制限・容量・並行を共通判定する。`rules.canPlaceCard({state, card, slot, placed})`は、禁止理由の文字列か許可する`null`を返す追加判定である。

`TurnManager.resolveCardAction(card, staff, state)`は1枚の共通解決入口。実際の状態なら適用し、`createSimulationState()`などの仮状態ならその状態だけに適用する。条件・コストはおすすめ加算前の状態で判定する。結果には前後パラメータ・トークン・条件成立・コスト不足・個体・配置先・ターンを含める。

`rules.resolveCard`を指定する場合は既存の`resolveCardAction`と同じ引数・結果形式を使い、予測と本体で同じ処理を呼ぶ。`beforeAction(state, cardManager)`／`afterAction(state, actionInfo)`はターン全体の処理を接続する入口である。solverの既存戦略は1枚単位の探索を用いるため、全体フックを追加する際はその難易度用の予測も追加して検証する。

`executeActions()`は解決済み結果を`pendingAction`へ保持し、同じターンの二度目の実行を抑止する。UIは演出前に保存し、再読み込み後は未完の終了処理を済ませて次フェーズへ進む。カード演出は`ActionAnimationController`が確定結果を表示する。

## ブランチでの受け渡し

共通コードは`codex/shared-foundation`、計測は`codex/shared-card-evaluation`、画面・通信は`codex/shared-mobile-ui`に置く。基盤のコミットをmergeしてから各作業に進む。MASTER側は別チェックアウトで必要な共通コミットを取り込み、`difficultyExtensions.js`と固有モジュール・データを中心に追加する。

版を更新する際は`node scripts/set-build-version.mjs vYYYYMMDD-NNNN`を使用する。互換な更新は上8桁を維持する。ゲーム内の相対importを同じ版に統一し、別URLで設定レジストリが二重に生成されることを防ぐ。新しいimportを追加した場合もこのスクリプトで参照を揃える。

## 検証と残る範囲

追加配置先・追加所在・持続配置・6ターン・未登録ID・行動の二重適用を単体／ブラウザで検証した。カード演出分割後の関連ブラウザ47件、単体12件が通過した。

研修の取得ルール・選択ドロー・独自効果文の解析・専用solver戦略は、固有仕様が定まってから拡張する。現在の3／4候補と取得枚数はFRESH・PROの仕様を維持している。新しい得点方式の内訳表示は、その方式の表示モジュールも用意する。
