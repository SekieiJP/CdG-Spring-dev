import test from 'node:test';
import assert from 'node:assert/strict';
import {planningOutcomeScore,createRiskPolicy} from '../../solver/browser/pro-risk-research.js?v=20261107-0064';
const outcomes=a=>a.map(score=>({score,utility:score}));
test('同じ平均なら悪い仮想展開を減らす候補を優先し、重み0は従来の平均と一致',()=>{
 const stable=outcomes([12,12,12,12]),risky=outcomes([6,14,14,14]);
 assert.equal(planningOutcomeScore(stable),12);assert.equal(planningOutcomeScore(risky),12);
 assert.equal(planningOutcomeScore(stable,{tailMeanWeight:.25}),12);
 assert.equal(planningOutcomeScore(risky,{tailMeanWeight:.25}),10.5);
 assert.equal(planningOutcomeScore(risky,{tailMeanWeight:.5}),9);
 assert.ok(planningOutcomeScore(outcomes([13,13,13,13]),{tailMeanWeight:.5})>planningOutcomeScore(stable,{tailMeanWeight:.5}));
});
test('仮想の得点差と既存の細かな同点評価を保ち、配列を変更しない',()=>{
 const a=[{score:8,utility:8.1},{score:12,utility:12.2},{score:12,utility:12.3}],before=structuredClone(a);
 assert.equal(planningOutcomeScore(a),(8.1+12.2+12.3)/3);planningOutcomeScore(a,{tailMeanWeight:.5});assert.deepEqual(a,before);
 assert.throws(()=>planningOutcomeScore([]));assert.throws(()=>planningOutcomeScore([{score:NaN,utility:1}]));
 for(const option of [{tailMeanWeight:-1},{tailMeanWeight:3},{tailFraction:0},{tailFraction:NaN}])assert.throws(()=>planningOutcomeScore(a,option));
});
test('本体との接続前に範囲外のリスク条件を拒否する',()=>{
 for(const planning of [{riskFloor:-1},{riskFloor:17},{tailPenalty:NaN},{tailPenalty:-1},{tailMeanWeight:3},{tailFraction:0}])assert.throws(()=>createRiskPolicy({config:{planning}}),/下側評価/);
});
