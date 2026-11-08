import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ScoreManager} from '../../game/js/scoreManager.js?v=20261107-0064';
import {diagnoseScorePreservation} from '../../solver/browser/ahiru-score-preservation-diagnostics.js?v=20261107-0064';
const scorer=new ScoreManager(null,{migrateHighScore:false}),oldFetch=globalThis.fetch;
globalThis.fetch=async()=>({ok:true,text:async()=>readFileSync(new URL('../../game/data/rankPro.csv',import.meta.url),'utf8')});await scorer.loadRankData('test');globalThis.fetch=oldFetch;
const states={low:{experience:30,enrollment:20,satisfaction:15,accounting:15},nine:{experience:40,enrollment:20,satisfaction:15,accounting:15},s:{experience:50,enrollment:32,satisfaction:15,accounting:15},start:{experience:0,enrollment:0,satisfaction:3,accounting:5}};
function fixture(){
    const outcomes=[],rows=[];
    for(let i=0;i<250;i++){
        const gameId='game-'+i,finalStats=i<2?states.low:states.s;outcomes.push({gameId,score:scorer.calculateScore({difficulty:'pro',player:finalStats}).points,stats:{...finalStats}});
        for(let turn=0;turn<8;turn++)rows.push({gameId,rowId:gameId+'-'+turn,phase:'acquisition',observation:{difficulty:'pro',mode:'normal',turn,stats:{...(turn<6||i>2?states.start:i===0?states.s:states.nine)}}});
    }
    return {difficulty:'pro',publicInput:{rows},teachers:{outcomes},rankTable:scorer.rankTable};
}
test('9点到達後とS到達後の転落を区別し、8点も低得点へ含め、同じ研修の追加取得を重複集計しない',()=>{
    assert.equal(scorer.calculateScore({difficulty:'pro',player:states.low}).points,8);assert.equal(scorer.calculateScore({difficulty:'pro',player:states.nine}).points,9);assert.equal(scorer.calculateScore({difficulty:'pro',player:states.s}).points,12);
    const input=fixture();input.publicInput.rows.push(structuredClone(input.publicInput.rows[6]));
    for(const row of input.publicInput.rows)for(const k of ['seed','rng','outcome'])Object.defineProperty(row.observation,k,{get(){throw Error('private');}});
    const result=diagnoseScorePreservation(input),nine=result.thresholds[9],s=result.thresholds[12];
    assert.equal(result.games,250);assert.equal(nine.reachedBeforeFinalAction,3);assert.equal(nine.endedAtMost8AfterReaching,2);assert.equal(nine.allEndedAtMost8,2);assert.equal(nine.endedAtMost8WithoutReaching,0);assert.equal(s.reachedBeforeFinalAction,1);assert.equal(s.endedAtMost8AfterReaching,1);assert.equal(s.endedAtMost8WithoutReaching,1);assert.equal(nine.byTurn[6].allGames,250);assert.equal(nine.byTurn[6].currentAtLeastThreshold,3);
});
test('249開始・開始重複・欠けたターン・研修中の得点不一致・非有限な公開値/結果を拒否する',()=>{
    for(const mutate of [i=>i.teachers.outcomes.pop(),i=>i.teachers.outcomes[1].gameId=i.teachers.outcomes[0].gameId,i=>i.publicInput.rows.pop(),i=>i.publicInput.rows.push({...i.publicInput.rows[6],observation:{...i.publicInput.rows[6].observation,stats:states.start}}),i=>i.publicInput.rows[0].observation.stats.accounting=NaN,i=>i.teachers.outcomes[0].score=Infinity]){const i=fixture();mutate(i);assert.throws(()=>diagnoseScorePreservation(i));}
});
