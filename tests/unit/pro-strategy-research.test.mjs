import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GameState} from '../../game/js/gameState.js?v=20261110-0065';
import {CardManager} from '../../game/js/cardManager.js?v=20261110-0065';
import {ScoreManager} from '../../game/js/scoreManager.js?v=20261110-0065';
import {TurnManager} from '../../game/js/turnManager.js?v=20261110-0065';
import {createAdvisorObservation} from '../../game/js/acquisitionAdvisor.js?v=20261110-0065';
import {proGoal,projectProDeck} from '../../game/js/proAcquisitionAdvisor.js?v=20261110-0065';
import {createResearchPolicy,targetRoutes} from '../../solver/browser/pro-strategy-research.js?v=20261110-0065';
import {VALUE_FEATURES,VALUE_SCHEMA,createValueForecaster,encodeValueFeatures,predictValue,trainValueModel,unpackValueObservation} from '../../solver/browser/pro-value-model.js?v=20261110-0065';
import {publicDraw,createRiskPolicy} from '../../solver/browser/pro-risk-research.js?v=20261110-0065';
import {predictionCalibration,deletionCoverage,forecastStatsCalibration} from '../../solver/pro-mean125-metrics.mjs';
import {remainingTrainingNames} from '../../solver/browser/pro-learned-research.js?v=20261110-0065';
import {extractValueRows} from '../../solver/pro-value-dataset.mjs';
import {median,wilson,retryEstimate,summarizeOutcomes,pairedOutcomes} from '../../solver/pro-strategy-metrics.mjs';
const cm=new CardManager(null);cm.parseCSV(readFileSync(new URL('../../game/data/cards_pro.csv',import.meta.url),'utf8'));
const sm=new ScoreManager(null),savedFetch=globalThis.fetch;
globalThis.fetch=async()=>({ok:true,text:async()=>readFileSync(new URL('../../game/data/rankPro.csv',import.meta.url),'utf8')});
await sm.loadRankData('test');globalThis.fetch=savedFetch;
const card=n=>cm.allCards.find(c=>Number(c.cardNo)===n);
function setup(config={},valueModel=null,openingTable=null){const state=new GameState(null);state.reset('pro',{seed:'test'});cm.getBasicCards().forEach(c=>state.addToDeck({...c}));
 const tm=new TurnManager(state,cm,null);
 const clone=s=>({difficulty:'pro',turn:s.turn,totalTurns:8,player:Object.fromEntries(['experience','enrollment','satisfaction','accounting'].map(k=>[k,s.player[k]])),tokens:{...s.tokens},
 updateStatus(k,d){const old=this.player[k];this.player[k]=Math.max(0,old+d);if(k==='enrollment')this.player[k]=Math.min(this.player[k],this.player.experience);return this.player[k]-old;}});
 const enumerate=(hand,counts)=>hand.flatMap((c,i)=>{const p=cm.parseEffect(c.effect),slots=p.staffRestrictions.length?p.staffRestrictions:['leader','teacher','staff'];
 return slots.filter(slot=>c.effect.includes('並行')||counts[slot]===0).map(slot=>({cardIndex:i,card:c,slot}));});
 const strategy=createResearchPolicy({projectDeck:projectProDeck,score:proGoal,cloneState:clone,resolve:(c,slot,s)=>tm.resolveCardAction(c,slot,s),enumerateOptions:enumerate,catalog:cm.allCards,turns:state.config.turns,publicActionParser:config.fastPublicActions||config.effectRecoveryProtection?new CardManager(null):null,config,valueModel,openingTable});
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

test('学習リフレッシュの残り種類は、公開提示・永久除外・再構成だけで決める',()=>{
 const catalog=[6,7,8,9].map(card),event=(type,nos)=>({type,cards:nos.map(n=>({cardNo:n}))});
 const history=[event('offer',[6,7,8]),event('refresh',[6,7,8]),event('offer',[6,7,8])];
 assert.deepEqual(remainingTrainingNames(catalog,history,'R').map(c=>Number(c.cardNo)),[9]);
 assert.deepEqual(remainingTrainingNames(catalog,[...history,event('offer',[9,9])],'R').map(c=>Number(c.cardNo)),[6,7,8,9]);
 assert.ok(!remainingTrainingNames(catalog,[...history,event('refresh',[6])],'R').some(c=>Number(c.cardNo)===6));
});
test('リフレッシュ判断は見えている候補と残り回数で変わり、非公開状態を読まない',()=>{
 const {state,strategy,observe}=setup({learned:{blend:0,refreshCost:0,reserveCost:0}},tinyModel('count-15'));
 const bad=observe([card(6),card(7),card(8),card(9)],{pickCount:2});
 for(const key of ['seed','rng','trainingDecks'])Object.defineProperty(bad,key,{enumerable:true,get(){throw Error('private');}});
 const before=JSON.stringify(state),advice=strategy.learnedPolicy.refresh(bad,'R',4,2);assert.ok(advice.shouldRefresh);assert.ok(advice.combinations>0);
 assert.equal(JSON.stringify(state),before);
 const good=observe([card(6),card(7),card(8),card(15)],{pickCount:2});assert.ok(!strategy.learnedPolicy.refresh(good,'R',4,2).shouldRefresh);
 bad.refreshRemaining=0;assert.ok(!strategy.learnedPolicy.refresh(bad,'R',4,2).shouldRefresh);
});

test('学習予測の投影は学習時の固定重みと一致し、プレイ用重みに依存しない',()=>{
 const {state,strategy,observe}=setup();for(const n of [13,40,45,49])state.addToDeck({...card(n)});
 for(const turn of [0,3,6,7]){state.turn=turn;const ob=observe(),fixed=createValueForecaster(projectProDeck);assert.deepEqual(fixed(ob,ob.owned),strategy.forecast(ob,ob.owned,'engine'));}
 const model=tinyModel('forecast-enrollment'),a=setup({learned:{blend:0}},model),b=setup({weights:{enrollment:20,experience:.1,future:.1},learned:{blend:0}},model);
 for(const n of [13,40,45,49]){a.state.addToDeck({...card(n)});b.state.addToDeck({...card(n)});}
 assert.equal(a.strategy.learnedPolicy.estimate(a.observe(),'acquisition'),b.strategy.learnedPolicy.estimate(b.observe(),'acquisition'));
});
test('削除の最低保持枚数を研究条件として変え、合法な枚数内で削除する',()=>{
 for(const floor of [2,3,4,5]){const {state,strategy,observe}=setup({deleteFloor:floor});state.player.deck=[];for(const n of [7,13,15,17,30,31])state.addToDeck({...card(n)});
  Object.assign(state.player,{experience:42,enrollment:32,satisfaction:26,accounting:18});const decisions=strategy.deletions(observe(),10,'aggressive');assert.equal(decisions.length,6-floor);}
 assert.throws(()=>setup({deleteFloor:1}),/2〜12/);
});

test('学習得点と固定式投影の校正は主研修を使い、追加研修と少数圧縮を区別する',()=>{
 const records=Array.from({length:250},(_,i)=>({result:{score:{displayScore:12,experience:40,enrollment:32,satisfaction:25,accounting:15}},events:[
  {type:'research-acquisition-decision',turn:0,observation:{allowSkip:true},advice:{recommended:{predictedScore:99,forecast:{experience:99,enrollment:99,satisfaction:99,accounting:99}}}},
  {type:'research-acquisition-decision',turn:0,observation:{allowSkip:false},advice:{recommended:{predictedScore:11,forecast:{experience:38,enrollment:31,satisfaction:25,accounting:16}}}},
  {type:'research-deletion-decision',turn:0,observation:{owned:Array(6)},decisions:Array(i<10?2:1)}]}));
 const c=predictionCalibration(records);assert.equal(c.length,1);assert.equal(c[0].n,250);assert.equal(c[0].bias,-1);assert.ok(c[0].minimum250);
 const f=forecastStatsCalibration(records);assert.equal(f[0].axes.experience.bias,-2);assert.equal(f[0].axes.accounting.bias,1);
 const d=deletionCoverage(records);assert.equal(d.gamesBelow5,10);assert.equal(d.byTurn[0].below5Count,10);assert.ok(!d.byTurn[1].minimum250);
});

test('取得の比重と基準の余裕を別に調整し、入力を変更せず有限値で評価する',()=>{
 const base=setup(),adjusted=setup({acquisitionWeights:{enrollment:6.5}}),ob=base.observe([card(45),card(46),card(48)]),snapshot=JSON.stringify(ob);
 assert.deepEqual(base.strategy.forecast(ob,ob.owned,'engine'),adjusted.strategy.forecast(ob,ob.owned,'engine'));
 assert.equal(base.strategy.value(ob.stats,ob,'engine'),adjusted.strategy.value(ob.stats,ob,'engine'));
 const advice=adjusted.strategy.acquisition(ob,'engine');assert.ok(advice.evaluations.every(e=>Number.isFinite(e.score)));
 for(const statBuffers of [{experience:3},{enrollment:2},{satisfaction:3},{experience:2,enrollment:2,satisfaction:2}]){
  const changed=setup({statBuffers});assert.ok(Number.isFinite(changed.strategy.value({experience:50,enrollment:48,satisfaction:35,accounting:15},ob,'engine')));
  assert.ok(changed.strategy.acquisition(ob,'engine').evaluations.every(e=>Number.isFinite(e.score)));}
 assert.equal(JSON.stringify(ob),snapshot);assert.throws(()=>setup({statBuffers:{satisfaction:-1}}),/0〜12/);
});

test('発想として投影するトークの仮説は、カード定義や実際の効果を変更しない',()=>{
 const actual=card(13),effect=actual.effect,{state,strategy,observe,tm,clone}=setup({predictiveEffects:{13:'[並行🤹][発想💡]'}});state.addToDeck({...actual});
 const ob=observe(),projected=strategy.forecast(ob,[actual],'engine');assert.ok(projected.engine>0);assert.equal(card(13).effect,effect);assert.equal(ob.owned.find(c=>Number(c.cardNo)===13).effect,effect);
 const next=clone(state);tm.resolveCardAction(actual,'staff',next);assert.equal(next.tokens.inspiration,0);assert.equal(next.player.satisfaction,state.player.satisfaction+3);
});
test('指定した回転札の最初の1枚を削除で保護し、探索幅を限定範囲で設定する',()=>{
 const {state,strategy,observe}=setup({deleteFloor:2,protectCards:[13],protectUntil:6,protectEnrollment:32,placementBeam:360,lateBeam:720});state.player.deck=[];for(const n of [7,13,15,17,30,31])state.addToDeck({...card(n)});
 Object.assign(state.player,{experience:42,enrollment:32,satisfaction:26,accounting:18});assert.ok(!strategy.deletions(observe(),10,'aggressive').some(d=>Number(d.cardNo)===13));assert.throws(()=>setup({placementBeam:0}),/8〜2000/);
});

test('仮の手札の乱数をカードごとに固定すると、別の候補を足しても共通カードの相対順を保つ',()=>{
 for(let world=0;world<64;world++){
  const a=publicDraw([card(6),card(13),card(17)],3,world,4,'test','keyed'),b=publicDraw([card(6),card(9),card(13),card(17)],4,world,4,'test','keyed');
  assert.deepEqual(a.map(c=>c.cardNo),b.filter(c=>Number(c.cardNo)!==9).map(c=>c.cardNo));}
});
test('仮想将来は現在の追加研修を消費済みとして扱い、学習する後続取得も再帰せず動く',()=>{
 const config={lateAcquisitionRollout:1,planning:{worlds:4,contextSalt:true,drawSampler:'keyed',futureAcquisition:'learned',futurePolicy:'baseline',futureBeam:32,futureRefresh:'learned'}},model=tinyModel('count-15');
 const {state,strategy,observe}=setup(config,model);state.turn=7;state.player.deck=[];Object.assign(state.player,{experience:49,enrollment:47,satisfaction:25,accounting:15});state.tokens.inspiration=1;
 const extra=observe([card(25),card(15)],{allowSkip:true}),consumed={...extra,tokens:{...extra.tokens,inspiration:0},allowSkip:false},a=strategy.acquisition(extra,'rollout'),b=strategy.acquisition(consumed,'rollout');
 for(const e of a.evaluations.filter(e=>e.indices.length))assert.equal(e.mean,b.evaluations.find(x=>x.indices.join(',')===e.indices.join(',')).mean);
 assert.ok(strategy.acquisition(extra,'learned').evaluations.every(e=>Number.isFinite(e.score)));
 state.turn=6;const ob=observe([card(25),card(40)]);for(const key of ['seed','rng','trainingDecks'])Object.defineProperty(ob,key,{enumerable:true,get(){throw Error('private');}});
 assert.ok(strategy.acquisition(ob,'rollout').evaluations.every(e=>Number.isFinite(e.score)));
});

test('短い先読みは固定評価で続きを見積もり、最終ターンでは公式得点を優先する',()=>{
 const config={fastPublicActions:true,planning:{worlds:4,valueHorizon:1,futurePolicy:'baseline',futureBeam:16,drawSampler:'keyed',contextSalt:true}},model=tinyModel('count-15',100);
 const {state,strategy,observe}=setup(config,model);state.turn=2;state.player.deck=[];Object.assign(state.player,{experience:20,enrollment:10,satisfaction:15,accounting:15});
 const ob=observe([card(25),card(15)]);for(const key of ['seed','rng','trainingDecks'])Object.defineProperty(ob,key,{enumerable:true,get(){throw Error('private');}});
 const advice=strategy.acquisition(ob,'rollout');assert.deepEqual(advice.recommended.indices,[1]);assert.ok(advice.evaluations.every(e=>e.estimated&&e.below8===null));
 state.turn=7;Object.assign(state.player,{experience:49,enrollment:47,satisfaction:25,accounting:15});const final=strategy.acquisition(observe([card(25),card(15)]),'rollout');
 assert.deepEqual(final.recommended.indices,[0]);assert.equal(final.recommended.mean,14);assert.ok(final.evaluations.every(e=>!e.estimated));
 assert.throws(()=>setup(config),/固定評価/);
});
test('仮想研修で使ったリフレッシュ回数を後続取得と固定評価へ反映する',()=>{
 const {state,strategy,observe,clone,tm,enumerate}=setup();state.turn=5;state.player.deck=[];Object.assign(state.player,{experience:30,enrollment:20,satisfaction:25,accounting:15});
 const seen=[],baseline={...strategy,acquisition(ob,mode,skip){seen.push(['acquisition',ob.refreshRemaining]);return strategy.acquisition(ob,mode,skip);},futureValue(ob){seen.push(['leaf',ob.refreshRemaining]);return {mean:12,forecast:ob.stats,tie:0};}};
 const refreshAdvice=ob=>({evaluations:ob.candidates.map(()=>({score:10})),recommended:{score:0}});
 const risk=createRiskPolicy({baseline,score:proGoal,cloneState:clone,resolve:(c,slot,s)=>tm.resolveCardAction(c,slot,s),enumerateOptions:enumerate,catalog:cm.allCards,refreshAdvice,config:{planning:{worlds:1,valueHorizon:2,futureRefresh:true,futurePolicy:'baseline',futureBeam:8}}});
 const ob={...observe([card(25)]),refreshRemaining:1};risk.acquisition(ob);assert.deepEqual(seen,[['acquisition',0],['leaf',0]]);assert.equal(ob.refreshRemaining,1);
});

test('配置の短い先読みは全期間に使え、再帰・非公開参照をせず、最終配置は実得点を優先する',()=>{
 const config={fastPublicActions:true,placementRolloutTurns:8,planning:{worlds:2,valueHorizon:1,futurePolicy:'baseline',futureBeam:16,contextSalt:true,drawSampler:'keyed'}},model=tinyModel('count-15');
 const {state,strategy,observe,tm,clone}=setup(config,model);state.turn=2;Object.assign(state.player,{experience:20,enrollment:10,satisfaction:12,accounting:15});const hand=[card(13),card(49),card(45)];
 const ob=observe();for(const key of ['seed','rng','trainingDecks'])Object.defineProperty(ob,key,{enumerable:true,get(){throw Error('private');}});
 const original=JSON.stringify(state),next=clone(state);for(const p of strategy.placements(ob,hand,state,'engine'))assert.ok(tm.resolveCardAction(hand[p.cardIndex],p.slot,next).applied);assert.equal(JSON.stringify(state),original);
 state.turn=7;Object.assign(state.player,{experience:47,enrollment:40,satisfaction:35,accounting:15});const finalHand=[card(42),card(25),card(30),card(15)],final=clone(state);for(const p of strategy.placements(observe(),finalHand,state,'engine'))assert.ok(tm.resolveCardAction(finalHand[p.cardIndex],p.slot,final).applied);assert.equal(sm.calculateScore(final).points,16);
 assert.throws(()=>setup({...config,placementRolloutTurns:1},model),/2〜8/);
});

test('条件札を保有した序盤の配置で満足15へ到達し、最終得点の優先を変えない',()=>{
 const goals=[{cardNo:49,stat:'satisfaction',threshold:15,weight:50,minRemaining:5}];
 const {state,strategy,observe,tm,clone}=setup({activationGoals:goals,fastPublicActions:true});
 state.turn=2;state.addToDeck({...card(49)});Object.assign(state.player,{experience:30,enrollment:10,satisfaction:12,accounting:15});
 const ob=observe(),hand=[card(13),card(49)],next=clone(state);
 for(const key of ['seed','rng','trainingDecks'])Object.defineProperty(ob,key,{get(){throw Error('private');}});
 for(const step of strategy.placements(ob,hand,state,'engine'))tm.resolveCardAction(hand[step.cardIndex],step.slot,next);
 assert.equal(next.player.satisfaction,15);assert.equal(next.tokens.passion,2);assert.equal(next.tokens.inspiration,1);
 assert.equal(strategy.activationValue({...ob,owned:[]},ob.stats),0);
 state.turn=7;Object.assign(state.player,{experience:47,enrollment:40,satisfaction:35,accounting:15});
 const final=clone(state),last=[card(42),card(25),card(30),card(15)];for(const step of strategy.placements(observe(),last,state,'engine'))tm.resolveCardAction(last[step.cardIndex],step.slot,final);
 assert.equal(sm.calculateScore(final).points,16);assert.equal(strategy.activationValue(observe(),state.player),0);
 assert.throws(()=>setup({activationGoals:[{...goals[0],stat:'futureResult'}]}),/目標指定/);
});

test('No40が残っていても、最後の直接の経理回復役No5を保護する',()=>{
 const {state,clone,enumerate,observe}=setup();state.turn=2;state.player.deck=[];
 for(const n of [5,40,13,49,23,35])state.addToDeck({...card(n)});
 Object.assign(state.player,{experience:25,enrollment:12,satisfaction:12,accounting:10});
 const projected=(ob,{cards})=>({end:{...ob.stats},engine:cards.some(c=>Number(c.cardNo)===5)?0:1000,risk:0,draw:4,outputs:[]});
 const args={projectDeck:projected,score:proGoal,cloneState:clone,resolve:()=>({applied:false}),enumerateOptions:enumerate,publicActionParser:cm,turns:state.config.turns};
 const old=createResearchPolicy({...args,config:{deleteFloor:4}}),checked=createResearchPolicy({...args,config:{deleteFloor:4,effectRecoveryProtection:true}});
 const ob=observe(),snapshot=JSON.stringify(state);
 for(const key of ['seed','rng','deckOrder','trainingDecks'])Object.defineProperty(ob,key,{get(){throw Error('private');}});
 assert.equal(Number(old.deletions(ob,1,'aggressive','engine')[0].cardNo),5);
 assert(checked.deletions(ob,1,'aggressive','engine').every(d=>Number(d.cardNo)!==5));
 assert.equal(JSON.stringify(state),snapshot);
});
test('配置候補の分散方式を有効にしても、最終配置は公式得点を優先する',()=>{
 const {state,strategy,observe,tm,clone}=setup({fastPublicActions:true,planning:{worlds:2,candidateDiversity:'axes'}});state.turn=7;
 Object.assign(state.player,{experience:47,enrollment:40,satisfaction:35,accounting:15});
 const hand=[card(42),card(25),card(30),card(15)],ob=observe(),before=JSON.stringify(state);
 for(const key of ['seed','rng','deckOrder'])Object.defineProperty(ob,key,{get(){throw Error('private');}});
 const next=clone(state);for(const p of strategy.placements(ob,hand,state,'rollout'))assert(tm.resolveCardAction(hand[p.cardIndex],p.slot,next).applied);
 assert.equal(sm.calculateScore(next).points,16);assert.equal(JSON.stringify(state),before);
});

test('将来の学習リフレッシュを使う条件は、序盤SRの残り1回も判断へ渡す',()=>{
 const {state,strategy,observe,tm,clone,enumerate}=setup({},tinyModel('count-15'));state.turn=0;
 Object.assign(state.player,{experience:10,enrollment:4,satisfaction:10,accounting:10});
 const ob=observe();ob.refreshRemaining=1;ob.offerHistory=[];
 for(const key of ['seed','rng','trainingDecks'])Object.defineProperty(ob,key,{get(){throw Error('private');}});
 const calls=[];
 const make=consistent=>createRiskPolicy({baseline:{...strategy,futureRefresh:(o)=>{calls.push({turn:o.turn,remaining:o.refreshRemaining});return {shouldRefresh:true};}},score:proGoal,cloneState:clone,resolve:(c,slot,s)=>tm.resolveCardAction(c,slot,s),enumerateOptions:enumerate,catalog:cm.allCards,
  refreshAdvice:o=>strategy.acquisition(o,'engine'),config:{planning:{worlds:1,valueHorizon:1,futurePolicy:'baseline',futureBeam:8,futureRefresh:'learned',consistentFutureRefresh:consistent}}});
 make(false).evaluate(ob,ob.owned,clone(state),'after-action');assert.equal(calls.length,0);
 make(true).evaluate(ob,ob.owned,clone(state),'after-action');assert.deepEqual(calls,[{turn:1,remaining:1}]);
});

test('初回表は実際の初回取得とリフレッシュだけを置き換え、後続の先読みを維持する',()=>{
 const names=cm.allCards.filter(c=>c.rarity==='R').map(c=>Number(c.cardNo)).sort((a,b)=>a-b),rows=[];
 for(const remaining of [0,1,2])for(let i=0;i<names.length;i++)for(let j=i+1;j<names.length;j++)rows.push({pair:[names[i],names[j]],remaining,score:names[i]===6&&names[j]===7?100:1});
 const table={schema:'pro-initial-pair-value-v1',estimated:true,initial:{totalTurns:8,stats:{experience:0,enrollment:0,satisfaction:3,accounting:5},basicNos:[1,2,3,4,5]},cardNos:names,rows};
 const {state,strategy,observe}=setup({lateAcquisitionRollout:8,learned:{blend:0}},tinyModel('count-6'),table);
 let calls=0;strategy.riskPolicy.acquisition=()=>{calls++;return {mode:'sentinel'};};
 const o=observe([card(6),card(7),card(8),card(9)],{pickCount:2});
 for(const name of ['seed','rng','deckOrder','finalScore'])Object.defineProperty(o,name,{get(){throw Error('private');}});
 assert.equal(strategy.acquisition(o,'learned').mode,'opening-table');assert.deepEqual(strategy.acquisition(o,'learned').recommended.indices,[0,1]);assert.equal(calls,0);
 assert.equal(strategy.learnedPolicy.refresh(o,'R',4,2).shouldRefresh,false);
 assert.equal(strategy.acquisition({...o,turn:1,pickCount:1},'learned').mode,'sentinel');assert.equal(calls,1);
 state.turn=7;assert.ok(strategy.placements(observe(),[card(7)],state,'engine').length);
});


test('学習リフレッシュの判断がある場合は使わない固定式を計算せず、代替判断は残す',()=>{
 const {state,strategy,observe,tm,clone,enumerate}=setup();state.turn=0;
 const ob={...observe(),refreshRemaining:2,offerHistory:[]},calls=[];
 const make=(futureRefresh,learned)=>createRiskPolicy({baseline:{...strategy,futureRefresh:()=>learned,futureValue:o=>({mean:12,forecast:o.stats,tie:0})},score:proGoal,cloneState:clone,resolve:(c,slot,s)=>tm.resolveCardAction(c,slot,s),enumerateOptions:enumerate,catalog:cm.allCards,
  refreshAdvice:o=>{calls.push(o.candidates.length);return {evaluations:o.candidates.map(()=>({score:10})),recommended:{score:0}};},config:{planning:{worlds:1,valueHorizon:1,futurePolicy:'baseline',futureBeam:8,futureRefresh}}});
 make('learned',{shouldRefresh:false}).evaluate(ob,ob.owned,clone(state),'after-action');assert.deepEqual(calls,[]);
 make('learned',null).evaluate(ob,ob.owned,clone(state),'after-action');assert.equal(calls.length,2);
 calls.length=0;make(true,null).evaluate(ob,ob.owned,clone(state),'after-action');assert.equal(calls.length,2);
});


function constantShortfallModel(value=2){
 const mean={schema:VALUE_SCHEMA,features:[...VALUE_FEATURES],base:13,learningRate:1,trees:[]};
 return {...mean,shortfallHead:{...mean,base:value,targetKind:'pro-shortfall9'}};
}
test('低得点損失を追加しても平均予測を変えず、負の損失予測を0にする',()=>{
 const model=constantShortfallModel(),{strategy,observe}=setup({},model),o=observe();
 for(const key of ['seed','rng','deckOrder','futureScore'])Object.defineProperty(o,key,{get(){throw Error('private');}});
 assert.equal(strategy.learnedPolicy.estimate(o,'after-action'),13);assert.equal(strategy.learnedPolicy.shortfall(o,'after-action'),2);
 const negative=setup({},constantShortfallModel(-2));assert.equal(negative.strategy.learnedPolicy.shortfall(negative.observe(),'after-action'),0);
 const plain=setup({}, {...model,shortfallHead:undefined});assert.equal(plain.strategy.learnedPolicy.estimate(plain.observe(),'after-action'),13);assert.equal(plain.strategy.learnedPolicy.shortfall(plain.observe(),'after-action'),0);
 assert.throws(()=>setup({planning:{valueHorizon:1,shortfallWeight:1}}, {...model,shortfallHead:undefined}),/損失モデル/);
 assert.throws(()=>setup({planning:{shortfallWeight:NaN}}),/0〜8/);
});
test('同じ平均予測でも、学習末端の低得点損失を係数通りに減点する',()=>{
 const config={planning:{worlds:2,valueHorizon:1,futurePolicy:'baseline',futureBeam:8}},a=setup(config,constantShortfallModel()),b=setup({...config,planning:{...config.planning,shortfallWeight:3}},constantShortfallModel());
 const x=a.strategy.riskPolicy.evaluate(a.observe(),a.observe().owned,a.clone(a.state),'after-action'),y=b.strategy.riskPolicy.evaluate(b.observe(),b.observe().owned,b.clone(b.state),'after-action');
 assert.equal(x.mean,13);assert.equal(y.mean,13);assert.ok(Math.abs(x.score-y.score-6)<1e-9);assert.deepEqual(x.forecast,y.forecast);
});
test('実結果の8点も損失側へ含め、9点では損失減点を足さない',()=>{
 for(const [stats,points]of [[{experience:40,enrollment:26,satisfaction:15,accounting:14},8],[{experience:35,enrollment:26,satisfaction:15,accounting:15},9]]){
  const a=setup({planning:{shortfallWeight:0}},constantShortfallModel()),b=setup({planning:{shortfallWeight:3}},constantShortfallModel());
  a.state.turn=7;b.state.turn=7;Object.assign(a.state.player,stats);Object.assign(b.state.player,stats);assert.equal(sm.calculateScore(a.state).points,points);
  const x=a.strategy.riskPolicy.evaluate(a.observe(),a.observe().owned,a.clone(a.state),'after-action'),y=b.strategy.riskPolicy.evaluate(b.observe(),b.observe().owned,b.clone(b.state),'after-action');
  assert.equal(x.mean,points);assert.equal(y.mean,points);assert.ok(Math.abs(x.score-y.score-3*Math.max(0,9-points))<1e-9);
 }
});


function constantFailureModel(value=.2){
 const mean={schema:VALUE_SCHEMA,features:[...VALUE_FEATURES],base:13,learningRate:1,trees:[]};
 return {...mean,failureHead:{...mean,base:value,targetKind:'pro-failure8'}};
}
test('低得点頻度を足しても平均を変えず、頻度を0〜1へ制限し、非公開情報を読まない',()=>{
 const model=constantFailureModel(),{strategy,observe}=setup({},model),o=observe();
 for(const key of ['seed','rng','deckOrder','futureScore'])Object.defineProperty(o,key,{get(){throw Error('private');}});
 assert.equal(strategy.learnedPolicy.estimate(o,'after-action'),13);assert.equal(strategy.learnedPolicy.failure(o,'after-action'),.2);
 for(const [raw,expected]of [[-2,0],[2,1]]){const p=setup({},constantFailureModel(raw));assert.equal(p.strategy.learnedPolicy.failure(p.observe(),'after-action'),expected);assert.equal(p.strategy.learnedPolicy.estimate(p.observe(),'after-action'),13);}
 const plain=setup({}, {...model,failureHead:undefined});assert.equal(plain.strategy.learnedPolicy.failure(plain.observe(),'after-action'),0);
 assert.throws(()=>setup({planning:{failureWeight:5}}, {...model,failureHead:undefined}),/頻度モデル/);
 assert.throws(()=>setup({planning:{failureWeight:5}}, {...model,failureHead:{...model.failureHead,targetKind:'pro-shortfall9'}}),/頻度モデル/);
 assert.throws(()=>setup({planning:{failureWeight:NaN}}),/0〜40/);
});
test('学習末端の頻度は係数通りに減点し、平均と予測数値を変えない',()=>{
 const config={planning:{worlds:2,valueHorizon:1,futurePolicy:'baseline',futureBeam:8}},a=setup(config,constantFailureModel()),b=setup({...config,planning:{...config.planning,failureWeight:5}},constantFailureModel());
 const x=a.strategy.riskPolicy.evaluate(a.observe(),a.observe().owned,a.clone(a.state),'after-action'),y=b.strategy.riskPolicy.evaluate(b.observe(),b.observe().owned,b.clone(b.state),'after-action');
 assert.equal(x.mean,13);assert.equal(y.mean,13);assert.ok(Math.abs(x.score-y.score-1)<1e-9);assert.deepEqual(x.forecast,y.forecast);
});
test('実結果の8点と大きな失点を同じ1件として減点し、9点は減点しない',()=>{
 for(const stats of [{experience:40,enrollment:26,satisfaction:15,accounting:14},{experience:35,enrollment:26,satisfaction:15,accounting:15},{experience:0,enrollment:0,satisfaction:3,accounting:5}]){
  const a=setup({planning:{failureWeight:0}},constantFailureModel()),b=setup({planning:{failureWeight:5}},constantFailureModel());
  a.state.turn=7;b.state.turn=7;Object.assign(a.state.player,stats);Object.assign(b.state.player,stats);const points=sm.calculateScore(a.state).points;
  const x=a.strategy.riskPolicy.evaluate(a.observe(),a.observe().owned,a.clone(a.state),'after-action'),y=b.strategy.riskPolicy.evaluate(b.observe(),b.observe().owned,b.clone(b.state),'after-action');
  assert.equal(x.mean,points);assert.equal(y.mean,points);assert.ok(Math.abs(x.score-y.score-5*Number(points<=8))<1e-9);
 }
});


test('取得/リフレッシュ用の頻度評価は平均予測を維持し、同じ平均なら危険が低い取得を選ぶ',()=>{
 const model=constantFailureModel(0);model.failureHead.trees=[{feature:VALUE_FEATURES.indexOf('count-9'),threshold:.5,left:{value:.4},right:{value:.05}}];
 const a=setup({learned:{blend:0}},model),b=setup({learned:{blend:0,acquisitionFailureWeight:5}},model);a.state.turn=3;b.state.turn=3;
 const before=a.strategy.learnedPolicy.acquisition(a.observe([card(6),card(9)],{pickCount:1})),after=b.strategy.learnedPolicy.acquisition(b.observe([card(6),card(9)],{pickCount:1}));
 assert.deepEqual(before.recommended.indices,[0]);assert.deepEqual(after.recommended.indices,[1]);assert.equal(after.recommended.predictedScore,13);assert.equal(after.recommended.score,12.75);
 for(const options of [{learned:{acquisitionFailureWeight:5}},{learned:{acquisitionFailureWeight:NaN}}])assert.throws(()=>setup(options,{...model,failureHead:undefined}));
});
test('取得と同じ頻度評価をリフレッシュの候補全体にも使い、実乱数や未来を読まない',()=>{
 const model=constantFailureModel(0);model.failureHead.trees=[{feature:VALUE_FEATURES.indexOf('count-9'),threshold:.5,left:{value:.4},right:{value:.05}}];
 const zero=setup({learned:{blend:0,refreshCost:0,reserveCost:0}},model),risk=setup({learned:{blend:0,refreshCost:0,reserveCost:0,acquisitionFailureWeight:5}},model);
 const a=zero.observe([card(6),card(7),card(8)],{pickCount:1}),b=risk.observe([card(6),card(7),card(8)],{pickCount:1});a.refreshRemaining=2;b.refreshRemaining=2;
 for(const key of ['seed','rng','deckOrder','futureScore'])Object.defineProperty(b,key,{get(){throw Error('private');}});
 const old=zero.strategy.learnedPolicy.refresh(a,'R',3,1),next=risk.strategy.learnedPolicy.refresh(b,'R',3,1);assert.equal(old.shouldRefresh,false);assert.equal(next.shouldRefresh,true);assert.equal(next.currentScore,11);assert.ok(next.expectedScore>next.currentScore);assert.equal(next.opportunityCost,0);
});

test('報告削除は初回に質問対応、2ターン目に生徒面談を優先し、観測を変えない',()=>{
 const {state,strategy,observe}=setup({deleteFloor:4});for(const n of [7,17])state.addToDeck({...card(n)});
 const ob=observe(),snapshot=JSON.stringify(ob);
 for(const key of ['seed','rng','deckOrder','trainingDecks','result'])Object.defineProperty(ob,key,{get(){throw Error('private');}});
 assert.deepEqual(strategy.deletions(ob,1,'player-basic','engine').map(d=>Number(d.cardNo)),[3]);assert.equal(JSON.stringify(ob),snapshot);
 state.player.deck=state.player.deck.filter(c=>Number(c.cardNo)!==3);state.turn=1;
 assert.deepEqual(strategy.deletions(observe(),1,'player-basic','engine').map(d=>Number(d.cardNo)),[4]);
});
test('報告削除の初回追加枠は基本動員札に使い、面談と経理札を翌日以降まで残す',()=>{
 const {state,strategy,observe}=setup({deleteFloor:4});for(const n of [7,17])state.addToDeck({...card(n)});state.player.accounting=40;
 assert.deepEqual(strategy.deletions(observe(),10,'player-basic','engine').map(d=>Number(d.cardNo)),[3,1,2]);
 state.turn=1;state.player.deck=state.player.deck.filter(c=>Number(c.cardNo)!==3);
 assert.deepEqual(strategy.deletions(observe(),10,'player-basic','engine').map(d=>Number(d.cardNo)),[4,1,2]);
});
test('経理の現在値が15未満なら投影が順調でも経理基本を残し、動員基本を消す',()=>{
 const {state,strategy,observe}=setup();state.turn=2;state.player.accounting=14;state.player.deck=[];for(const n of [1,2,5,16,37])state.addToDeck({...card(n)});
 const ob=observe(),without=ob.owned.filter(c=>Number(c.cardNo)!==5);
 assert(strategy.forecast({...ob,turn:3},without,'engine').end.accounting>=15);
 assert.deepEqual(strategy.deletions(ob,1,'player-basic','engine').map(d=>Number(d.cardNo)),[1]);
});
test('経理が現在15でも削除後の投影が15未満なら経理基本を残す',()=>{
 const {state,strategy,observe}=setup();state.turn=2;state.player.accounting=15;state.player.deck=[];for(const n of [1,2,5,43,50])state.addToDeck({...card(n)});
 const ob=observe(),without=ob.owned.filter(c=>Number(c.cardNo)!==5);
 assert(strategy.forecast({...ob,turn:3},without,'engine').end.accounting<15);
 assert.deepEqual(strategy.deletions(ob,1,'player-basic','engine').map(d=>Number(d.cardNo)),[1]);
});
test('3ターン目以降に現在/削除後の投影がともに15以上なら経理基本を先に消す',()=>{
 const {state,strategy,observe}=setup();state.turn=2;state.player.accounting=15;state.player.deck=[];for(const n of [1,2,5,16,37])state.addToDeck({...card(n)});
 assert.deepEqual(strategy.deletions(observe(),1,'player-basic','engine').map(d=>Number(d.cardNo)),[5]);
});
test('経理基本だけが保留なら他のカードを代わりに消さず、最終/削除枠0でも消さない',()=>{
 const {state,strategy,observe}=setup();state.turn=3;state.player.accounting=10;state.player.deck=[];for(const n of [5,6,7,10,15,17,31])state.addToDeck({...card(n)});
 assert.deepEqual(strategy.deletions(observe(),3,'player-basic','engine'),[]);
 assert.deepEqual(strategy.deletions(observe(),0,'player-basic','engine'),[]);
 state.turn=7;assert.deepEqual(strategy.deletions(observe(),3,'player-basic','engine'),[]);
});
test('基本5枚がなくなった後の残り削除枠は既存の積極削除と一致する',()=>{
 const {state,strategy,observe}=setup({deleteFloor:4});state.turn=3;state.player.deck=[];for(const n of [1,6,7,10,15,17,31,42])state.addToDeck({...card(n)});
 const ob=observe(),after={...ob,owned:ob.owned.filter(c=>Number(c.cardNo)!==1)};
 const actual=strategy.deletions(ob,3,'player-basic','engine'),rest=strategy.deletions(after,2,'aggressive','engine');
 assert.equal(Number(actual[0].cardNo),1);assert.deepEqual(actual.slice(1),rest);
 assert.deepEqual(strategy.deletions(after,3,'player-basic','engine'),strategy.deletions(after,3,'aggressive','engine'));
});
test('報告の基本削除に既存の保持枚数下限を混ぜない',()=>{
 const {strategy,observe}=setup({deleteFloor:12});assert.deepEqual(strategy.deletions(observe(),1,'player-basic','engine').map(d=>Number(d.cardNo)),[3]);
});
test('仮想将来の削除は既定の積極削除を維持し、明示時だけ報告方針を使う',()=>{
 const {state,strategy,observe,tm,clone,enumerate}=setup({},tinyModel('count-5'));const ob=observe(),calls=[];
 const make=futureDeletion=>createRiskPolicy({baseline:{...strategy,deletions:(o,max,mode)=>{calls.push(mode);return [];}},score:proGoal,cloneState:clone,resolve:(c,slot,s)=>tm.resolveCardAction(c,slot,s),enumerateOptions:enumerate,catalog:cm.allCards,config:{planning:{worlds:1,valueHorizon:1,futurePolicy:'baseline',futureBeam:8,...(futureDeletion?{futureDeletion}:{})}}});
 make().evaluate(ob,ob.owned,clone(state),'after-action');assert(calls.length>0);assert(calls.every(mode=>mode==='aggressive'));
 calls.length=0;make('player-basic').evaluate(ob,ob.owned,clone(state),'after-action');assert(calls.length>0);assert(calls.every(mode=>mode==='player-basic'));
 assert.throws(()=>make('unknown'),/将来の削除方針/);
});

test('経理条件を投影だけにする仮説は現在15未満でも回復が見込めれば基本経理を消す',()=>{
 const prepare=config=>{const s=setup(config);s.state.turn=2;s.state.player.accounting=14;s.state.player.deck=[];for(const n of [1,2,5,16,37])s.state.addToDeck({...card(n)});return s;};
 const strict=prepare({}),projected=prepare({playerBasicAccounting:'forecast'});
 assert.equal(Number(strict.strategy.deletions(strict.observe(),1,'player-basic','engine')[0].cardNo),1);
 const ob=projected.observe(),snapshot=JSON.stringify(ob);for(const key of ['seed','rng','deckOrder','result'])Object.defineProperty(ob,key,{get(){throw Error('private');}});
 assert.equal(Number(projected.strategy.deletions(ob,1,'player-basic','engine')[0].cardNo),5);assert.equal(JSON.stringify(ob),snapshot);
 projected.state.player.deck=projected.state.player.deck.filter(c=>![16,37].includes(Number(c.cardNo)));projected.state.player.accounting=10;
 assert.equal(Number(projected.strategy.deletions(projected.observe(),1,'player-basic','engine')[0].cardNo),1);
});
test('初回2回だけ固定する仮説は3ターン目以降を従来の積極削除へ戻す',()=>{
 const {state,strategy,observe}=setup({playerBasicScope:'opening'});state.turn=3;state.player.accounting=10;state.player.deck=[];for(const n of [5,6,7,10,15,17,31])state.addToDeck({...card(n)});
 const ob=observe(),expected=strategy.deletions(ob,3,'aggressive','engine');assert(expected.length>0);assert.deepEqual(strategy.deletions(ob,3,'player-basic','engine'),expected);
 state.turn=7;assert.deepEqual(strategy.deletions(observe(),3,'player-basic','engine'),[]);
});
test('別の経理条件や初回だけの範囲でも最初の2会議の順序と保留を守る',()=>{
 for(const config of [{playerBasicAccounting:'forecast'},{playerBasicScope:'opening'},{playerBasicScope:'opening',playerBasicAccounting:'forecast'}]){
  const {state,strategy,observe}=setup(config);state.player.accounting=40;
  assert.deepEqual(strategy.deletions(observe(),9,'player-basic','engine').map(d=>Number(d.cardNo)),[3,1,2]);
  state.turn=1;state.player.deck=state.player.deck.filter(c=>Number(c.cardNo)!==3);
  assert.deepEqual(strategy.deletions(observe(),9,'player-basic','engine').map(d=>Number(d.cardNo)),[4,1,2]);
 }
});
test('報告削除の未知の範囲や経理条件を拒否する',()=>{
 assert.throws(()=>setup({playerBasicScope:'unknown'}),/範囲/);assert.throws(()=>setup({playerBasicAccounting:'current'}),/経理条件/);
});
