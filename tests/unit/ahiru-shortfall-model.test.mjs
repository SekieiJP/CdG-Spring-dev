import test from 'node:test';
import assert from 'node:assert/strict';
import {attachShortfallModel} from '../../solver/ahiru-shortfall-model.mjs';
import {VALUE_SCHEMA,VALUE_FEATURES} from '../../solver/browser/pro-value-model.js?v=20261107-0062';
function fixture(){const model={schema:VALUE_SCHEMA,features:[...VALUE_FEATURES],base:12,learningRate:.1,trees:[{value:1}]},versions=['game','cards','rank','autoplay'];return {mean:{model,metrics:{mean:'retained'},provenance:{versions}},tail:{id:'test',model:{...model,base:.1},provenance:{versions,targetKind:'pro-shortfall9',counts:{trainSeeds:1500,validationSeeds:500}}}};}
test('損失を付けても平均モデルの係数・メトリクスと入力は変更しない',()=>{
 const {mean,tail}=fixture(),before=structuredClone(mean),head=structuredClone(tail),out=attachShortfallModel(mean,tail);const {shortfallHead,...kept}=out.model;
 assert.deepEqual(kept,mean.model);assert.deepEqual(shortfallHead,{...tail.model,targetKind:'pro-shortfall9'});assert.deepEqual(mean,before);assert.deepEqual(tail,head);assert.deepEqual(out.metrics,mean.metrics);
});
test('別の物理版・特徴・教師、250未満の検証、損失モデルの二重付与を拒否する',()=>{
 for(const change of [f=>f.tail.provenance.versions=['other'],f=>f.tail.model.features=['private-seed'],f=>f.tail.provenance.targetKind='official-score',f=>f.tail.provenance.counts.validationSeeds=249,f=>f.mean.model.shortfallHead={},f=>f.tail.model.base=NaN,f=>delete f.tail.provenance.counts,f=>delete f.mean.provenance.versions]){const f=fixture();change(f);assert.throws(()=>attachShortfallModel(f.mean,f.tail));}
});
