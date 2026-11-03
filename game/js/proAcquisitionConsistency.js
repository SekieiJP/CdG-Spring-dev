import {recommendProStatus,PRO_STATUS_WEIGHTS} from './ahiruProAdvice.js?v=20260815-0056';
import {projectProAdviceState} from './ahiruProForecast.js?v=20260815-0056';
import {getProSGoals} from './ahiruProGoals.js?v=20260815-0056';
import {createAhiruRoleInspector} from './ahiruCardRoles.js?v=20260815-0056';

const AXES=['experience','enrollment','satisfaction','accounting'];
const LABELS={experience:'体験',enrollment:'入塾',satisfaction:'満足',accounting:'経理'};
const EPSILON=1e-8;
const routeDistance=(stats,goals)=>Math.min(...goals.routes.map(route=>AXES.reduce((sum,axis)=>sum+PRO_STATUS_WEIGHTS[axis]*Math.max(0,route[axis]-stats[axis]),0)));

/** S+を伸ばす取得式に、あひる先生と同じS不足の確認を加える。将来試行はしない。 */
export function alignProAcquisition(observation,advice,options={}){
    if(observation.difficulty!=='pro'||observation.mode!=='normal'||!advice?.evaluations?.length)return advice;
    const sharedOptions={phase:'acquisition',selectedIndices:[],calibration:options.calibration,versions:options.versions};
    const status=recommendProStatus(observation,sharedOptions);
    if(!status)return advice;
    const axis=status.tone==='red'?status.axis:status.reason==='surplus-redirect-acquisition'?status.growthAxis:null;
    const metadata={statusTone:status.tone,statusAxis:status.axis,focusAxis:axis,reason:status.reason,availableComplement:false,changedRecommendation:false};
    if(!axis)return {...advice,version:'pro-formula-v2-aligned',alignment:metadata};
    const before=status.forecast,goals=getProSGoals(observation.rankTable),distance=routeDistance(before.expectedEnd,goals);
    const safety=['satisfaction','accounting'].includes(axis);
    const beforeInspector=createAhiruRoleInspector(before.observation,before.expectedEnd);
    const needsRole=safety&&before.rawEnd[axis]<goals.sThresholds[axis]&&!before.observation.owned.some(card=>beforeInspector.canRecover(card,axis,goals.sThresholds[axis]));
    const evaluations=advice.evaluations.map(evaluation=>{
        const after=projectProAdviceState(observation,{...sharedOptions,selectedIndices:evaluation.indices});
        const gain=after.expectedEnd[axis]-before.expectedEnd[axis];
        const inspector=needsRole?createAhiruRoleInspector(after.observation,after.expectedEnd):null;
        const addsRole=needsRole&&evaluation.indices.some(index=>inspector.canRecover(observation.candidates[index],axis,goals.sThresholds[axis]));
        // 不足を補い、全S経路への距離も広げない選択肢だけを優先する。
        const complements=(gain>EPSILON||addsRole)&&routeDistance(after.expectedEnd,goals)<=distance+EPSILON;
        return {...evaluation,alignment:{axis,gain,addsRole:!!addsRole,complements}};
    });
    metadata.availableComplement=evaluations.some(evaluation=>evaluation.alignment.complements);
    // 同じ優先群の中では、調整済みS+取得式の順位を維持する。
    evaluations.sort((a,b)=>Number(b.alignment.complements)-Number(a.alignment.complements));
    const recommended=evaluations[0];
    metadata.changedRecommendation=JSON.stringify(recommended.indices)!==JSON.stringify(advice.recommended.indices);
    if(metadata.changedRecommendation)recommended.reasons=[`${LABELS[axis]}の不足を補う`,...recommended.reasons].slice(0,2);
    return {...advice,version:'pro-formula-v2-aligned',recommended,evaluations,alignment:metadata};
}
