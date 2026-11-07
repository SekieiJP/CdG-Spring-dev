import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ScoreManager} from '../../game/js/scoreManager.js?v=20261107-0061';
import {CardManager} from '../../game/js/cardManager.js?v=20261107-0061';
import {getFreshSGoals,scoreFreshStats} from '../../game/js/ahiruFreshGoals.js?v=20261107-0061';
import {projectFreshAdviceState} from '../../game/js/ahiruFreshForecast.js?v=20261107-0061';
import {recommendFreshStatus} from '../../game/js/ahiruFreshAdvice.js?v=20261107-0061';
const scorer=new ScoreManager(null,{migrateHighScore:false}),savedFetch=globalThis.fetch;
globalThis.fetch=async()=>({ok:true,text:async()=>readFileSync(new URL('../../game/data/rankFresh.csv',import.meta.url),'utf8')});await scorer.loadRankData('test');globalThis.fetch=savedFetch;
const manager=new CardManager(null);manager.parseCSV(readFileSync(new URL('../../game/data/cards_fresh.csv',import.meta.url),'utf8'));
const card=no=>({...manager.allCards.find(c=>Number(c.cardNo)===no),acquiredTurn:0});
function observation(nos=[]){return {difficulty:'fresh',mode:'normal',turn:6,totalTurns:8,stats:{experience:20,enrollment:15,satisfaction:15,accounting:15},tokens:{passion:0,fatigue:0,inspiration:0,organize:0},owned:nos.map(card),candidates:[25,39,40].map(card),pickCount:1,allowSkip:false,turns:Array(8).fill({}),rankTable:scorer.rankTable};}
test('評価専用の公式得点は保存に触れず、FRESHの精度とイベント加点も一致する',()=>{
 const old=globalThis.localStorage;let reads=0;globalThis.localStorage={getItem(){reads++;throw Error('storage');}};
 try{new ScoreManager(null,{migrateHighScore:false});for(const stats of [{experience:12,enrollment:12,satisfaction:15,accounting:15},{experience:13,enrollment:13,satisfaction:14,accounting:15},{experience:60,enrollment:50,satisfaction:15,accounting:15}])for(const event of [false,true]){
  const actual=scoreFreshStats(stats,{event}),expected=scorer.calculateScore({difficulty:'fresh',player:stats,event:event?{enabled:true,eventId:'summer-cup-2026-post-obon'}:null});assert.deepEqual(actual,expected);
 }assert.equal(reads,0);}finally{if(old===undefined)delete globalThis.localStorage;else globalThis.localStorage=old;}
});
test('FRESHでは体験12でも総合Sへ届き、退塾1人を許容する別経路も列挙する',()=>{
 const goals=getFreshSGoals(scorer.rankTable);assert.equal(goals.targetPoints,8);assert.equal(goals.routes.length,3);
 const examples=[{experience:12,enrollment:12,satisfaction:15,accounting:15},{experience:13,enrollment:13,satisfaction:14,accounting:15},{experience:13,enrollment:13,satisfaction:15,accounting:14}];
 for(const stats of examples){assert.equal(scoreFreshStats(stats).points,8);assert.ok(goals.routes.some(route=>JSON.stringify(route)===JSON.stringify(stats)));}
 for(const route of goals.routes){assert.ok(scoreFreshStats(route).points>=8);assert.ok(!goals.routes.some(other=>other!==route&&Object.keys(route).every(axis=>other[axis]<=route[axis])));}
 assert.throws(()=>goals.routes[0].accounting=0);assert.equal(getFreshSGoals(null),null);
});
test('整数の境界を広く調べ、経路と公式S判定が一致する',()=>{
 const goals=getFreshSGoals(scorer.rankTable);
 for(let experience=9;experience<=16;experience++)for(let enrollment=8;enrollment<=experience;enrollment++)for(let satisfaction=12;satisfaction<=16;satisfaction++)for(let accounting=12;accounting<=16;accounting++){
  const stats={experience,enrollment,satisfaction,accounting},route=goals.routes.some(r=>Object.keys(r).every(axis=>stats[axis]>=r[axis]));assert.equal(route,scoreFreshStats(stats).points>=8);
 }
});
test('不足と順調を公式S経路で分け、FRESHのNo50を経理15の回復札と扱わない',()=>{
 const o=observation();o.turn=7;o.stats={experience:12,enrollment:12,satisfaction:15,accounting:15};assert.equal(recommendFreshStatus(o).tone,'green');
 o.stats={experience:13,enrollment:13,satisfaction:14,accounting:15};assert.equal(recommendFreshStatus(o).tone,'green');
 o.owned=[card(50)];o.stats={experience:20,enrollment:12,satisfaction:15,accounting:10};const bad=recommendFreshStatus(o);assert.equal(bad.tone,'red');assert.equal(bad.axis,'accounting');
});
test('削除予定を実デッキへ反映せず、利益がなければ削除を見送る',()=>{
 const o=observation([5,44,50]);o.turn=5;o.stats.enrollment=8;assert.ok(scoreFreshStats(o.stats).points<8);
 const shortage=recommendFreshStatus(o,{phase:'deletion',deleteMax:1,selectedIndices:[0]});assert.equal(shortage.tone,'red');assert.equal(shortage.axis,'accounting');
 o.owned=[card(5)];o.stats={experience:35,enrollment:30,satisfaction:20,accounting:40};const surplus=recommendFreshStatus(o,{phase:'deletion',deleteMax:1});assert.equal(surplus.tone,'green');assert.equal(surplus.text,'このまま次に進もう');assert.deepEqual(surplus.deletion.best.indices,[]);
});
test('最後の会議では現在値だけで判断し、部分選択と非公開情報を混ぜない',()=>{
 const o=observation([1,2,3,4,5]);o.turn=0;o.pickCount=2;const partial=projectFreshAdviceState(o,{selectedIndices:[0]});assert.equal(partial.observation.owned.length,5);
 const complete=projectFreshAdviceState(o,{selectedIndices:[0,1]});assert.equal(complete.observation.owned.length,7);
 o.turn=7;o.pickCount=1;o.stats={experience:12,enrollment:12,satisfaction:15,accounting:15};
 const before=JSON.stringify(o);for(const key of ['seed','rng','deckOrder','outcome'])Object.defineProperty(o,key,{get(){throw Error('private');}});
 const advice=recommendFreshStatus(o,{phase:'deletion',deleteMax:1,selectedIndices:[0]});assert.equal(advice.reason,'final-score-ready');assert.equal(advice.forecast.remaining,0);assert.equal(JSON.stringify(o),before);assert.ok(Array.from(advice.text).length<=25);
});

test('FRESHも既に総合Sなら、予測上の経理減少はSを守る注意として案内する',()=>{
 const o=observation([44]);o.turn=5;assert.ok(scoreFreshStats(o.stats).points>=8);const before=JSON.stringify(o);
 for(const phase of ['acquisition','deletion']){const advice=recommendFreshStatus(o,{phase,deleteMax:1});assert.equal(advice.tone,'yellow');assert.equal(advice.outlookReason,'current-s-protect');assert.equal(advice.axis,'accounting');assert.doesNotMatch(advice.text,/不足|回復札/);assert.ok(advice.forecast.rawEnd.accounting<15);assert.ok(Array.from(advice.text).length<=25);}
 assert.equal(JSON.stringify(o),before);
});
