import {projectProDeck} from './proAcquisitionAdvisor.js?v=20261107-0061';
/** 公開デッキの固定式投影。時期の補正は開発データ由来で、検証を終えるまでは暫定。 */
export const AHIRU_AXES=Object.freeze(['experience','enrollment','satisfaction','accounting']);
const TOKENS=['passion','fatigue','inspiration','organize'];
const card=c=>({cardNo:c.cardNo,cardName:c.cardName,category:c.category,rarity:c.rarity,effect:c.effect||'',acquiredTurn:c.acquiredTurn||0});
function clampStats(stats){const out=Object.fromEntries(AHIRU_AXES.map(k=>[k,Math.max(0,stats[k])]));out.enrollment=Math.min(out.enrollment,out.experience);return out;}
export function projectAhiruState(input,{phase='acquisition',selectedIndices=[],deleteMax=0,calibration=null,versions=null}={}, {difficulty,weights}){
    if(input?.difficulty!==difficulty||!['acquisition','deletion'].includes(phase))return null;
    if(!Number.isInteger(input.turn)||input.turn<0||input.turn>7||input.totalTurns!==8||AHIRU_AXES.some(k=>!Number.isFinite(input.stats?.[k])||input.stats[k]<0)||TOKENS.some(k=>!Number.isInteger(input.tokens?.[k]||0)||(input.tokens[k]||0)<0))throw Error('公開状態が不正');
    const observation={difficulty,mode:input.mode,turn:input.turn+(phase==='deletion'?1:0),totalTurns:8,stats:Object.fromEntries(AHIRU_AXES.map(k=>[k,input.stats[k]])),tokens:Object.fromEntries(TOKENS.map(k=>[k,phase==='deletion'&&k==='organize'?0:input.tokens[k]||0])),owned:input.owned.map(card),candidates:(input.candidates||[]).map(card),pickCount:input.pickCount,allowSkip:input.allowSkip,turns:input.turns.map(t=>({recommended:t.recommended,recommendedStatus:t.recommendedStatus,training:t.training,deletion:t.deletion}))};
    const pool=phase==='deletion'?observation.owned:observation.candidates;
    if(!Array.isArray(selectedIndices)||new Set(selectedIndices).size!==selectedIndices.length||selectedIndices.some(i=>!Number.isInteger(i)||i<0||i>=pool.length))throw Error('選択番号が不正');
    let position='before';
    if(phase==='deletion'){
        if(!Number.isInteger(deleteMax)||deleteMax<0||selectedIndices.length>deleteMax)throw Error('削除枠を超える選択');
        const removed=new Set(selectedIndices);observation.owned=observation.owned.filter((_,i)=>!removed.has(i));if(selectedIndices.length)position='after';
    }else{
        if(![1,2].includes(observation.pickCount)||selectedIndices.length>observation.pickCount)throw Error('取得枚数が不正');
        if(observation.allowSkip)position='after';
        if(selectedIndices.length===observation.pickCount){observation.owned.push(...selectedIndices.map(i=>({...observation.candidates[i],acquiredTurn:input.turn})));position='after';}
    }
    const remaining=Math.max(0,8-observation.turn);
    let raw;
    if(!remaining)raw={end:{...observation.stats},draw:0,engine:0,risk:0,outputs:[]};
    else{const first=projectProDeck(observation,{weights,cards:observation.owned});raw=projectProDeck(observation,{weights,cards:observation.owned,forecast:first.end});}
    let correction=null,correctionSource=null;
    const compatible=remaining>0&&input.mode==='normal'&&calibration?.schema===1&&calibration.difficulty===difficulty&&calibration.axes?.join('|')===AHIRU_AXES.join('|')&&versions?.cardVersion===calibration.cardVersion&&versions?.rankVersion===calibration.rankVersion;
    if(compatible){
        correction=calibration.phases?.[phase]?.[position]?.[input.turn];correctionSource=phase;
        if(!correction&&phase==='deletion'){correction=calibration.phases?.acquisition?.before?.[observation.turn];correctionSource='next-acquisition-before';}
        const valid=correction?.games>=250&&observation.owned.length>=correction.ownedMin&&observation.owned.length<=correction.ownedMax&&['median','lower','upper'].every(k=>correction[k]?.length===4&&correction[k].every(Number.isFinite));
        if(!valid){correction=null;correctionSource=null;}
    }
    const corrected=key=>clampStats(Object.fromEntries(AHIRU_AXES.map((axis,i)=>[axis,raw.end[axis]+(correction?correction[key][i]:0)])));
    return {observation,remaining,position,rawEnd:{...raw.end},expectedEnd:corrected('median'),lowerEnd:corrected('lower'),upperEnd:corrected('upper'),draw:raw.draw,engine:raw.engine,risk:raw.risk,calibrated:!!correction,correctionSource};
}
