import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {extractSceneRows} from '../../solver/pro-value-scene-dataset.mjs';
function record(arm){
 const o={difficulty:'pro',mode:'normal',turn:2,totalTurns:8,stats:{experience:20,enrollment:10,satisfaction:12,accounting:15},tokens:{passion:0,fatigue:0,inspiration:0,organize:0},owned:[{cardNo:'1',acquiredTurn:0}],candidates:[{cardNo:'43'},{cardNo:'49'}],pickCount:1,allowSkip:false,offerHistory:[],refreshRemaining:2};
 const chosen=arm==='target'?[0]:[1];
 return {metadata:{difficulty:'pro',source:'counterfactual',seed:'new-future:0',sceneId:'case-0',sceneArm:arm,sceneBankSha256:'a'.repeat(64),sceneObservationSha256:createHash('sha256').update(JSON.stringify(o)).digest('hex'),forcedChoice:chosen},
 events:[{type:'research-counterfactual-start',observation:o,forcedChoice:chosen},{type:'research-placement-decision',turn:2,observation:{...o,owned:[...o.owned,o.candidates[chosen[0]]]}},{type:'resolve',turn:2,afterStats:o.stats,afterTokens:o.tokens}],result:{score:{displayScore:12}}};
}
test('強制取得直後を含み、ゲームごとの総重みを保ち、2群を学習側で区別する',()=>{
 const a=extractSceneRows(record('reference')),b=extractSceneRows(record('target'));
 assert.notEqual(a[0].seed,b[0].seed);assert.equal(b[0].observation.phase,'acquisition');assert.deepEqual(b[0].observation.owned.at(-1),[43,2]);
 assert.ok(Math.abs(b.reduce((s,r)=>s+r.weight,0)-.5)<1e-12);assert.ok(b.every(r=>r.target===12));assert.equal(b[0].observation.seed,undefined);
});
test('異なる公開観測や局面継続以外の記録を追加学習に混ぜない',()=>{
 const a=record('target');a.events[0].observation.stats.accounting=99;assert.throws(()=>extractSceneRows(a),/観測と記録/);
 const b=record('target');b.metadata.source='autoplay';assert.throws(()=>extractSceneRows(b),/対照記録/);
});
