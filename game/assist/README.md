# Training Advisor (Game Assist)

`trainingAdvisor.js` は、現在ターン・ステータス・研修候補からおすすめ取得カードを返す補助モジュールです。
`deleteAdvisor.js` は、現在ターン・ステータス・デッキ状況からおすすめ削除カードを返す補助モジュールです。

## Export
- `recommendTrainingCard(input)`
- `recommendCardName(input)`
- `explainTopChoice(input)`
- `recommendDeleteCards(input)`
- `recommendDeleteCardName(input)`
- `explainDeleteChoice(input)`

## Input
```js
{
  difficulty: 'pro' | 'fresh',
  strategyProfile: 'strategic1_stable' | 'strategic1' | 'strategic1_upside', // optional, default: 'strategic1_stable'
  turn: 0..7,
  status: {
    experience: number,
    enrollment: number,
    satisfaction: number,
    accounting: number
  },
  options: [
    'カード名A',
    { cardName: 'カード名B', category: '教務', rarity: 'SR', effect: '+2入塾' }
  ],
  cardLookup: {
    'カード名A': { category: '庶務', rarity: 'R', effect: '...' }
  }
}
```

## Output
```js
{
  recommendedCardName: '振込用紙印刷',
  ranking: [
    { cardName: '振込用紙印刷', category: '庶務', rarity: 'R', score: 4.23, reasonTags: ['acc', 'diff'] }
  ],
  needsSnapshot: { ... },
  summary: 'おすすめ: 振込用紙印刷（重視: 入退差・退塾抑制）'
}
```

## Usage Example
```js
import {
  buildCardLookup,
  recommendTrainingCard,
  explainTopChoice
} from './assist/trainingAdvisor.js';
import {
  recommendDeleteCards,
  explainDeleteChoice
} from './assist/deleteAdvisor.js';

const advisorInput = {
  difficulty: 'pro',
  turn: game.gameState.turn,
  status: {
    experience: game.gameState.player.experience,
    enrollment: game.gameState.player.enrollment,
    satisfaction: game.gameState.player.satisfaction,
    accounting: game.gameState.player.accounting
  },
  options: game.gameState.currentTrainingCards,
  cardLookup: buildCardLookup(game.cardManager.allCards || [])
};

const result = recommendTrainingCard(advisorInput);

console.log(result.recommendedCardName);
console.log(explainTopChoice(advisorInput));

const deleteInput = {
  difficulty: 'pro',
  strategyProfile: 'stable',
  deletePolicy: 'n_only', // optional: 'normal' | 'n_only'
  turn: game.gameState.turn,
  deleteMax: game.turnManager.getCurrentDeleteMax(),
  status: {
    experience: game.gameState.player.experience,
    enrollment: game.gameState.player.enrollment,
    satisfaction: game.gameState.player.satisfaction,
    accounting: game.gameState.player.accounting
  },
  deck: game.gameState.player.deck,
  cardLookup: buildCardLookup(game.cardManager.allCards || [])
};

const deleteResult = recommendDeleteCards(deleteInput);
console.log(deleteResult.recommendedDeleteCardNames);
console.log(explainDeleteChoice(deleteInput));
```

## Integration Notes
- 研修候補表示直後に呼び出して、推薦1位カードにバッジを付与する運用を想定。
- 会議フェーズ表示時に呼び出して、削除候補カードに「削除おすすめ」バッジを付与する運用を想定。
- `strategyProfile` は互換のため `stable/smax/upside` も受理し、それぞれ `strategic1_stable/strategic1/strategic1_upside` に内部変換される。
- PROの重みは `solver/autoplay-agent.mjs` の `pro_strategic1_stable` 準拠（2026-04-13 時点のA+率同期）をベースにしている。
- PROの評価閾値は `rankPro.csv` 準拠で `S: points>=12`, `A+: points>=10` を用いる。
- Assist同期ポリシーは「A+率（points>=10）主指標 + S率（points>=12）を安全指標」で判定する。
- 将来は solver 側重みをJSON化し、アシストと共通化する。
