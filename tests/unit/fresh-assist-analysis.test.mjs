import test from 'node:test';
import assert from 'node:assert/strict';
import { pairedComparison, summarize } from '../../solver/fresh-assist-analysis.mjs';

function record(seed,model,value,grade='S',extra={}) {
    return {metadata:{seed,difficulty:'fresh',source:'autoplay',strategy:'fresh_stable',continuationPolicy:'fresh_stable',
        acquisitionModel:model,cardVersion:'cards-1',rankVersion:'rank-1',rulesVersion:'rules-1',codeVersion:'v1',...extra},
        events:[],result:{score:{displayScore:value,rank:{grade}}}};
}
test('同seedの対応を維持してS率と中央値の差を測る',()=>{
    const before=[record('dev:0',null,3,'B'),record('dev:1',null,7)];
    const after=[record('dev:1','balanced',9),record('dev:0','balanced',8)];
    const result=pairedComparison(before,after,200);
    assert.equal(result.n,2);
    assert.equal(result.sRateDifference,.5);
    assert.equal(result.medianDifference,5);
    assert.equal(result.improvedToS,1);
    assert.equal(result.lostS,0);
    assert.deepEqual(result.sRateDifference95,[0,1]);
    assert.equal(pairedComparison(before,[record('validation:0','balanced',9)]),null);
});
test('開発・検証・ルールの異なる記録を混ぜず、同じseedの二重読み込みを防ぐ',()=>{
    const a=record('dev:0',null,7),b=record('dev:0','balanced',8);
    const result=summarize([a,a,b,record('validation:0','balanced',9),record('dev:1','balanced',9,'S',{rulesVersion:'rules-2'})]);
    assert.equal(result.groups.length,4);
    assert.equal(result.groups[0].n,1);
    assert.equal(result.comparisons.length,1);
    assert.equal(result.comparisons[0].n,1);
    assert.throws(()=>summarize([a,record('dev:0',null,3,'B')]),/競合/);
});
test('同条件で最もS率が高い既存方略を比較基準にする',()=>{
    const data=summarize([record('dev:0',null,3,'B',{strategy:'greedy',continuationPolicy:'greedy'}),
        record('dev:0',null,7),record('dev:0','balanced',9)]);
    const comparison=data.comparisons.find(c=>c.after===2);
    assert.equal(comparison.before,1);
    assert.equal(comparison.sRateDifference,0);
    assert.equal(comparison.medianDifference,2);
});
