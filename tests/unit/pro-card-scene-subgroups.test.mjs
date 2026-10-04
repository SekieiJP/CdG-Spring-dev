import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneCohorts,compareCohort} from '../../solver/pro-card-scene-subgroups.mjs';
test('条件は取得前の公開値と旧選択だけで作り、未来得点を読まない',()=>{
 const scenes=Array.from({length:500},(_,i)=>{const s={sceneId:`case-${i}`,observation:{stats:{satisfaction:i<142?15:14,accounting:i<43?15:14}},referenceWasOriginalChoice:i>=400};Object.defineProperty(s,'result',{get(){throw Error('future');}});return s;});
 const cohorts=Object.fromEntries(sceneCohorts({referenceMode:'best-other',scenes}).map(c=>[c.id,c.sceneIds]));
 assert.equal(cohorts['satisfaction-at-least15'].length,142);assert.equal(cohorts['satisfaction-below15'].length,358);assert.equal(cohorts['original-policy-selected-target'].length,400);
 assert(!sceneCohorts({referenceMode:'original-other',scenes}).some(c=>c.id.startsWith('original-policy')));
});
test('少数の条件は成績傾向を出さず、指定局面の不足と重複を拒否する',()=>{
 const a=Array.from({length:249},(_,i)=>({metadata:{sceneId:`c${i}`},get result(){throw Error('minority-score');}}));
 const ids=a.map(r=>r.metadata.sceneId);assert.deepEqual(compareCohort(a,a,ids),{n:249,trendSupported:false,reason:'最低250局面に未達のため、得点差の傾向を集計しない'});
 assert.throws(()=>compareCohort(a,a,[...ids,'missing']),/不足/);assert.throws(()=>compareCohort(a,a,[ids[0],ids[0]]),/重複/);
});
