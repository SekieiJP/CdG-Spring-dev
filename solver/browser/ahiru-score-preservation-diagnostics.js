import {ScoreManager} from '../../game/js/scoreManager.js';
/** 過去の全開始の公開状態を公式得点で記述集計する。新規判断や介入の成績ではない。 */
export function diagnoseScorePreservation({difficulty,publicInput,teachers,rankTable}){
    if(difficulty!=='pro'||!Array.isArray(publicInput?.rows)||!Array.isArray(teachers?.outcomes))throw Error('通常PROの公開判断と過去の結果が必要');
    if(teachers.outcomes.some(o=>typeof o.gameId!=='string'||!o.gameId||!Number.isFinite(o.score)))throw Error('元開始IDと有限な過去の公式得点が必要');
    const scorer=new ScoreManager(null,{migrateHighScore:false});scorer.rankTable=rankTable;
    const games=new Map(teachers.outcomes.map(o=>[o.gameId,{outcome:o,before:new Map()}]));
    if(games.size!==teachers.outcomes.length||games.size<250)throw Error('異なる全250開始以上が必要');
    for(const row of publicInput.rows){
        if(row.phase!=='acquisition')continue;
        const o=row.observation,game=games.get(row.gameId);
        if(!game||o.difficulty!=='pro'||o.mode!=='normal'||!Number.isInteger(o.turn)||o.turn<0||o.turn>7||['experience','enrollment','satisfaction','accounting'].some(k=>!Number.isFinite(o.stats?.[k])||o.stats[k]<0))throw Error('通常PROの取得局面が必要');
        const points=scorer.calculateScore({difficulty:'pro',player:o.stats}).points;
        if(game.before.has(o.turn)&&game.before.get(o.turn)!==points)throw Error('同じ研修ターン内の現在得点が変わった');
        game.before.set(o.turn,points);
    }
    const rows=[...games.values()];if(rows.some(g=>g.before.size!==8))throw Error('全開始の全8ターンの公開状態が必要');
    return {games:rows.length,allStartsAccepted:true,thresholds:Object.fromEntries([9,12].map(threshold=>{
        const earliest=g=>[...g.before].sort((a,b)=>a[0]-b[0]).find(([,points])=>points>=threshold)?.[0]??null;
        const reached=rows.filter(g=>earliest(g)!==null),low=rows.filter(g=>g.outcome.score<=8);
        return [threshold,{label:threshold===9?'8点以下を避ける境界':'総合Sの境界',reachedBeforeFinalAction:reached.length,endedBelowThresholdAfterReaching:reached.filter(g=>g.outcome.score<threshold).length,endedAtMost8AfterReaching:reached.filter(g=>g.outcome.score<=8).length,endedAtMost8WithoutReaching:low.filter(g=>earliest(g)===null).length,allEndedAtMost8:low.length,earliestReachedByTurn:Object.fromEntries(Array.from({length:8},(_,turn)=>[turn,rows.filter(g=>earliest(g)===turn).length])),byTurn:Object.fromEntries(Array.from({length:8},(_,turn)=>[turn,{allGames:rows.length,currentAtLeastThreshold:rows.filter(g=>g.before.get(turn)>=threshold).length,currentAtLeastThresholdAndEndedAtMost8:rows.filter(g=>g.before.get(turn)>=threshold&&g.outcome.score<=8).length}]))}];
    })),interpretation:'全開始の記述的な件数。新しい配置制約を使うと、その後の取得・削除・ドロー・配置が変わるので、この件数を救済件数や改善幅とは扱わない。下位群250未満の条件付き成績は推定しない。'};
}
