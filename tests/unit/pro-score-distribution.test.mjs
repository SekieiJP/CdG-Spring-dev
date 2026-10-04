import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseDistribution} from '../../solver/pro-score-distribution.mjs';
const group=()=>({n:250,resets:0,mean:(2*2+12*123+13*125)/250,scoreDistribution:{2:2,12:123,13:125}});
test('全開始の欠損と余剰を分解し、少数の低得点救済を実成績と混同しない',()=>{
 const d=diagnoseDistribution(group());assert.equal(d.n,250);assert.ok(Math.abs(d.netShortfallPerStart-(12.5-d.mean))<1e-9);assert.equal(d.buckets.reduce((s,b)=>s+b.count,0),250);
 assert.equal(d.below8Repair.find(r=>r.replacementScore===12).affectedCount,2);assert.equal(d.below8Repair.find(r=>r.replacementScore===12).gainPerStart,.08);assert.equal(d.onePointUpgradesNeeded,20);assert.equal(d.below8Repair.find(r=>r.replacementScore===16).reachesTarget,true);
});
test('不足・リセット・得点分布と平均の矛盾・不正な得点を拒否する',()=>{
 for(const patch of [{n:249},{resets:1},{mean:12.5},{scoreDistribution:{12:249}},{scoreDistribution:{17:250}},{scoreDistribution:{12.5:250}}])assert.throws(()=>diagnoseDistribution({...group(),...patch}));
});
