import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeRiskTarget,clipRiskPrediction} from '../../solver/browser/pro-risk-targets.js?v=20261110-0066';
test('8点以下の頻度と9点までの損失の深さを区別し、8点をどちらも除外しない',()=>{
    for(const [score,failure,loss]of [[-4,1,13],[7,1,2],[8,1,1],[8.5,0,.5],[9,0,0],[12,0,0]]){assert.equal(encodeRiskTarget(score,'pro-failure8'),failure);assert.equal(encodeRiskTarget(score,'pro-shortfall9'),loss);}
});
test('危険予測は非負にし、頻度だけを1で制限する。平均モデルの値とは混ぜない',()=>{
    for(const kind of ['pro-failure8','pro-shortfall9']){assert.equal(clipRiskPrediction(-.2,kind),0);assert.equal(clipRiskPrediction(.3,kind),.3);}
    assert.equal(clipRiskPrediction(13,'pro-failure8'),1);assert.equal(clipRiskPrediction(13,'pro-shortfall9'),13);
    for(const value of [NaN,Infinity,-Infinity])for(const fn of [encodeRiskTarget,clipRiskPrediction])assert.throws(()=>fn(value,'pro-failure8'));
    for(const fn of [encodeRiskTarget,clipRiskPrediction])assert.throws(()=>fn(12,'official-score'));
});

test('実際の学習入口で、頻度・損失・平均を取り違えたプロファイルを拒否する',async()=>{
    const {mkdtemp,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{fileURLToPath}=await import('node:url'),{spawnSync}=await import('node:child_process');
    const dir=await mkdtemp(join(tmpdir(),'cdg-risk-target-'));
    try{for(const [targetKind,profile]of [['pro-failure8','shortfall3'],['pro-shortfall9','failure3'],['official-score','failure3'],['pro-failure8','depth3']]){
        await writeFile(join(dir,'dataset.json'),JSON.stringify({targetKind,counts:{trainSeeds:250,validationSeeds:250}}));
        const r=spawnSync(process.execPath,[fileURLToPath(new URL('../../solver/pro-value-train.mjs',import.meta.url)),dir,profile],{encoding:'utf8',timeout:10000});
        assert.equal(r.status,1);assert.match(r.stderr,/学習対象とモデルの種類が異なる/);assert.doesNotMatch(r.stdout,/VALUE/);
    }}finally{await rm(dir,{recursive:true,force:true});}
});
