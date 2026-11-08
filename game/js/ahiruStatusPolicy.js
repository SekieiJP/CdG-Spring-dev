import {createAhiruRoleInspector} from './ahiruCardRoles.js?v=20261107-0063';
import {acquisitionAlternatives,evaluateDeletions,evaluateRefresh} from './ahiruActionEvaluation.js?v=20261107-0063';
const AXES=['experience','enrollment','satisfaction','accounting'];
const LABELS={experience:'体験',enrollment:'入塾',satisfaction:'満足',accounting:'経理'},SAFETY=['satisfaction','accounting'];
const EPSILON=1e-8;
function result(tone,text,axis,reason,forecast,extra={}){
    if(Array.from(text).length>25)throw Error('あひる先生のセリフが25文字を超えています');
    return {tone,text,axis,reason,forecast,...extra};
}
function chooseRoute(goals,stats,weights){
    return [...goals.routes].sort((a,b)=>AXES.reduce((s,k)=>s+weights[k]*(Math.max(0,a[k]-stats[k])-Math.max(0,b[k]-stats[k])),0))[0];
}
export function createAhiruStatusPolicy({difficulty,weights,getGoals,projectState,scoreState,safetyThresholds=goals=>goals.sThresholds,growthAxes=['experience','enrollment','satisfaction']}) {
    return function recommendStatus(input,options={}){
        if(input?.difficulty!==difficulty)return null;
        const goals=getGoals(input.rankTable);if(!goals?.routes.length)return null;
        // 選択途中の仮デッキは助言の入力にしない。反実仮想は内部の比較だけで使う。
        options={...options,selectedIndices:[]};
        const phase=options.phase||'acquisition',forecast=projectState(input,options);if(!forecast)return null;
        const score=stats=>scoreState(stats,input),root=forecast.observation,estimated=forecast.expectedEnd;
        const roles=createAhiruRoleInspector(root,estimated),model={weights,goals,projectState,score};
        const safetyTargets=safetyThresholds(goals,estimated,weights);
        const structuralMissing=SAFETY.find(k=>forecast.rawEnd[k]<safetyTargets[k]&&!root.owned.some(c=>roles.canRecover(c,k,safetyTargets[k])));
        const current=score(estimated),route=chooseRoute(goals,estimated,weights);
        if(!forecast.remaining)return result(current.points>=goals.targetPoints?'green':'red','このまま次に進もう',null,current.points>=goals.targetPoints?'final-score-ready':'final-score-below-s',forecast);
        let axis=structuralMissing||SAFETY.filter(k=>estimated[k]<safetyTargets[k]).sort((a,b)=>(safetyTargets[b]-estimated[b])-(safetyTargets[a]-estimated[a]))[0];
        if(!axis&&current.points<goals.targetPoints)axis=estimated.enrollment>=estimated.experience-EPSILON&&route.enrollment>estimated.enrollment?'experience':AXES.filter(k=>estimated[k]<route[k]).sort((a,b)=>weights[b]*(route[b]-estimated[b])-weights[a]*(route[a]-estimated[a]))[0];
        const initial=phase==='acquisition'&&input.turn===0&&input.stats.experience===0;
        let tone=axis?'red':'green',reason=axis?'shortage':'on-track-grow';
        if(root.mode==='normal'&&axis&&score(root.stats).points>=goals.targetPoints){tone='yellow';reason='current-s-protect';}
        if(initial){axis='experience';tone='yellow';reason='initial-experience-foundation';}
        function growthAxis(){
            const before=score(estimated).smoothPoints;
            return growthAxes.map(axis=>{const next={...estimated,[axis]:estimated[axis]+1};next.enrollment=Math.min(next.enrollment,next.experience);return {axis,gain:score(next).smoothPoints-before};}).filter(r=>r.gain>EPSILON).sort((a,b)=>b.gain-a.gain)[0]?.axis||null;
        }
        if(phase==='deletion'){
            const deletion=evaluateDeletions(input,options,model,forecast),indices=deletion.best.indices;
            if(!indices.length)return result(tone,'このまま次に進もう',axis,'deletion-keep',forecast,{deletion,outlookReason:reason});
            const counts=new Map();for(const i of indices){const category=input.owned[i].category;counts.set(category,(counts.get(category)||0)+1);}
            const entries=[...counts],count=indices.length;
            let text=entries.length===1?`${entries[0][0]}を${count}枚減らしてデッキを整えよう`:entries.map(([category,n])=>`${category}${n}枚`).join('・')+'を減らそう';
            if(Array.from(text).length>25)text=entries.map(([category,n])=>`${category}${n}`).join('・')+'枚を減らそう';
            return result(tone==='green'?'yellow':tone,text,axis,'deletion-improves-outlook',forecast,{deletion,outlookReason:reason});
        }
        const focusAxis=axis||growthAxis(),distance=stats=>Math.min(...goals.routes.map(r=>AXES.reduce((sum,k)=>sum+weights[k]*Math.max(0,r[k]-stats[k]),0)));
        const alternatives=acquisitionAlternatives(input,options,model,forecast);
        for(const row of alternatives){
            const inspector=createAhiruRoleInspector(row.forecast.observation,row.forecast.expectedEnd);
            row.complements=!!focusAxis&&row.indices.some(i=>inspector.canRecover(input.candidates[i],focusAxis,safetyTargets[focusAxis]||goals.sThresholds[focusAxis]))&&
                (row.gains[focusAxis]>EPSILON||structuralMissing===focusAxis||(initial&&row.gains[focusAxis]>=-EPSILON))&&distance(row.forecast.expectedEnd)<=distance(estimated)+EPSILON;
        }
        const preferred=alternatives.find(row=>row.complements)||alternatives[0];
        const extra={outlookReason:reason,focusAxis,availableComplement:alternatives.some(row=>row.complements),preferredIndices:preferred?.indices||[],alternatives};
        if(!preferred)return result(tone,'使えるカードを選んで進もう',axis,reason,forecast,extra);
        const refresh=evaluateRefresh(input,options,model,forecast,alternatives);extra.refresh=refresh;
        if(refresh?.available)return result(tone,'リフレッシュで候補を替える手もある',axis,'refresh-option',forecast,extra);
        if(preferred.skip||!preferred.indices.length)return result(tone,'今回は取得せずに進もう',axis,'inspiration-skip',forecast,extra);
        const inspector=createAhiruRoleInspector(preferred.forecast.observation,preferred.forecast.expectedEnd);
        const usable=k=>preferred.indices.some(i=>inspector.canRecover(input.candidates[i],k,safetyTargets[k]||goals.sThresholds[k]));
        let actionAxis=preferred.complements?focusAxis:AXES.filter(k=>preferred.gains[k]>EPSILON&&usable(k)&&(!initial||k!=='enrollment')).sort((a,b)=>weights[b]*preferred.gains[b]-weights[a]*preferred.gains[a])[0];
        extra.actionAxis=actionAxis||null;
        if(initial&&actionAxis==='experience')return result('yellow','まず体験。補うカードを手に入れよう','experience',reason,forecast,extra);
        if(actionAxis){
            const text=actionAxis===axis&&tone==='red'?`${LABELS[actionAxis]}が心配。補うカードを手に入れよう`:`今は${LABELS[actionAxis]}を伸ばすカードを選ぼう`;
            return result(tone,text,axis||actionAxis,preferred.complements?'available-complement':'available-alternative',forecast,extra);
        }
        if(preferred.indices.some(i=>inspector.supportsHand(input.candidates[i])))return result(tone,'手数を増やすカードを手に入れよう',axis,'available-hand-support',forecast,extra);
        // 現在所持する発想だけを数える。今回の行動で生む発想は最終研修に間に合わない。
        if(input.tokens.inspiration>(input.allowSkip?1:0))return result(tone,'取得を決めて発想の追加候補を見よう',axis,'available-inspiration',forecast,extra);
        return result(tone,initial?'序盤を支えるカードを手に入れよう':'今の強みを活かすカードを選ぼう',axis,'available-choice',forecast,extra);
    };
}
