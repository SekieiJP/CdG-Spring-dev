import {recommendAcquisition} from '../../game/js/proAcquisitionAdvisor.js';
import {alignProAcquisition} from '../../game/js/proAcquisitionConsistency.js';

/** 全開始の公開取得局面で整合規則を照合。将来の教師は推薦の入力にしない。 */
export function diagnoseProAssistConsistency({publicInput,calibration,rankTable,versions}){
    const games=new Set(publicInput.rows.map(row=>row.gameId));
    if(games.size<250)throw Error('傾向の診断は250元開始以上');
    const changedGames=new Set(),groups=new Map(),examples=[],durations=[];
    let states=0,changedStates=0,complementStates=0;
    for(const row of publicInput.rows){
        if(row.phase!=='acquisition')continue;
        const observation={...row.observation,rankTable};
        for(const key of ['seed','rng','deckOrder','outcome'])Object.defineProperty(observation,key,{get(){throw Error('取得推薦が非公開情報を参照した');}});
        const before=JSON.stringify(observation),start=performance.now();
        const base=recommendAcquisition(observation),aligned=alignProAcquisition(observation,base,{calibration,versions});
        durations.push(performance.now()-start);
        if(before!==JSON.stringify(observation)||aligned.targetRank!=='S+')throw Error('入力不変性・S+目標の不一致');
        const alignment=aligned.alignment;
        if(alignment.availableComplement&&!aligned.recommended.alignment?.complements)throw Error('補完候補を優先していない');
        states++;if(alignment.availableComplement)complementStates++;
        const key=alignment.focusAxis||'none';
        if(!groups.has(key))groups.set(key,{games:new Set(),states:0,changedStates:0,complementStates:0});
        const group=groups.get(key);group.games.add(row.gameId);group.states++;
        if(alignment.availableComplement)group.complementStates++;
        if(alignment.changedRecommendation){
            changedStates++;changedGames.add(row.gameId);group.changedStates++;
            if(examples.length<6)examples.push({gameId:row.gameId,turn:observation.turn,stats:observation.stats,ownedCardNos:observation.owned.map(card=>card.cardNo),candidateCardNos:observation.candidates.map(card=>card.cardNo),baseIndices:base.recommended.indices,alignedIndices:aligned.recommended.indices,alignment});
        }
    }
    durations.sort((a,b)=>a-b);
    return {games:games.size,acquisitionStates:states,changedGames:changedGames.size,changedStates,complementStates,
        groups:Object.fromEntries([...groups].map(([key,value])=>[key,{...value,games:value.games.size,support250:value.games.size>=250}])),
        timingMs:{p95:durations[Math.ceil(durations.length*.95)-1],max:durations.at(-1)},examples,newSimulatedGames:0,
        interpretation:'同じ過去の全開始の公開局面に対する静的な数式診断。変更後の完走得点・人間の成功率・推薦の因果効果は測定していない。250開始未満の内訳は件数のみ。'};
}
