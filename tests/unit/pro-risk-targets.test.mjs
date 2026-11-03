import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeRiskTarget,clipRiskPrediction} from '../../solver/browser/pro-risk-targets.js';
test('8点以下の頻度と9点までの損失の深さを区別し、8点をどちらも除外しない',()=>{
    for(const [score,failure,loss]of [[-4,1,13],[7,1,2],[8,1,1],[8.5,0,.5],[9,0,0],[12,0,0]]){assert.equal(encodeRiskTarget(score,'pro-failure8'),failure);assert.equal(encodeRiskTarget(score,'pro-shortfall9'),loss);}
});
test('危険予測は非負にし、頻度だけを1で制限する。平均モデルの値とは混ぜない',()=>{
    for(const kind of ['pro-failure8','pro-shortfall9']){assert.equal(clipRiskPrediction(-.2,kind),0);assert.equal(clipRiskPrediction(.3,kind),.3);}
    assert.equal(clipRiskPrediction(13,'pro-failure8'),1);assert.equal(clipRiskPrediction(13,'pro-shortfall9'),13);
    for(const value of [NaN,Infinity,-Infinity])for(const fn of [encodeRiskTarget,clipRiskPrediction])assert.throws(()=>fn(value,'pro-failure8'));
    for(const fn of [encodeRiskTarget,clipRiskPrediction])assert.throws(()=>fn(12,'official-score'));
});
