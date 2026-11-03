import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const observation={owned:[{cardNo:'17',rarity:'R'},{cardNo:'5',rarity:'N'}],candidates:[{cardNo:'43',rarity:'SSR'},{cardNo:'49',rarity:'SSR'}]};
const observationHash=createHash('sha256').update(JSON.stringify(observation)).digest('hex');
import {compareSceneArms} from '../../solver/pro-card-scene-metrics.mjs';
function records(arm){return Array.from({length:250},(_,i)=>({
 metadata:{difficulty:'pro',source:'counterfactual',seed:`scene-test:${i}`,sceneId:`card-43-${i}`,sceneArm:arm,
  sceneBankSha256:'a'.repeat(64),sceneObservationSha256:observationHash,sceneTurn:2,forcedChoice:[arm==='target'?0:1],
  provenance:{strategyVersion:'same',codeHash:'game'},cardVersion:'cards',rankVersion:'ranks',catalog:[{cardNo:'17'},{cardNo:'5'},{cardNo:'43'},{cardNo:'49'}]},events:[{type:'research-counterfactual-start',observation,forcedChoice:[arm==='target'?0:1]},
 {type:'acquire',turn:2,card:observation.owned[0]},{type:'acquire',turn:2,card:observation.owned[1]},{type:'acquire',turn:2,card:observation.candidates[arm==='target'?0:1]}],
 result:{score:{displayScore:arm==='target'?13:12,withdrawal:0,enrollmentDiff:32,experience:40,enrollment:32,satisfaction:25,accounting:15},finalDeck:[]}}));}
test('異なる取得番号を持つ250の公開局面を、同じ後続方略の対で集計する',()=>{
 const r=compareSceneArms(records('reference'),records('target'));
 assert.equal(r.n,250);assert.equal(r.comparison.meanDifference,1);assert.equal(r.byTurn[3].n,250);assert.equal(r.target.activity.acquisitions,1);
 assert.equal(r.targetCards.find(c=>c.cardNo==='17').gamesAcquired,0);assert.equal(r.targetCards.find(c=>c.cardNo==='17').gamesOwnedInitially,250);
});
test('同じ局面IDでも元の公開状態・後続方略・未来シードが違う対は拒否する',()=>{
 for(const mutate of [r=>r.metadata.sceneObservationSha256='c'.repeat(64),r=>r.metadata.research={targetScore:15},r=>r.metadata.seed='other:0']){
  const a=records('reference'),b=records('target');mutate(b[0]);assert.throws(()=>compareSceneArms(a,b));
 }
});
test('リセマラ、局面重複、250未満の試験を混ぜない',()=>{
 const a=records('reference'),b=records('target');b[0].metadata.reroll={attempts:2};assert.throws(()=>compareSceneArms(a,b));
 const c=records('target');c[0].metadata.sceneId=c[1].metadata.sceneId;assert.throws(()=>compareSceneArms(a,c));
 assert.throws(()=>compareSceneArms(a.slice(0,249),records('target').slice(0,249)));
});
