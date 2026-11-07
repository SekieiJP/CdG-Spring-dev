import test from 'node:test';
import assert from 'node:assert/strict';
import {extractAhiruDecisionRows} from '../../solver/ahiru-decision-dataset.mjs';
function fixture(){const card=n=>({cardNo:String(n),cardName:'Card'+n,rarity:n<6?'N':'R',category:'動員',effect:'体験+2。',acquiredTurn:0});
 const observation={schema:1,difficulty:'pro',mode:'normal',turn:0,totalTurns:8,stats:{experience:8,enrollment:2,satisfaction:10,accounting:9},tokens:{passion:0,fatigue:0,inspiration:0,organize:0},owned:[card(1),card(2)],candidates:[card(6),card(7),card(8),card(9)],pickCount:2,allowSkip:false,turns:Array(8).fill({}),offerHistory:[],refreshRemaining:2,seed:'must-not-copy',futureScore:99,randomState:{future:'hidden'}};
 return {metadata:{difficulty:'pro',source:'autoplay',seed:'private-start'},result:{score:{displayScore:12,experience:50,enrollment:32,satisfaction:15,accounting:15,withdrawal:0,enrollmentDiff:32,rank:{grade:'S'}}},events:[{type:'research-acquisition-decision',turn:0,observation,chosenIndices:[0,1]},{type:'research-deletion-decision',turn:0,observation,deleteMax:1,decisions:[{cardNo:1}]}]};
}
test('判断時の公開状態を行動・結果から分離し、実seedと未来をコピーしない',()=>{
 const d=extractAhiruDecisionRows(fixture(),{gameId:'game-0'});assert.equal(d.publicRows.length,2);assert.equal(d.weightPerDecision,.5);
 assert.equal(d.publicRows[0].phase,'acquisition');assert.equal(d.publicRows[1].phase,'deletion');assert.deepEqual(d.labels[0].action.cardNos,['6','7']);assert.deepEqual(d.labels[1].action.cardNos,['1']);assert.equal(d.outcome.score,12);assert.equal(d.publicRows[1].deleteMax,1);
 for(const r of d.publicRows){assert.equal('action' in r,false);assert.equal('score' in r,false);for(const key of ['seed','futureScore','randomState'])assert.equal(key in r.observation,false);}
});
test('成績を変更しても公開入力と実行動を変えず、発想の合法スキップを残す',()=>{
 const r=fixture();for(const key of ['seed','futureScore','randomState'])Object.defineProperty(r.events[0].observation,key,{get(){throw Error('private access');}});const before=extractAhiruDecisionRows(r,{gameId:'game-0'});r.result.score.displayScore=-4;
 const after=extractAhiruDecisionRows(r,{gameId:'game-0'});assert.deepEqual(after.publicRows,before.publicRows);assert.deepEqual(after.labels,before.labels);assert.equal(after.outcome.score,-4);
 r.events[0].observation.pickCount=1;r.events[0].observation.allowSkip=true;r.events[0].chosenIndices=[];
 assert.equal(extractAhiruDecisionRows(r,{gameId:'game-0'}).labels[0].action.skipped,true);
});
test('通常外・途中記録・不正な取得・所有数を超える削除を拒否する',()=>{
 for(const change of [r=>r.metadata.reroll={attempts:2},r=>r.metadata.calcMode=true,r=>r.metadata.source='counterfactual',r=>r.truncated=true,r=>r.events[0].chosenIndices=[0,99],r=>r.events[0].chosenIndices=[0,0],r=>r.events[1].decisions=[{cardNo:1},{cardNo:1}],r=>r.events[1].decisions=[{cardNo:99}]]){
  const r=fixture();change(r);assert.throws(()=>extractAhiruDecisionRows(r,{gameId:'game-0'}));
 }
});
