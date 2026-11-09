import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CardManager} from '../../game/js/cardManager.js?v=20261110-0065';
import {ScoreManager} from '../../game/js/scoreManager.js?v=20261110-0065';
import {createAhiruRoleInspector} from '../../game/js/ahiruCardRoles.js?v=20261110-0065';
import {DEFAULT_TURNS} from '../../game/js/defaultRules.js?v=20261110-0065';
import {recommendProStatus} from '../../game/js/ahiruProAdvice.js?v=20261110-0065';
const manager=new CardManager(null);manager.parseCSV(readFileSync(new URL('../../game/data/cards_pro.csv',import.meta.url),'utf8'));
const scorer=new ScoreManager(null),savedFetch=globalThis.fetch;globalThis.fetch=async()=>({ok:true,text:async()=>readFileSync(new URL('../../game/data/rankPro.csv',import.meta.url),'utf8')});await scorer.loadRankData('test');globalThis.fetch=savedFetch;
const card=n=>({...manager.allCards.find(c=>Number(c.cardNo)===n),acquiredTurn:0});
function observation(nos=[1,2,3,4,5]){return {difficulty:'pro',mode:'normal',turn:6,totalTurns:8,stats:{experience:45,enrollment:40,satisfaction:25,accounting:18},tokens:{passion:0,fatigue:0,inspiration:0,organize:0},owned:nos.map(card),candidates:[25,39,40].map(card),pickCount:1,allowSkip:false,turns:Array(8).fill({}),rankTable:scorer.rankTable};}
test('庶務カテゴリのNo40や経理14固定のNo50を経理15の回復役に数えない',()=>{
 const o=observation([5,17,39,40,50]);o.stats.accounting=10;const r=createAhiruRoleInspector(o,{...o.stats,accounting:16});
 assert.equal(r.canRecover(card(40),'accounting',15),false);assert.equal(r.canRecover(card(50),'accounting',15),false);
 assert.equal(r.canRecover(card(5),'accounting',15),true);assert.equal(r.canRecover(card(17),'accounting',15),true);assert.equal(r.canRecover(card(39),'accounting',15),true);
 assert.equal(r.supportsHand(card(40)),true);assert.equal(r.supportsHand(card(51)),false);
});
test('削除候補を選んでも確定前の保有役割と助言を変えない',()=>{
 const o=observation([5,40,45,50]);o.turn=5;o.stats={experience:40,enrollment:24,satisfaction:25,accounting:15};
 const before=recommendProStatus(o,{phase:'deletion',deleteMax:1});
 assert.deepEqual(recommendProStatus(o,{phase:'deletion',deleteMax:1,selectedIndices:[0]}),before);
 assert.ok(before.forecast.observation.owned.some(c=>String(c.cardNo)==='5'));
});
test('推奨日程も含め、削除せず進む案を比較する',()=>{
 const o=observation([5,40,45,50]);o.turn=5;o.stats={experience:40,enrollment:32,satisfaction:25,accounting:15};o.turns=DEFAULT_TURNS.map(t=>({recommended:t.recommended,recommendedStatus:t.recommendedStatus,training:t.training,deletion:t.delete}));
 const advice=recommendProStatus(o,{phase:'deletion',deleteMax:1});assert.ok(advice.deletion.checked>1);assert.equal(advice.forecast.observation.owned.length,4);
 assert.equal(advice.deletion.keep.indices.length,0);
});
test('満足が高ければ体験40未満でもSへ届く経路を認める',()=>{
 const o=observation([]);o.turn=7;o.stats={experience:32,enrollment:32,satisfaction:35,accounting:15};
 const advice=recommendProStatus(o,{phase:'acquisition'});assert.equal(advice.tone,'green');assert.equal(advice.outlookReason,'on-track-grow');
});
test('見込み入塾が体験上限に達している時は体験の補強を先に案内する',()=>{
 const o=observation([]);o.turn=7;o.stats={experience:35,enrollment:35,satisfaction:15,accounting:15};
 const advice=recommendProStatus(o,{phase:'acquisition'});assert.equal(advice.tone,'red');assert.equal(advice.axis,'experience');
});
test('十分な経理でも削除利益がなければ無削除で進む',()=>{
 const o=observation([5]);o.stats={experience:55,enrollment:48,satisfaction:40,accounting:40};
 const advice=recommendProStatus(o,{phase:'deletion',deleteMax:1});assert.equal(advice.tone,'green');assert.equal(advice.text,'このまま次に進もう');assert.equal(advice.reason,'deletion-keep');
});
test('各パラメータがS表示でも11点なら、必要な次の得点段階を案内する',()=>{
 const o=observation([]);o.turn=7;o.stats={experience:40,enrollment:32,satisfaction:15,accounting:15};
 const advice=recommendProStatus(o,{phase:'acquisition'});assert.equal(advice.tone,'red');assert.equal(advice.actionAxis,'satisfaction');assert.match(advice.text,/満足が心配/);assert.ok(advice.preferredIndices.some(i=>o.candidates[i].cardNo==='40'));
});
test('最終会議では未来の成長や削除効果でSへ届くと案内しない',()=>{
 const o=observation([1,2,3,4,5]);o.turn=7;o.stats={experience:40,enrollment:32,satisfaction:15,accounting:15};
 const bad=recommendProStatus(o,{phase:'deletion',deleteMax:1});assert.equal(bad.reason,'final-score-below-s');assert.equal(bad.tone,'red');
 o.stats.experience=50;const good=recommendProStatus(o,{phase:'deletion',deleteMax:1});assert.equal(good.tone,'green');assert.equal(good.reason,'final-score-ready');
});
test('公開状態だけを使い、複数の不足・余剰・デッキで25文字を超えず、状態を変更しない',()=>{
 const states=[{experience:0,enrollment:0,satisfaction:3,accounting:5},{experience:35,enrollment:35,satisfaction:15,accounting:15},{experience:55,enrollment:48,satisfaction:40,accounting:40},{experience:45,enrollment:40,satisfaction:14,accounting:14},{experience:20,enrollment:12,satisfaction:20,accounting:0}];
 for(const turn of [0,3,6,7])for(const stats of states)for(const phase of ['acquisition','deletion']){
  const o=observation();o.turn=turn;o.pickCount=turn===0?2:1;o.stats={...stats};const before=JSON.stringify(o);
  for(const key of ['seed','rng','deckOrder','outcome'])Object.defineProperty(o,key,{enumerable:true,configurable:true,get(){throw Error('private');}});
  const a=recommendProStatus(o,{phase,deleteMax:1});assert.ok(['red','yellow','green'].includes(a.tone));assert.ok(Array.from(a.text).length<=25);for(const key of ['seed','rng','deckOrder','outcome'])delete o[key];assert.equal(JSON.stringify(o),before);
 }
 assert.equal(recommendProStatus({...observation(),difficulty:'fresh'}),null);
});

test('イベントの最終会議は公式の上限超過加点を含め、成長軸を余剰扱いしない',()=>{
 const o=observation([]);o.mode='event';o.turn=7;o.stats={experience:60,enrollment:16,satisfaction:35,accounting:15};
 const official=scorer.calculateScore({difficulty:'pro',player:{...o.stats},event:{enabled:true,eventId:'summer-cup-2026-post-obon'}});
 assert.equal(official.points,12);assert.equal(recommendProStatus(o,{phase:'deletion'}).reason,'final-score-ready');
 o.stats={experience:80,enrollment:70,satisfaction:65,accounting:15};
 const growth=recommendProStatus(o);assert.equal(growth.tone,'green');assert.notEqual(growth.reason,'surplus-redirect-acquisition');assert.ok(growth.axis);
});

test('現在の総合Sを確保済みなら、コストで下がる予測を不足と呼ばず守るように案内する',()=>{
 const o=observation([45]);o.turn=5;o.stats={experience:50,enrollment:40,satisfaction:25,accounting:15};
 assert.ok(scorer.calculateScore({difficulty:'pro',player:o.stats}).points>=12);const before=JSON.stringify(o);
 for(const phase of ['acquisition','deletion']){const advice=recommendProStatus(o,{phase,deleteMax:1});assert.equal(advice.tone,'yellow');assert.equal(advice.axis,'accounting');assert.equal(advice.outlookReason,'current-s-protect');assert.doesNotMatch(advice.text,/不足|回復札/);assert.ok(advice.forecast.rawEnd.accounting<15);assert.ok(Array.from(advice.text).length<=25);}
 assert.equal(JSON.stringify(o),before);
});
