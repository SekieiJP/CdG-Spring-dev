import {proGoal,withdrawal} from './proAcquisitionAdvisor.js?v=20260815-0055';
import {projectProAdviceState,PRO_ADVICE_AXES} from './ahiruProForecast.js?v=20260815-0055';
import {getProSGoals} from './ahiruProGoals.js?v=20260815-0055';
import {createAhiruRoleInspector} from './ahiruCardRoles.js?v=20260815-0055';
/** PROの公開パラメータとデッキの見込みから、1つの短い方針を返す。操作はしない。 */
const LABELS={experience:'体験',enrollment:'入塾',satisfaction:'満足',accounting:'経理'},WEIGHTS={experience:2.7,enrollment:4.2,satisfaction:2.5,accounting:3.4},SAFETY=['satisfaction','accounting'];
function result(tone,text,axis,reason,forecast,extra={}){
    if(Array.from(text).length>25)throw Error('あひる先生のセリフが25文字を超えています');
    return {tone,text,axis,reason,forecast,...extra};
}
function closestRoute(goals,stats){
    return [...goals.routes].sort((a,b)=>PRO_ADVICE_AXES.reduce((s,k)=>s+WEIGHTS[k]*(Math.max(0,a[k]-stats[k])-Math.max(0,b[k]-stats[k])),0))[0];
}
export function recommendProStatus(input,options={}){
    if(input?.difficulty!=='pro')return null;
    const goals=getProSGoals(input.rankTable);if(!goals?.routes.length)return null;
    const phase=options.phase||'acquisition',forecast=projectProAdviceState(input,options);if(!forecast)return null;
    // イベントでは公式の上限超過加点を含める。将来のイベント発動は投影しない。
    const score=stats=>{
        const value=proGoal(stats,input.rankTable);
        if(input.mode!=='event')return value;
        const extra=Math.max(0,stats.experience-50)/10+Math.max(0,stats.enrollment-withdrawal(stats)-48)/8+Math.max(0,stats.satisfaction-35)/10;
        return {...value,points:Math.round((value.points+extra)*10)/10,smoothPoints:value.smoothPoints+extra};
    },root=forecast.observation,estimated=forecast.expectedEnd,roles=createAhiruRoleInspector(root,estimated),current=score(estimated),selected=options.selectedIndices||[];
    const canRecover=(axis,f=forecast)=>{const inspector=f===forecast?roles:createAhiruRoleInspector(f.observation,f.expectedEnd);return f.observation.owned.some(c=>inspector.canRecover(c,axis,goals.sThresholds[axis]));};
    const structuralMissing=f=>SAFETY.find(k=>f.rawEnd[k]<goals.sThresholds[k]&&!canRecover(k,f));
    if(!forecast.remaining){
        return current.points>=goals.targetPoints?result('green','順調だよ。このまま結果を見よう',null,'final-score-ready',forecast):result('red','今回はSまであと一歩だよ',null,'final-score-below-s',forecast);
    }
    let axis=structuralMissing(forecast);
    if(!axis){const deficits=SAFETY.filter(k=>estimated[k]<goals.sThresholds[k]).sort((a,b)=>(goals.sThresholds[b]-estimated[b])-(goals.sThresholds[a]-estimated[a]));axis=deficits[0];}
    if(!axis&&current.points<goals.targetPoints){const route=closestRoute(goals,estimated);axis=estimated.enrollment>=estimated.experience-1e-8&&route.enrollment>estimated.enrollment?'experience':PRO_ADVICE_AXES.filter(k=>estimated[k]<route[k]).sort((a,b)=>WEIGHTS[b]*(route[b]-estimated[b])-WEIGHTS[a]*(route[a]-estimated[a]))[0];}
    if(axis){
        const safety=SAFETY.includes(axis),label=LABELS[axis],route=closestRoute(goals,estimated),needsHigherMilestone=estimated[axis]>=goals.sThresholds[axis]&&current.points<goals.targetPoints&&!structuralMissing(forecast);
        if(needsHigherMilestone)return result('red',phase==='deletion'?`Sには${label}${route[axis]}へ。伸ばす札は残そう`:`Sには${label}${route[axis]}へ。伸ばせる札を取ろう`,axis,'next-score-milestone',forecast);
        if(phase==='deletion')return result('red',safety?`${label}が心配。回復札は残そう`:`${label}が不足気味。伸ばせる札は残そう`,axis,'shortage-keep-role',forecast);
        const handPressure=root.owned.length+(input.pickCount||1)>forecast.draw+1;
        const engine=!safety&&input.turn<=2&&forecast.remaining>=5&&handPressure&&(input.candidates||[]).some(c=>roles.supportsHand(c));
        const text=engine?`${label}が不足気味。手数を増やす札も狙おう`:safety?`${label}が不足気味。回復札を取ろう`:`${label}が不足気味。伸ばせる札を取ろう`;
        return result('red',text,axis,engine?'shortage-build-engine':'shortage-acquire-role',forecast);
    }
    function growthAxis(){
        const before=score(estimated).smoothPoints;
        return ['experience','enrollment','satisfaction'].map(axis=>{const next={...estimated,[axis]:estimated[axis]+1};next.enrollment=Math.min(next.enrollment,next.experience);return {axis,gain:score(next).smoothPoints-before};}).filter(r=>r.gain>1e-8).sort((a,b)=>b.gain-a.gain)[0]?.axis||null;
    }
    const grow=growthAxis(),surplus=PRO_ADVICE_AXES.filter(k=>(input.mode!=='event'||k==='accounting')&&forecast.lowerEnd[k]>goals.caps[k]+(k==='accounting'?2:0)).sort((a,b)=>(forecast.lowerEnd[b]-goals.caps[b])/Math.max(1,goals.caps[b])-(forecast.lowerEnd[a]-goals.caps[a])/Math.max(1,goals.caps[a]));
    if(phase==='deletion'&&selected.length){
        const before=projectProAdviceState(input,{...options,selectedIndices:[]}),a=score(forecast.rawEnd),b=score(before.rawEnd);
        if(a.points<b.points||a.smoothPoints<b.smoothPoints-1e-8){
            const loss=PRO_ADVICE_AXES.filter(k=>before.rawEnd[k]>forecast.rawEnd[k]).sort((a,b)=>WEIGHTS[b]*(before.rawEnd[b]-forecast.rawEnd[b])-WEIGHTS[a]*(before.rawEnd[a]-forecast.rawEnd[a]))[0];
            return result('yellow',`${LABELS[loss]||'得点'}が減りそう。その札は残そう`,loss||null,'selected-deletion-loss',forecast);
        }
        return result('green','順調だよ。その選択で進めそう',null,'selected-deletion-acceptable',forecast);
    }
    if(phase==='deletion'&&options.deleteMax>0&&surplus.length){
        const candidates=[],seen=new Set();
        for(const k of surplus)for(let i=0;i<root.owned.length&&candidates.length<3;i++)if(!seen.has(i)&&roles.canRecover(root.owned[i],k,goals.sThresholds[k]||goals.caps[k])){seen.add(i);candidates.push({axis:k,index:i});}
        for(const candidate of candidates){
            const after=projectProAdviceState(input,{...options,selectedIndices:[candidate.index]}),a=score(after.rawEnd),b=score(forecast.rawEnd);
            if(score(after.expectedEnd).points<goals.targetPoints||a.points<b.points||a.smoothPoints<b.smoothPoints-1e-8||SAFETY.some(k=>after.lowerEnd[k]<goals.sThresholds[k])||structuralMissing(after))continue;
            return result('yellow',`${LABELS[candidate.axis]}は十分。${LABELS[candidate.axis]}役を減らせそう`,candidate.axis,'surplus-safe-removal',forecast,{exampleCardNo:String(root.owned[candidate.index].cardNo)});
        }
    }
    if(phase==='acquisition'&&surplus.length&&grow){const extra=surplus[0];return result('yellow',`${LABELS[extra]}は十分。${LABELS[grow]}の札を狙おう`,extra,'surplus-redirect-acquisition',forecast);}
    if(phase==='deletion')return result('green','順調だよ。必要な札は残そう',null,'on-track-keep-options',forecast);
    return result('green',grow?`順調だよ。${LABELS[grow]}を伸ばそう`:'順調だよ。今の強みを大切にしよう',grow,'on-track-grow',forecast);
}
