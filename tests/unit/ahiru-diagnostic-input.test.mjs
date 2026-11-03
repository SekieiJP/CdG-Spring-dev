import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDiagnosticData} from '../../solver/ahiru-advice-diagnostics.mjs';
function fixture(){
    const ids=Array.from({length:250},(_,i)=>'game-'+i);
    return {
        publicInput:{schema:'ahiru-public-decisions-v1',rows:ids.map(gameId=>({rowId:gameId+'-choice',gameId,phase:'acquisition'}))},
        teachers:{schema:'ahiru-decision-teachers-v1',outcomes:ids.map(gameId=>({gameId,score:12,stats:{experience:50,enrollment:32,satisfaction:15,accounting:15}})),labels:ids.map(gameId=>({rowId:gameId+'-choice',gameId}))},
        audit:{counts:{games:250,decisions:250,acquisition:250,deletion:0},publicInputSha256:'public',teachersSha256:'teachers',physical:{cardVersion:'cards',rankVersion:'ranks'}},
        seeds:ids.map((gameId,i)=>({gameId,sourceSeed:'independent:'+i})),
        trainingSeeds:ids.map((gameId,i)=>({gameId,sourceSeed:'training:'+i})),
        calibration:{sourceGames:250,sourcePublicSha256:'training-public',cardVersion:'cards',rankVersion:'ranks'},
        publicSha:'public',teacherSha:'teachers',trainingPublicSha:'training-public'
    };
}
test('異なる250元開始・全判断・教師を照合し、入力を変更しない',()=>{
    const f=fixture(),before=structuredClone(f);assert.deepEqual(validateDiagnosticData(f),{games:250,overlap:0,inSample:false,independentStarts:true});assert.deepEqual(f,before);
});
test('別のgameIdへ付け替えても、補正作成の元開始を独立検証に混ぜない',()=>{
    const f=fixture();f.seeds[40].sourceSeed='training:10';assert.throws(()=>validateDiagnosticData(f),/重複/);
    assert.deepEqual(validateDiagnosticData({...f,allowDevelopment:true}),{games:250,overlap:1,inSample:true,independentStarts:false});
});
test('249開始・同一開始の二重読み込み・判断欠落・教師の取り違えを拒否する',()=>{
    for(const change of [f=>f.audit.counts.games=249,f=>f.seeds[1].sourceSeed=f.seeds[0].sourceSeed,f=>f.teachers.outcomes[1].gameId=f.teachers.outcomes[0].gameId,f=>f.publicInput.rows.pop(),f=>f.teachers.labels[1].gameId='game-2',f=>f.teachers.labels[1].rowId='missing',f=>f.teachers.outcomes[1].stats.accounting=NaN]){
        const f=fixture();change(f);assert.throws(()=>validateDiagnosticData(f));
    }
});
test('公開入力・教師・補正元のハッシュ違いと物理版の違いを拒否する',()=>{
    for(const change of [f=>f.publicSha='other',f=>f.teacherSha='other',f=>f.trainingPublicSha='other',f=>f.audit.physical.cardVersion='other',f=>f.audit.physical.rankVersion='other',f=>f.trainingSeeds.pop()]){
        const f=fixture();change(f);assert.throws(()=>validateDiagnosticData(f));
    }
});
