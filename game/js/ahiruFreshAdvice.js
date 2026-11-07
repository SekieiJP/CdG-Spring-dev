import {createAhiruStatusPolicy} from './ahiruStatusPolicy.js?v=20261107-0060';
import {getFreshSGoals,freshAdviceScore} from './ahiruFreshGoals.js?v=20261107-0060';
import {projectFreshAdviceState} from './ahiruFreshForecast.js?v=20261107-0060';
const weights={experience:2.8,enrollment:3.5,satisfaction:1.9,accounting:2.1};
export const recommendFreshStatus=createAhiruStatusPolicy({
    difficulty:'fresh',weights,getGoals:getFreshSGoals,projectState:projectFreshAdviceState,scoreState:freshAdviceScore,
    growthAxes:['experience','enrollment'],surplusAllowed:(axis,input)=>input.mode!=='event'||['satisfaction','accounting'].includes(axis),
    safetyThresholds(goals,stats){
        return [...goals.routes].sort((a,b)=>Object.keys(weights).reduce((sum,axis)=>sum+weights[axis]*(Math.max(0,a[axis]-stats[axis])-Math.max(0,b[axis]-stats[axis])),0))[0];
    }
});
