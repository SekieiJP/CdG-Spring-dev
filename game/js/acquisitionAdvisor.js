import * as fresh from './freshAcquisitionAdvisor.js?v=20261107-0060';
import * as pro from './proAcquisitionAdvisor.js?v=20261107-0060';
export const supportsAcquisitionAdvice=difficulty=>['fresh','pro'].includes(difficulty);
export const PROFILES = Object.freeze({...fresh.PROFILES,...pro.PROFILES});
export function createAdvisorObservation(state,candidates,options={}){
    const observation=fresh.createAdvisorObservation(state,candidates,options);
    observation.rankTable=(options.rankTable||[]).map(row=>({grade:row.grade,thresholds:{...row.thresholds},scores:{...row.scores},
            withdrawalThreshold:row.withdrawalThreshold,enrollmentDiffThreshold:row.enrollmentDiffThreshold,rankThreshold:row.rankThreshold}));
    if(state.difficulty==='pro'){
        observation.offerHistory=(state.playRecord?.events||[]).filter(e=>['offer','refresh'].includes(e.type)).map(e=>({type:e.type,turn:e.turn,rarity:e.rarity,cards:(e.cards||[]).map(c=>({cardNo:c.cardNo,cardName:c.cardName,rarity:c.rarity}))}));
        const first=observation.offerHistory[0];
        observation.offerHistoryComplete=!!first&&first.type==='offer'&&first.turn===0&&first.rarity==='R'&&first.cards.length===4&&!state.playRecord?.truncated;
        observation.refreshRemaining=Number(state.trainingRefreshRemaining||0);
        observation.refreshes=(state.playRecord?.events||[]).filter(e=>e.type==='refresh').map(e=>({rarity:e.rarity,cards:(e.cards||[]).map(c=>({cardNo:c.cardNo,cardName:c.cardName,rarity:c.rarity,effect:c.effect||''}))}));
    }
    return observation;
}
export function recommendAcquisition(observation,options={}){
    return observation.difficulty==='pro'?pro.recommendAcquisition(observation,options):fresh.recommendAcquisition(observation,options);
}
