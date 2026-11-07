import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSceneBatch} from '../../solver/pro-card-scene-input.mjs';
import {encodePairedFeatures,reversePairedFeatures,predictPairedGain,PAIRED_FEATURES,PAIRED_SCHEMA} from '../../solver/browser/pro-paired-value.js?v=20260815-0060';
import {VALUE_FEATURES} from '../../solver/browser/pro-value-model.js?v=20260815-0060';
const versions=['game','cards','ranks'];
function observation(turn=0){const card=n=>({cardNo:String(n),cardName:'Card'+n,rarity:'R',category:'動員',effect:'体験+2'});
 return {difficulty:'pro',mode:'normal',turn,totalTurns:8,stats:{experience:8,enrollment:2,satisfaction:10,accounting:9},tokens:{passion:1,fatigue:0,inspiration:1,organize:0},owned:[card(1)],candidates:[card(6),card(7),card(8),card(9)],pickCount:turn===0?2:1,allowSkip:false,turns:Array(8).fill({}),offerHistory:[],refreshRemaining:2,seed:'実シード',futureScore:16,rankTable:[]};}
function bank(){return {kind:'choices',versions,scenes:Array.from({length:250},(_,i)=>({sceneId:'choice-'+i,observation:observation(),referenceIndices:[0,1],targetIndices:[0,2]}))};}
const context={forecast:(o,cards)=>({end:{...o.stats,experience:o.stats.experience+cards.length},engine:cards.length,risk:0,draw:4}),score:stats=>({points:stats.experience/10,smoothPoints:stats.experience/10})};
test('初回2枚取得の共通公開状態を保ち、実シード・未来・結果を渡さない',()=>{
 const a=prepareSceneBatch(JSON.stringify(bank()),'reference',{episodes:250,versions}),b=prepareSceneBatch(JSON.stringify(bank()),'target',{episodes:250,versions});
 assert.deepEqual(a.scenes[0].forcedChoice,[0,1]);assert.deepEqual(b.scenes[0].forcedChoice,[0,2]);assert.equal(a.scenes[0].observationSha256,b.scenes[0].observationSha256);
 assert.equal('seed' in b.scenes[0].observation,false);assert.equal('futureScore' in b.scenes[0].observation,false);
});
test('後の1枚取得に対応し、同じ選択・不合法な枚数・スキップ・版違いを拒否',()=>{
 const b=bank();for(const s of b.scenes){s.observation=observation(4);s.referenceIndices=[0];s.targetIndices=[1];}
 assert.equal(prepareSceneBatch(JSON.stringify(b),'target',{episodes:250,versions}).scenes[0].observation.turn,4);
 for(const mutate of [s=>s.targetIndices=[0],s=>s.targetIndices=[0,1],s=>s.observation.allowSkip=true,s=>s.targetIndices=[99]]){
  const x=structuredClone(b);mutate(x.scenes[0]);assert.throws(()=>prepareSceneBatch(JSON.stringify(x),'target',{episodes:250,versions}));
 }
 assert.throws(()=>prepareSceneBatch(JSON.stringify(b),'target',{episodes:250,versions:['other','cards','ranks']}));
});
test('取得差特徴は公開値だけを使い、逆向きは同じ根の状態と差の符号反転',()=>{
 const o=observation(),a=encodePairedFeatures(o,[0,1],[0,2],context),b=encodePairedFeatures(o,[0,2],[0,1],context);
 assert.equal(a.length,PAIRED_FEATURES.length);assert.deepEqual(reversePairedFeatures(a),b);assert.deepEqual(reversePairedFeatures(b),a);
 const dangerous={...o};for(const key of ['seed','futureScore','futureDeck','rng'])Object.defineProperty(dangerous,key,{get(){throw Error('hidden access');}});
 assert.deepEqual(encodePairedFeatures(dangerous,[0,1],[0,2],context),a);
});
test('得点差の予測は基準と別取得を交換すると必ず符号を反転する',()=>{
 const x=encodePairedFeatures(observation(),[0,1],[0,2],context),f=VALUE_FEATURES.length+VALUE_FEATURES.indexOf('count-8');
 const model={schema:PAIRED_SCHEMA,features:[...PAIRED_FEATURES],base:100,learningRate:1,trees:[{feature:f,threshold:0,left:{value:-2},right:{value:3}}]};
 assert.equal(predictPairedGain(model,x),2.5);assert.equal(predictPairedGain(model,reversePairedFeatures(x)),-2.5);
 assert.throws(()=>predictPairedGain({...model,schema:'wrong'},x));
 assert.throws(()=>predictPairedGain(model,x.slice(1)));
});
