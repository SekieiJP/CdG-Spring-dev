import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSceneBatch} from '../../solver/pro-card-scene-input.mjs';
import {collectMeetingScenes} from '../../solver/pro-meeting-scene-bank.mjs';
import {compareSceneArms} from '../../solver/pro-card-scene-metrics.mjs';
const versions=['game','cards','ranks'];
function observation(){return {schema:1,difficulty:'pro',mode:'normal',turn:0,totalTurns:8,
 stats:{experience:8,enrollment:0,satisfaction:4,accounting:4},tokens:{passion:1,fatigue:0,inspiration:1,organize:0},
 owned:[{cardNo:'1',rarity:'N'},{cardNo:'5',rarity:'N'},{cardNo:'7',rarity:'R'}],candidates:[],pickCount:0,allowSkip:false,
 turns:Array.from({length:8},()=>({deletion:1})),offerHistory:[],refreshRemaining:2,
 seed:'実ゲームの種',futureDeck:[4,5],result:16};}
function bank(){return {kind:'meeting',cardNo:1,versions,scenes:Array.from({length:250},(_,i)=>({sceneId:`meeting-${i}`,
 observation:observation(),targetOwnedIndex:0,deleteMax:1}))};}
function sourceRecords(){return Array.from({length:250},(_,i)=>({metadata:{difficulty:'pro',source:'autoplay',seed:`source:${i}`,
 provenance:{codeHash:'game',strategyVersion:'actor'},cardVersion:'cards',rankVersion:'ranks',research:{id:'same',deletion:'aggressive'}},
 events:[...Array.from({length:8},(_,turn)=>({type:'research-placement-decision',turn})),{type:'research-deletion-decision',turn:0,observation:observation(),deleteMax:1}],result:{score:{displayScore:i%2?10:14}}}));}
function armRecords(name){const batch=prepareSceneBatch(JSON.stringify(bank()),name,{episodes:250,versions});
 return batch.scenes.map((s,i)=>({metadata:{difficulty:'pro',source:'counterfactual',seed:`future:${i}`,sceneId:s.sceneId,sceneArm:name,
 sceneKind:'meeting',sceneTurn:0,sceneBankSha256:batch.sha256,sceneObservationSha256:s.observationSha256,forcedChoice:[],forcedMeeting:s.forcedMeeting,
 provenance:{strategyVersion:'same',codeHash:'game'},cardVersion:'cards',rankVersion:'ranks',catalog:[{cardNo:'1'},{cardNo:'5'},{cardNo:'7'}]},
 events:[{type:'research-counterfactual-start',observation:s.observation,forcedChoice:[]},...s.observation.owned.map(card=>({type:'acquire',turn:0,card})),
 ...(name==='target'?[{type:'delete',turn:0,card:s.observation.owned[0]}]:[]),
 {type:'research-meeting-intervention',turn:0,instruction:s.forcedMeeting,removedCardNo:name==='target'?'1':null}],
 result:{score:{displayScore:name==='target'?12:13,withdrawal:0,enrollmentDiff:32,experience:40,enrollment:32,satisfaction:25,accounting:15},finalDeck:[]}}));}
test('会議の1枚だけを保持/削除し、実シードと未来を渡さない',()=>{
 const bytes=JSON.stringify(bank()),a=prepareSceneBatch(bytes,'reference',{episodes:250,versions}),b=prepareSceneBatch(bytes,'target',{episodes:250,versions});
 assert.deepEqual(a.scenes.map(s=>s.observationSha256),b.scenes.map(s=>s.observationSha256));
 assert.equal(a.scenes[0].forcedMeeting.action,'keep');assert.equal(b.scenes[0].forcedMeeting.action,'delete');
 assert.deepEqual(b.scenes[0].forcedChoice,[]);assert.equal('seed' in b.scenes[0].observation,false);
 assert.equal('futureDeck' in b.scenes[0].observation,false);assert.equal('result' in b.scenes[0].observation,false);
 assert.equal(b.scenes[0].observation.tokens.inspiration,1);
});
test('削除不可、最終会議、所持していない札、容量改変、版違いを拒否する',()=>{
 for(const mutate of [s=>s.deleteMax=0,s=>s.observation.turn=7,s=>s.targetOwnedIndex=1,s=>s.deleteMax=2,s=>s.observation.pickCount=1]){
  const b=bank();mutate(b.scenes[0]);assert.throws(()=>prepareSceneBatch(JSON.stringify(b),'target',{episodes:250,versions}));
 }
 assert.throws(()=>prepareSceneBatch(JSON.stringify(bank()),'target',{episodes:250,versions:['other','cards','ranks']}));
 assert.throws(()=>prepareSceneBatch(JSON.stringify(bank()),'target',{episodes:250,offset:1,versions}));
});
test('基本札の初会議を同じ250開始から収集し、結果変更で抽出内容が変わらない',()=>{
 const rs=sourceRecords(),a=collectMeetingScenes(rs,{cardNo:1});
 assert.equal(a.bank.scenes.length,250);assert.equal(new Set(a.audit.map(s=>s.sourceSeed)).size,250);
 const altered=structuredClone(rs);for(const r of altered)r.result.score.displayScore=-13;
 assert.deepEqual(collectMeetingScenes(altered,{cardNo:1}).bank,a.bank);
 const b=collectMeetingScenes(rs,{cardNo:5});assert.equal(b.bank.scenes[0].targetOwnedIndex,1);
 assert.equal('sourceSeed' in a.bank.scenes[0],false);
});
test('元記録の重複、リセマラ、未完走、250未満、方略混在を拒否する',()=>{
 for(const mutate of [r=>r[1].metadata.seed=r[0].metadata.seed,r=>r[0].metadata.reroll={attempts:2},r=>r[0].truncated=true,
  r=>r[0].metadata.research={id:'same',deletion:'off'},r=>r[0].metadata.provenance.strategyVersion='other',
  r=>r[0].events.shift(),r=>r.pop()]){
  const rs=sourceRecords();mutate(rs);assert.throws(()=>collectMeetingScenes(rs,{cardNo:1}));
 }
});
test('合法削除と保持を同じ未来シードで集計し、復元札を取得数から除く',()=>{
 const r=compareSceneArms(armRecords('reference'),armRecords('target'));
 assert.equal(r.n,250);assert.equal(r.comparison.meanDifference,-1);assert.equal(r.target.activity.acquisitions,0);
 assert.equal(r.target.activity.deleted,1);assert.equal(r.reference.activity.deleted,0);assert.equal(r.byTurn[1].n,250);
});
test('別札削除、追加削除、保持側削除、異なる会議容量の対を拒否する',()=>{
 for(const mutate of [r=>r.events.find(e=>e.type==='delete').card={cardNo:'5'},r=>r.events.splice(5,0,{type:'delete',card:{cardNo:'5'}}),
  r=>r.metadata.forcedMeeting={...r.metadata.forcedMeeting,deleteMax:2}]){
  const a=armRecords('reference'),b=armRecords('target');mutate(b[0]);assert.throws(()=>compareSceneArms(a,b));
 }
 const a=armRecords('reference');a[0].events.splice(4,0,{type:'delete',card:{cardNo:'1'}});assert.throws(()=>compareSceneArms(a,armRecords('target')));
});
