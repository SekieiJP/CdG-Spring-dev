# PRO攻略 基盤化メモ (r1)

## 実装した基盤

- `solver/autoplay-agent.mjs` にPRO専用ポリシー `pro_foundation` / `pro_stable` / `pro_upside` を追加。
- FRESH方略をPROで指定した場合は `pro_foundation` へマップし、`greedy` へのフォールバックを廃止。
- 合法手列挙レイヤーを追加:
  - 配置: スタッフ制限 `【】` と `並行🤹` を加味した合法スロット列挙。
  - 行動: ビーム探索の展開を「列挙済み合法手」ベースに変更。
  - 研修: 初回研修/通常研修/発想追加習得を同型化し、候補評価 + リフレッシュ判断を導入。
  - 会議: 削除しない選択を許容し、PROでは低価値カードのみ削除するルールを導入。
- 観測項目を追加:
  - 研修: 候補数、リフレッシュ回数（初回/通常/発想）
  - 行動: フェーズあたり合法手数、配置枚数、並行配置率
  - 会議: フェーズあたり選択肢数、削除枚数
- `solver/reportBuilder.mjs` を更新し、上記観測値を自然言語レポートに出力。
- `solver/README.md` にPROポリシーと実行例を追記。

## 実行結果 (200 episodes, PRO)

- コマンド:
  - `node solver/autoplay-agent.mjs --episodes 200 --difficulty pro --policies pro_foundation,pro_stable,pro_upside --output solver/pro-foundation-r1.json --report solver/pro-foundation-r1.md`
- S達成率:
  - `pro_foundation`: 29.0%
  - `pro_stable`: 23.5%
  - `pro_upside`: 15.0%
- A+率 (`displayScore>=7`):
  - `pro_foundation`: 42.0%
  - `pro_stable`: 36.0%
  - `pro_upside`: 27.5%

## 観測メモ

- リフレッシュ使用は全方略で `400`（200試行 × 2回）で上限張り付き。
- リフレッシュ内訳は「初回研修」が最多（例: `pro_stable` で initial 322 / main 78）。
- 並行配置率は 3.6%〜7.5% 程度で、合法手として選べているが活用余地あり。
- 会議削除は `pro_stable` でほぼ0枚（過度に保守的）になっている。

## 次の調整候補

1. リフレッシュ判定閾値を引き上げ、常時2回消費を抑制する。
2. `pro_stable` の削除閾値を緩め、N/Rの低寄与カードをもう少し削る。
3. `並行🤹` とスタッフ条件カードの評価を強化し、スロット依存の高打点コンボを増やす。

---

## r5 追記 (2026-04-11)

- リフレッシュ上限が「全試行通算」で効いていた不具合を修正（エピソード単位に変更）。
- リフレッシュ方針を保守化:
  - `pro_foundation` / `pro_stable`: 初回研修のみ最大1回
  - `pro_upside`: 初回最大2回、通常研修最大1回
- 削除判定を再調整し、N応対過多を抑制する重みを追加。

実行結果:

- `solver/pro-tune-r5.json` (180 episodes)
  - `pro_foundation`: **S 31.7%**, A+ 41.7%, S+ 12.8%
  - `pro_stable`: **S 28.3%**, A+ 45.6%, S+ 11.7%
  - `pro_upside`: **S 17.2%**, A+ 28.9%, S+ 6.7%

分布差分析:

- `solver/pro-holdings-diff-r5.md` に、S+群(>=9)と低得点群(<=0)の所持カード差分を整理。
