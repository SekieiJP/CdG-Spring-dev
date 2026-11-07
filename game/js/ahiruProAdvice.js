import {proGoal,withdrawal} from './proAcquisitionAdvisor.js?v=20261107-0060';
import {projectProAdviceState} from './ahiruProForecast.js?v=20261107-0060';
import {getProSGoals} from './ahiruProGoals.js?v=20261107-0060';
import {createAhiruStatusPolicy} from './ahiruStatusPolicy.js?v=20261107-0060';
export const PRO_STATUS_WEIGHTS=Object.freeze({experience:2.7,enrollment:4.2,satisfaction:2.5,accounting:3.4});
export const recommendProStatus=createAhiruStatusPolicy({
    difficulty:'pro',weights:PRO_STATUS_WEIGHTS,getGoals:getProSGoals,projectState:projectProAdviceState,
    scoreState(stats,input){
        const value=proGoal(stats,input.rankTable);
        if(input.mode!=='event')return value;
        const extra=Math.max(0,stats.experience-50)/10+Math.max(0,stats.enrollment-withdrawal(stats)-48)/8+Math.max(0,stats.satisfaction-35)/10;
        return {...value,points:Math.round((value.points+extra)*10)/10,smoothPoints:value.smoothPoints+extra};
    }
});
