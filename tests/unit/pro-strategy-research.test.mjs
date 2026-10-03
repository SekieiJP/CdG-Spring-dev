import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GameState} from '../../game/js/gameState.js';
import {CardManager} from '../../game/js/cardManager.js';
import {ScoreManager} from '../../game/js/scoreManager.js';
import {TurnManager} from '../../game/js/turnManager.js';
import {createAdvisorObservation} from '../../game/js/acquisitionAdvisor.js';
import {proGoal,projectProDeck} from '../../game/js/proAcquisitionAdvisor.js';
import {createResearchPolicy,targetRoutes} from '../../solver/browser/pro-strategy-research.js';
import {VALUE_FEATURES,VALUE_SCHEMA,encodeValueFeatures,predictValue,trainValueModel,unpackValueObservation} from '../../solver/browser/pro-value-model.js';
import {extractValueRows} from '../../solver/pro-value-dataset.mjs';
import {median,wilson,retryEstimate,summarizeOutcomes,pairedOutcomes} from '../../solver/pro-strategy-metrics.mjs';
const cm=new CardManager(null);cm.parseCSV(readFileSync(new URL('../../game/data/cards_pro.csv',import.meta.url),'utf8'));
const sm=new ScoreManager(null),savedFetch=globalThis.fetch;
globalThis.fetch=async()=>({ok:true,text:async()=>readFileSync(new URL('../../game/data/rankPro.csv',import.meta.url),'utf8')});
await sm.loadRankData('test');globalThis.fetch=savedFetch;
const card=n=>cm.allCards.find(c=>Number(c.cardNo)===n);
function setup(config={},valueModel=null){const state=new GameState(null);state.reset('pro',{seed:'test'});cm.getBasicCards().forEach(c=>state.addToDeck({...c}));
 const tm=new TurnManager(state,cm,null);
 const clone=s=>({difficulty:'pro',turn:s.turn,totalTurns:8,player:Object.fromEntries(['experience','enrollment','satisfaction','accounting'].map(k=>[k,s.player[k]])),tokens:{...s.tokens},
 updateStatus(k,d){const old=this.player[k];this.player[k]=Math.max(0,old+d);if(k==='enrollment')this.player[k]=Math.min(this.player[k],this.player.experience);return this.player[k]-old;}});
 const enumerate=(hand,counts)=>hand.flatMap((c,i)=>{const p=cm.parseEffect(c.effect),slots=p.staffRestrictions.length?p.staffRestrictions:['leader','teacher','staff'];
 return slots.filter(slot=>c.effect.includes('並行')||counts[slot]===0).map(slot=>({cardIndex:i,card:c,slot}));});
 const strategy=createResearchPolicy({projectDeck:projectProDeck,score:proGoal,cloneState:clone,resolve:(c,slot,s)=>tm.resolveCardAction(c,slot,s),enumerateOptions:enumerate,catalog:cm.allCards,config,valueModel});
 return {state,tm,clone,enumerate,strategy,observe:(cs=[],options={})=>createAdvisorObservation(state,cs,{rankTable:sm.rankTable,...options})};}
test('15点の経路は公式ScoreManagerに一致し、14点目標と異なる',()=>{
 const {state}=setup(),routes=targetRoutes(sm.rankTable,15);
 assert.deepEqual(routes.filter(r=>r.withdrawal===0).map(r=>[r.experience,r.enrollment,r.satisfaction,r.accounting]).sort(),[[48,48,35,15],[50,40,35,15],[50,48,25,15]].sort());
 for(const route of routes){Object.assign(state.player,route);assert.ok(sm.calculateScore(state).points>=15);}
 for(const accounting of [0,10,13]){Object.assign(state.player,{experience:60,enrollment:60,satisfaction:40,accounting});assert.ok(sm.calculateScore(state).points<15);}
 assert.notDeepEqual(targetRoutes(sm.rankTable,14),routes);
});
test('最終手札の合法な順序探索は小手札の全探索で得られる最大得点と一致する',()=>{
 const {state,tm,clone,enumerate,strategy,observe}=setup();state.turn=7;Object.assign(state.player,{experience:47,enrollment:40,satisfaction:35,accounting:15});
 const hand=[card(42),card(25),card(30),card(15)],snapshot=JSON.stringify(state);
 let exact=sm.calculateScore(state).points;const slots=['leader','teacher','staff'];
 function dfs(s,counts,used){exact=Math.max(exact,sm.calculateScore(s).points);for(const opt of enumerate(hand,counts)){
  if(used.has(opt.cardIndex)||slots.slice(slots.indexOf(opt.slot)+1).some(slot=>counts[slot]))continue;
  const next=clone(s);if(!tm.resolveCardAction(opt.card,opt.slot,next).applied)continue;
  dfs(next,{...counts,[opt.slot]:counts[opt.slot]+1},new Set([...used,opt.cardIndex]));}}
 dfs(clone(state),{leader:0,teacher:0,staff:0},new Set());
 for(const mode of ['median','ceiling','engine','myopic']){const next=clone(state);for(const p of strategy.placements(observe(),hand,state,mode))tm.resolveCardAction(hand[p.cardIndex],p.slot,next);assert.equal(sm.calculateScore(next).points,exact);}
 assert.equal(JSON.stringify(state),snapshot);
});
test('公開観測以外のseed・山札順を方略は参照せず、最終ターンの未来トークンを加点しない',()=>{
 const {state,strategy,observe}=setup();state.turn=7;Object.assign(state.player,{experience:45,enrollment:40,satisfaction:35,accounting:16});
 const observation=observe([card(49),card(25)]),before=JSON.stringify(state);
 for(const mode of ['median','ceiling','engine'])assert.deepEqual(strategy.acquisition(observation,mode),strategy.acquisition({...observation,seed:'future',rng:{next(){throw Error('private');}},deckOrder:['hidden']},mode));
 assert.equal(strategy.forecast(observation,[card(49)],'engine').engine,0);assert.equal(JSON.stringify(state),before);
});
test('全51定義を複数の条件・コスト状態で有限値として評価できる',()=>{
 const {state,strategy,observe}=setup();
 for(const turn of [0,2,5,7])for(const stats of [[0,0,3,5],[25,15,10,2],[45,40,26,17]]){
  state.turn=turn;Object.assign(state.player,Object.fromEntries(['experience','enrollment','satisfaction','accounting'].map((k,i)=>[k,stats[i]])));
  for(const mode of ['median','ceiling','engine']){
   const advice=strategy.acquisition(observe(cm.allCards,{allowSkip:true}),mode);
   assert.equal(advice.evaluations.length,52);assert.ok(advice.evaluations.every(e=>Number.isFinite(e.score)&&Object.values(e.forecast).every(Number.isFinite)));
  }
 }
});
test('削除停止と役割を保つ削除は最後の庶務役を保護する',()=>{
 const {state,strategy,observe}=setup();state.player.deck=[];for(const n of [1,2,3,4,5,7,10,42])state.addToDeck({...card(n)});
 assert.deepEqual(strategy.deletions(observe(),4,'off'),[]);
 assert.ok(strategy.deletions(observe(),4,'aggressive').every(d=>String(d.cardNo)!=='5'));
 state.turn=7;assert.deepEqual(strategy.deletions(observe(),4,'basic'),[]);
});
const outcome=(i,score=11)=>({seed:`test:${i}`,score,stats:{experience:40,enrollment:32,satisfaction:25,accounting:15,withdrawal:0,difference:32},deckSize:10,acquisitions:9,deleted:4,drawn:32,placed:24,applied:24,failed:0,firstOfferHash:'same',provenance:{codeHash:'frozen'},cardVersion:'cards',rankVersion:'ranks',source:'autoplay'});
test('中央値は偶数件の中央2値の平均、15点はランク名ではなく実得点で判定する',()=>{
 assert.equal(median([10,11]),10.5);const a=Array.from({length:250},(_,i)=>outcome(i,i===0?15:14));const s=summarizeOutcomes(a);
 assert.equal(s.score15.count,1);assert.equal(s.score14.count,250);assert.equal(s.median,14);assert.ok(s.score15.interval95[1]>s.score15.rate);
});
test('250シード未満・重複・版の混在を集計や対比較は拒否する',()=>{
 const a=Array.from({length:250},(_,i)=>outcome(i));assert.throws(()=>summarizeOutcomes(a.slice(1)),/250/);
 assert.throws(()=>summarizeOutcomes([...a,a[0]]),/重複/);assert.throws(()=>pairedOutcomes(a,a.slice(1)),/250/);
 assert.throws(()=>summarizeOutcomes(a.map((r,i)=>i===0?{...r,rankVersion:'changed'}:r)),/異なる/);
 assert.throws(()=>summarizeOutcomes(a.map((r,i)=>({...r,policy:i===0?'ceiling':'median'}))),/方略/);
 assert.throws(()=>summarizeOutcomes(a.map((r,i)=>i===0?{...r,seed:'other-stage:0'}:r)),/シード群/);
 const b=a.map(r=>({...r,score:12}));const p=pairedOutcomes(a,b,{iterations:100});assert.equal(p.medianDifference,1);assert.equal(p.meanDifference,1);assert.deepEqual(p.score15RateDifference95,[0,0]);assert.equal(p.firstOfferMismatches,0);
});
test('0件の成功を不可能や有限の平均試行回数として扱わない',()=>{
 const zero=retryEstimate(0,250);assert.equal(zero.expectedAttempts,null);assert.equal(zero.expectedAttempts95[1],null);assert.ok(wilson(0,250)[1]>0);
 const r=retryEstimate(25,250,[10]);assert.equal(r.expectedAttempts,10);assert.ok(Math.abs(r.successWithin[0].probability-(1-.9**10))<1e-12);
});

test('仮想将来による最終ターン取得は公式得点を伸ばし、非公開情報を読まない',()=>{
 const {state,strategy,observe}=setup({planning:{worlds:8,rolloutBeam:32}});state.turn=7;
 Object.assign(state.player,{experience:49,enrollment:47,satisfaction:25,accounting:15});state.player.deck=[];
 const observation=observe([card(25),card(15)]),snapshot=JSON.stringify(state);
 for(const key of ['seed','rng','deckOrder','trainingDecks'])Object.defineProperty(observation,key,{enumerable:true,get(){throw Error('private');}});
 const advice=strategy.acquisition(observation,'rollout');assert.deepEqual(advice.recommended.indices,[0]);
 assert.equal(advice.recommended.mean,14);assert.equal(JSON.stringify(state),snapshot);
});
test('仮想将来で最終ターンの情熱は実スコアに加点されない',()=>{
 const {state,strategy,observe}=setup({planning:{worlds:4}});state.turn=7;state.player.deck=[];
 Object.assign(state.player,{experience:45,enrollment:40,satisfaction:35,accounting:15});
 const advice=strategy.acquisition(observe([card(49),card(15)]),'rollout');
 assert.ok(advice.evaluations.every(e=>e.mean===14));
});
test('仮想将来の配置も配置順・コスト・条件を本体と共有する',()=>{
 const {state,strategy,observe,tm,clone}=setup({planning:{worlds:4}});state.turn=7;
 Object.assign(state.player,{experience:47,enrollment:40,satisfaction:35,accounting:15});const hand=[card(42),card(25),card(30),card(15)];
 const seq=strategy.placements(observe(),hand,state,'rollout'),next=clone(state);
 for(const p of seq)assert.ok(tm.resolveCardAction(hand[p.cardIndex],p.slot,next).applied);
 assert.equal(sm.calculateScore(next).points,16);assert.deepEqual(strategy.deletions(observe(),3,'rollout'),[]);
});

test('残りターンと取得予定の成長・経理の余裕を含む評価も全カードで有限',()=>{
 for(const config of [{signedGrowth:true,safetyBuffer:2,tokenHorizon:true,futureAllowance:1},{sigma:.6,caps:{satisfaction:25},statScale:.35,smoothWeight:12}]){
  const {state,strategy,observe}=setup(config);for(const turn of [0,3,6,7]){state.turn=turn;
   Object.assign(state.player,{experience:20,enrollment:12,satisfaction:15,accounting:8});
   const advice=strategy.acquisition(observe(cm.allCards,{allowSkip:true}),'engine');assert.ok(advice.evaluations.every(e=>Number.isFinite(e.score)));}
 }
});

test('基準配置を使う仮想将来も隠れた乱数を消費せず、状態を変更しない',()=>{
 const {state,strategy,observe}=setup({safetyBuffer:2,adaptiveDraw:true,planning:{worlds:4,futurePolicy:'baseline',futureBeam:24}});
 state.turn=6;Object.assign(state.player,{experience:35,enrollment:30,satisfaction:28,accounting:13});
 const snapshot=JSON.stringify(state),ob=observe([card(25),card(40)]);
 for(const key of ['seed','rng','trainingDecks'])Object.defineProperty(ob,key,{enumerable:true,get(){throw Error('private');}});
 const advice=strategy.acquisition(ob,'rollout');assert.ok(advice.evaluations.every(e=>Number.isFinite(e.score)));assert.equal(JSON.stringify(state),snapshot);
});

const tinyModel=(feature,value=2)=>({schema:VALUE_SCHEMA,features:[...VALUE_FEATURES],base:10,learningRate:1,trees:[{feature:VALUE_FEATURES.indexOf(feature),threshold:.5,left:{value:0},right:{value}}]});
test('学習評価の特徴は公開状態だけから作り、非公開getterと過去の教師ラベルを読まない',()=>{
 const {strategy,observe}=setup(),ob=observe();
 const clean=encodeValueFeatures(ob,'acquisition',{forecast:strategy.forecast,score:proGoal});
 for(const key of ['seed','rng','deckOrder','trainingDecks','target'])Object.defineProperty(ob,key,{enumerable:true,get(){throw Error('private');}});
 assert.deepEqual(encodeValueFeatures(ob,'acquisition',{forecast:strategy.forecast,score:proGoal}),clean);
 assert.equal(clean.length,VALUE_FEATURES.length);assert.ok(clean.every(Number.isFinite));
 const after=encodeValueFeatures(ob,'after-action',{forecast:strategy.forecast,score:proGoal});assert.equal(after[VALUE_FEATURES.indexOf('remaining')],7);
});
test('学習した固定木は、状態ごとに取得・スキップを選び、元の状態を変更しない',()=>{
 const {strategy,observe,state}=setup({learned:{blend:0}},tinyModel('count-15'));
 const ob=observe([card(6),card(15),card(13)],{allowSkip:true}),before=JSON.stringify(state);
 for(const key of ['seed','rng','deckOrder','trainingDecks'])Object.defineProperty(ob,key,{enumerable:true,get(){throw Error('private');}});
 assert.deepEqual(strategy.acquisition(ob,'learned').recommended.indices,[1]);
 assert.equal(JSON.stringify(state),before);
 const negative=setup({learned:{blend:0}},tinyModel('count-15',-2));assert.deepEqual(negative.strategy.acquisition(negative.observe([card(15)],{allowSkip:true}),'learned').recommended.indices,[]);
});
test('学習評価の最終ターンも公式最大得点を優先し、未来トークンを利用しない',()=>{
 const {state,strategy,observe,clone,tm}=setup({learned:{blend:0}},tinyModel('token-passion',100));state.turn=7;
 Object.assign(state.player,{experience:47,enrollment:40,satisfaction:35,accounting:15});const hand=[card(42),card(25),card(30),card(15)];
 const next=clone(state);for(const p of strategy.placements(observe(),hand,state,'learned'))assert.ok(tm.resolveCardAction(hand[p.cardIndex],p.slot,next).applied);
 assert.equal(sm.calculateScore(next).points,16);assert.deepEqual(strategy.deletions(observe(),4,'learned'),[]);
});
test('木の学習は固定乱数で再現し、特徴版の不一致を拒否する',async()=>{
 const rows=Array.from({length:160},(_,i)=>({x:VALUE_FEATURES.map((n,j)=>j===5?i%20:0),y:3+(i%20)*.3,weight:1}));
 const options={iterations:25,depth:2,minRows:5,minWeight:3,l2:.1,featureFraction:1,rowFraction:1,learningRate:.2,monotone:true};
 const a=await trainValueModel(rows,options),b=await trainValueModel(rows,options);assert.deepEqual(a,b);
 const predictions=Array.from({length:20},(_,v)=>predictValue(a,VALUE_FEATURES.map((n,j)=>j===5?v:0)));
 assert.ok(predictions.every((p,i)=>!i||p>=predictions[i-1]));assert.ok(predictions.at(-1)-predictions[0]>4);
 assert.throws(()=>predictValue({...a,schema:'different'},rows[0].x),/特徴版/);
});
test('学習用の記録は取得後・解決後・削除後を分け、ゲームごとの重みを1にする',()=>{
 const {observe}=setup(),ob=observe([card(13),card(15)],{pickCount:1,allowSkip:true});ob.tokens.inspiration=2;
 const rec={metadata:{difficulty:'pro',seed:'audit:0'},result:{score:{displayScore:12}},events:[
  {type:'research-acquisition-decision',observation:ob,chosenIndices:[0]},
  {type:'research-placement-decision',turn:0,observation:ob},
  {type:'resolve',turn:0,afterStats:{experience:5,enrollment:2,satisfaction:7,accounting:8},afterTokens:{passion:2,fatigue:1,inspiration:2,organize:1}},
  {type:'research-deletion-decision',turn:0,decisions:[{cardNo:1}]}]};
 const rows=extractValueRows(rec);assert.equal(rows.reduce((s,r)=>s+r.weight,0),1);assert.equal(rows[0].observation.tokens[2],1);
 assert.deepEqual(rows[1].observation.stats,[5,2,7,8]);assert.equal(rows[2].observation.turn,1);assert.deepEqual(rows[2].observation.tokens,[2,1,2,0]);assert.equal(rows[2].observation.owned.filter(c=>c[0]===1).length,0);
 const restored=unpackValueObservation(rows[2].observation,{catalog:cm.allCards,rankTable:sm.rankTable,turns:ob.turns});assert.equal(restored.tokens.inspiration,2);
 assert.throws(()=>extractValueRows({...rec,metadata:{...rec.metadata,reroll:{}}}),/リセマラなし/);
});

test('平均目標とは別に13点等の経路を設定でき、公式到達点と一致する',()=>{
 for(const target of [12,13,14]){const {state,strategy,observe}=setup({targetScore:target});for(const route of targetRoutes(sm.rankTable,target)){Object.assign(state.player,route);assert.ok(sm.calculateScore(state).points>=target);}assert.ok(Number.isFinite(strategy.value(observe().stats,observe(),'engine')));}
 assert.throws(()=>setup({targetScore:17}),/1〜16/);
});
