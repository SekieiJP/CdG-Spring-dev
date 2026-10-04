import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseDistribution,scoreMigration} from '../../solver/pro-score-distribution.mjs';
const group=()=>({n:250,resets:0,mean:(2*2+12*123+13*125)/250,scoreDistribution:{2:2,12:123,13:125}});
test('全開始の欠損と余剰を分解し、少数の低得点救済を実成績と混同しない',()=>{
 const d=diagnoseDistribution(group());assert.equal(d.n,250);assert.ok(Math.abs(d.netShortfallPerStart-(12.5-d.mean))<1e-9);assert.equal(d.buckets.reduce((s,b)=>s+b.count,0),250);
 assert.equal(d.below8Repair.find(r=>r.replacementScore===12).affectedCount,2);assert.equal(d.below8Repair.find(r=>r.replacementScore===12).gainPerStart,.08);assert.equal(d.onePointUpgradesNeeded,20);assert.equal(d.below8Repair.find(r=>r.replacementScore===16).reachesTarget,true);
});
test('不足・リセット・得点分布と平均の矛盾・不正な得点を拒否する',()=>{
 for(const patch of [{n:249},{resets:1},{mean:12.5},{scoreDistribution:{12:249}},{scoreDistribution:{17:250}},{scoreDistribution:{12.5:250}}])assert.throws(()=>diagnoseDistribution({...group(),...patch}));
});

const outcome=(i,score)=>({seed:`paired:${i}`,score,firstOfferHash:'same',provenance:{codeHash:'fixed'},cardVersion:'cards',rankVersion:'ranks',source:'autoplay'});
test('対応差を全250開始に対する寄与に分け、小得点帯の条件付き平均を出さない',()=>{
 const a=Array.from({length:250},(_,i)=>outcome(i,i===0?7:12)),b=a.map((r,i)=>({...r,score:i===0?12:i<51?13:12}));
 const d=scoreMigration(a,b);assert.equal(d.comparison.meanDifference,.22);assert.ok(Math.abs(d.byBefore.reduce((s,r)=>s+r.netContributionPerStart,0)-.22)<1e-9);assert.equal(d.byBefore[0].count,1);assert.equal(d.byBefore[0].netContributionPerStart,.02);assert.equal(d.score13.after,50);
 assert.throws(()=>scoreMigration(a,b.slice(1)));assert.throws(()=>scoreMigration(a,b.map((r,i)=>i===0?{...r,score:NaN}:r)));assert.throws(()=>scoreMigration(a,b.map((r,i)=>i===0?{...r,score:17}:r)));assert.throws(()=>scoreMigration(a,b.map((r,i)=>i===0?{...r,firstOfferHash:'changed'}:r)));assert.throws(()=>scoreMigration(a,b.map((r,i)=>i===0?{...r,reroll:{}}:r)));
});
