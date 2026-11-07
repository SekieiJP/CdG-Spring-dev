import test from 'node:test';
import assert from 'node:assert/strict';
import {extractValueRows} from '../../solver/pro-value-dataset.mjs';
import {policyIdentity,auditPolicyRecord} from '../../solver/pro-policy-value-preflight.mjs';
const versions=['code','cards','ranks','autoplay'];
const config={id:'baseline',acquisition:'learned',planning:{worlds:8,valueHorizon:2},deletion:'aggressive'};
function record(){
 const observation={turn:0,stats:{experience:4,enrollment:2,satisfaction:5,accounting:15},tokens:{passion:0,fatigue:0,inspiration:0,organize:0},owned:[{cardNo:'1',acquiredTurn:0}],candidates:[{cardNo:'6',acquiredTurn:0}],offerHistory:[],allowSkip:false,refreshRemaining:2};
 return {metadata:{difficulty:'pro',seed:'test:0',provenance:{codeHash:'code'},cardVersion:'cards',rankVersion:'ranks',source:'autoplay',research:structuredClone(config)},events:Array.from({length:8},(_,turn)=>[{type:'research-acquisition-decision',turn,observation:{...observation,turn},chosenIndices:[0]},{type:'research-placement-decision',turn,observation:{...observation,turn}}]).flat(),result:{score:{displayScore:12}}};
}
const options=()=>({policy:policyIdentity(config),versions,seen:new Set()});
test('表示用idとキー順以外は同じ方略として扱わない',()=>{
 assert.equal(policyIdentity(config),policyIdentity({deletion:'aggressive',planning:{valueHorizon:2,worlds:8},acquisition:'learned',id:'both2'}));
 assert.notEqual(policyIdentity(config),policyIdentity({...config,planning:{worlds:16,valueHorizon:2}}));
});
test('8ターンの完走公開状態を抽出し、同一seedの学習検証混在を拒む',()=>{
 const r=record(),o=options(),rows=auditPolicyRecord(r,o);assert.equal(rows.length,23);assert.equal(rows[0].target,12);
 assert.throws(()=>auditPolicyRecord(r,o),/シード重複/);
});
test('リセマラ・打ち切り・配置欠落・版差・方略差を拒む',()=>{
 const mutations=[r=>{r.metadata.reroll={attempts:2};},r=>{r.truncated=true;},r=>{r.events.pop();},r=>{r.metadata.cardVersion='new-cards';},r=>{r.metadata.research.deletion='rollout';}];
 for(const mutate of mutations){const r=record();mutate(r);assert.throws(()=>auditPolicyRecord(r,options()));}
});

test('公式得点内訳を教師としてコピーし、公開状態の判断入力には混ぜない',()=>{
 const r=record();r.result.score.breakdown={mobilizationPoints:4,enrollmentDiffPoints:6,satisfactionPoints:1,withdrawalPoints:1};
 const rows=extractValueRows(r);for(const row of rows){assert.deepEqual(row.targetComponents,r.result.score.breakdown);assert.equal(row.target,12);assert.equal(row.observation.targetComponents,undefined);assert.equal(row.observation.target,undefined);}
});
