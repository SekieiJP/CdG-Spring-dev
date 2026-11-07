import {projectAhiruState,AHIRU_AXES} from './ahiruForecast.js?v=20260815-0059';
export const PRO_ADVICE_AXES=AHIRU_AXES;
const WEIGHTS=Object.freeze({experience:2.7,enrollment:4.2,satisfaction:2.5,accounting:3.4,engine:8,risk:.8,future:.8,route:24,draw:12,inspiration:8});
export function projectProAdviceState(input,options={}) {
    return projectAhiruState(input,options,{difficulty:'pro',weights:WEIGHTS});
}
