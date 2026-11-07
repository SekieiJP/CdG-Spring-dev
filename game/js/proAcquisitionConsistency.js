import {recommendProStatus} from './ahiruProAdvice.js?v=20260815-0060';
const LABELS={experience:'体験',enrollment:'入塾',satisfaction:'満足',accounting:'経理'};

/** 文面と同じ、提示時に確定した判断を強調表示にも使う。 */
export function alignAcquisitionWithStatus(advice,status){
    if(!advice?.evaluations?.length||!status)return advice;
    const key=indices=>indices.join(','),preferred=key(status.preferredIndices||[]);
    const metadata={statusTone:status.tone,statusAxis:status.axis,focusAxis:status.focusAxis,reason:status.reason,
        availableComplement:!!status.availableComplement,changedRecommendation:key(advice.recommended.indices)!==preferred};
    const evaluations=advice.evaluations.map(evaluation=>{
        const row=status.alternatives?.find(r=>key(r.indices)===key(evaluation.indices));
        return {...evaluation,alignment:{axis:status.focusAxis,gain:row?.gains?.[status.focusAxis]||0,complements:!!row?.complements}};
    });
    evaluations.sort((a,b)=>Number(key(b.indices)===preferred)-Number(key(a.indices)===preferred)||Number(b.alignment.complements)-Number(a.alignment.complements));
    const recommended=evaluations[0];
    if(metadata.changedRecommendation&&status.availableComplement)recommended.reasons=[`${LABELS[status.focusAxis]}の不足を補う`,...recommended.reasons].slice(0,2);
    return {...advice,version:advice.targetRank==='S+'?'pro-formula-v3-context':'fresh-formula-v2-context',recommended,evaluations,alignment:metadata};
}
/** 解析ツールからの既存の入口。ゲーム本体は提示時のstatusを一度だけ共有する。 */
export function alignProAcquisition(observation,advice,options={}){
    if(observation.difficulty!=='pro'||observation.mode!=='normal'||!advice?.evaluations?.length)return advice;
    return alignAcquisitionWithStatus(advice,recommendProStatus(observation,{...options,phase:'acquisition',acquisitionAdvice:advice}));
}
