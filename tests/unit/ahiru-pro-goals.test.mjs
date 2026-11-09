import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ScoreManager} from '../../game/js/scoreManager.js?v=20261110-0065';
import {getProSGoals} from '../../game/js/ahiruProGoals.js?v=20261110-0065';
const scorer=new ScoreManager(null),savedFetch=globalThis.fetch;
globalThis.fetch=async()=>({ok:true,text:async()=>readFileSync(new URL('../../game/data/rankPro.csv',import.meta.url),'utf8')});
await scorer.loadRankData('test');globalThis.fetch=savedFetch;
const axes=['experience','enrollment','satisfaction','accounting'],meets=(stats,r)=>axes.every(k=>stats[k]>=r[k]);
const official=stats=>scorer.calculateScorePro({difficulty:'pro',player:stats,event:{enabled:false}}).points;
test('各パラメータのS表示11点と総合S12点を区別し、全経路を公式計算で確認する',()=>{
 const goals=getProSGoals(scorer.rankTable),base={experience:40,enrollment:32,satisfaction:15,accounting:15};
 assert.equal(goals.targetPoints,12);assert.equal(official(base),11);assert.ok(!goals.routes.some(r=>meets(base,r)));
 for(const stats of [{...base,experience:50},{...base,enrollment:40},{...base,satisfaction:25}]){assert.equal(official(stats),12);assert.ok(goals.routes.some(r=>meets(stats,r)));}
 for(const r of goals.routes)assert.ok(official(r)>=12);
 assert.deepEqual(goals.caps,{experience:50,enrollment:48,satisfaction:35,accounting:15});
});
test('劣る経路を除き、返却値の変更から基準を保護する',()=>{
 const g=getProSGoals(scorer.rankTable);for(const r of g.routes)assert.ok(!g.routes.some(s=>s!==r&&axes.every(k=>s[k]<=r[k])&&axes.some(k=>s[k]<r[k])));
 assert.throws(()=>{g.routes[0].experience=0;});assert.throws(()=>{g.caps.accounting=0;});assert.equal(getProSGoals(scorer.rankTable),g);
});
test('得点基準の変化を表から読み、利用できない表には経路を作らない',()=>{
 const table=structuredClone(scorer.rankTable);table.find(r=>r.grade==='S').rankThreshold=13;
 const g=getProSGoals(table);assert.equal(g.targetPoints,13);assert.ok(g.routes.every(r=>official(r)>=13));
 assert.equal(getProSGoals([]),null);assert.equal(getProSGoals(null),null);
});
