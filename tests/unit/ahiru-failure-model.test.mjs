import test from 'node:test';
import assert from 'node:assert/strict';
import {attachFailureModel} from '../../solver/ahiru-failure-model.mjs';
import {attachRiskModel} from '../../solver/ahiru-risk-model.mjs';
import {VALUE_SCHEMA,VALUE_FEATURES} from '../../solver/browser/pro-value-model.js?v=20261107-0061';
function fixture(){const model={schema:VALUE_SCHEMA,features:[...VALUE_FEATURES],base:12,learningRate:.1,trees:[{value:1}]},versions=['game','cards','rank','autoplay'];return {mean:{model,metrics:{mean:'retained'},provenance:{versions}},risk:{id:'test',model:{...model,base:.1},provenance:{versions,targetKind:'pro-failure8',counts:{trainSeeds:1500,validationSeeds:500}}}};}
test('頻度の固定木を付けても平均の係数・指標・入力を変えない',()=>{
    const {mean,risk}=fixture(),a=structuredClone(mean),b=structuredClone(risk),out=attachFailureModel(mean,risk),{failureHead,...kept}=out.model;
    assert.deepEqual(kept,mean.model);assert.deepEqual(failureHead,{...risk.model,targetKind:'pro-failure8'});assert.deepEqual(out.metrics,mean.metrics);assert.deepEqual(mean,a);assert.deepEqual(risk,b);assert.equal(out.failure.prediction,'min(1, max(0, fixed-tree prediction))');
});
test('モデルの種類・物理版・特徴・250開始未満・二重付与を拒否する',()=>{
    for(const change of [f=>f.risk.provenance.targetKind='pro-shortfall9',f=>f.risk.provenance.versions=['other'],f=>f.risk.model.features=['private-seed'],f=>f.risk.provenance.counts.validationSeeds=249,f=>f.mean.model.shortfallHead={},f=>f.mean.model.failureHead={},f=>f.risk.model.failureHead={},f=>f.risk.model.base=NaN]){const f=fixture();change(f);assert.throws(()=>attachFailureModel(f.mean,f.risk));}
    const f=fixture();f.risk.provenance.targetKind='__proto__';assert.throws(()=>attachRiskModel(f.mean,f.risk,'__proto__'));
});
