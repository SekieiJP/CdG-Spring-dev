import test from 'node:test';
import assert from 'node:assert/strict';
import {collectChoiceScenes} from '../../solver/pro-choice-scene-bank.mjs';
const actor='fixed-source',config={id:'baseline',acquisition:'learned',deletion:'aggressive',planning:{worlds:8,valueHorizon:2}};
function ob(turn){return {schema:1,difficulty:'pro',mode:'normal',turn,totalTurns:8,stats:{experience:20,enrollment:10,satisfaction:12,accounting:15},tokens:{passion:0,fatigue:0,inspiration:0,organize:0},owned:[{cardNo:'1',acquiredTurn:0}],candidates:[{cardNo:'6'},{cardNo:'7'},{cardNo:'8'},{cardNo:'9'}],pickCount:turn===0?2:1,allowSkip:false,turns:Array(8).fill({}),offerHistory:[],refreshRemaining:2,seed:'hidden-source',futureResult:16};}
function sources(){return ['train','train','validation'].map((split,b)=>({split,file:`file-${b}`,sha256:'source-sha',data:{settings:{episodes:250,episodeOffset:0,seed:`source-${b}`,research:structuredClone(config),provenance:{strategyVersion:actor}},simulations:[{playRecords:Array.from({length:250},(_,i)=>({metadata:{difficulty:'pro',source:'autoplay',seed:`source-${b}:${i}`,provenance:{codeHash:'game',strategyVersion:actor},cardVersion:'cards',rankVersion:'ranks',research:structuredClone(config)},events:Array.from({length:8},(_,turn)=>{const chosen=turn===0?[0,1]:[0],other=turn===0?[0,2]:[1];return [{type:'research-acquisition-decision',turn,observation:ob(turn),chosenIndices:chosen,advice:{recommended:{indices:chosen},evaluations:[{indices:chosen},{indices:other}]}},{type:'research-placement-decision',turn,observation:ob(turn)}];}).flat(),result:{score:{displayScore:12}}}))}]}}));}
test('全500学習開始と別250検証開始から各1局面を時期順で収集し、結果で選別しない',()=>{
 const s=sources(),a=collectChoiceScenes(s,{expectedSourceActor:actor});assert.deepEqual(a.audit.counts,{train:500,validation:250});assert.equal(a.bank.scenes.length,750);
 assert.deepEqual(a.bank.scenes.slice(0,4).map(s=>s.observation.turn),[0,2,4,6]);
 assert.equal(new Set(a.audit.sceneAudit.map(s=>s.sourceSeed)).size,750);assert.equal('sourceSeed' in a.bank.scenes[0],false);assert.equal('seed' in a.bank.scenes[0].observation,false);
 for(const source of s)for(const r of source.data.simulations[0].playRecords)r.result.score.displayScore=-13;
 assert.deepEqual(collectChoiceScenes(s,{expectedSourceActor:actor}).bank,a.bank);
});
test('欠落・途中打ち切り・リセマラ・元方略混在・学習検証の同じ開始を拒否',()=>{
 for(const mutate of [s=>s[0].data.simulations[0].playRecords.pop(),s=>s[0].data.simulations[0].playRecords[0].truncated=true,
  s=>s[0].data.simulations[0].playRecords[0].metadata.reroll={attempts:2},s=>s[0].data.settings.provenance.strategyVersion='other',
  s=>s[2].data.settings.seed='source-0',s=>s[0].data.simulations[0].playRecords[0].events.pop()]){
  const s=sources();mutate(s);assert.throws(()=>collectChoiceScenes(s,{expectedSourceActor:actor}));
 }
 const s=sources();for(let i=0;i<250;i++)s[2].data.simulations[0].playRecords[i].metadata.seed=`source-0:${i}`;s[2].data.settings.seed='source-0';assert.throws(()=>collectChoiceScenes(s,{expectedSourceActor:actor}),/シード重複/);
});
test('当時の実選択と異なる参照指定や、公開済み次順位がない記録を拒否',()=>{
 for(const mutate of [e=>e.chosenIndices=[2,3],e=>e.advice.evaluations.splice(1)]){
  const s=sources();mutate(s[0].data.simulations[0].playRecords[0].events[0]);assert.throws(()=>collectChoiceScenes(s,{expectedSourceActor:actor}));
 }
});
