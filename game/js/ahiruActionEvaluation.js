import {projectProDeck,clamp} from './proAcquisitionAdvisor.js?v=20260815-0058';
import {createAhiruRoleInspector} from './ahiruCardRoles.js?v=20260815-0058';

export const ACTION_MODEL_VERSION='public-opportunities-v1';
const AXES=['experience','enrollment','satisfaction','accounting'];
const choose=(n,k)=>{if(k<0||n<k)return 0;let v=1;for(let i=1;i<=k;i++)v=v*(n-i+1)/i;return v;};
export function combinations(n,k,start=0,prefix=[]){
    if(!k)return [prefix];const rows=[];
    for(let i=start;i<=n-k;i++)rows.push(...combinations(n,k-1,i+1,[...prefix,i]));
    return rows;
}
export function expectedBest(values,count=3){
    if(!values.length||count<1)return null;
    const rows=[...values].sort((a,b)=>a-b),k=Math.min(count,rows.length),denominator=choose(rows.length,k);
    return denominator?rows.reduce((sum,value,i)=>sum+value*choose(i,k-1)/denominator,0):null;
}
export function stateValue(stats,{score,weights,goals}){
    const distance=Math.min(...goals.routes.map(route=>AXES.reduce((sum,k)=>sum+weights[k]*Math.max(0,route[k]-stats[k]),0)));
    return score(stats).smoothPoints*10-distance*.12+AXES.reduce((sum,k)=>sum+weights[k]*Math.min(stats[k],goals.caps[k])*.025,0);
}
export function acquisitionAlternatives(input,options,model,before){
    const choices=options.acquisitionAdvice?.evaluations||[
        ...combinations(input.candidates.length,Math.min(input.pickCount,input.candidates.length)).map(indices=>({indices})),
        ...(input.allowSkip?[{indices:[],skip:true}]:[])
    ];
    const rows=choices.map(choice=>{
        const forecast=model.projectState(input,{...options,selectedIndices:choice.indices});
        return {...choice,forecast,gains:Object.fromEntries(AXES.map(k=>[k,forecast.rawEnd[k]-before.rawEnd[k]])),
            value:stateValue(forecast.expectedEnd,model)};
    });
    return options.acquisitionAdvice?rows:rows.sort((a,b)=>b.value-a.value||a.indices.join(',').localeCompare(b.indices.join(',')));
}

/** 将来の通常取得の機会だけを近似する。未取得札を現在の供給役には数えない。 */
function futureOpportunities(input,before,model,catalog){
    const plans=[];
    for(let turn=before.observation.turn;turn<input.totalTurns;turn++){
        const rarity=input.turns[turn]?.training,pool=catalog.filter(c=>c.rarity===rarity);
        if(!pool.length)continue;
        const observation={...before.observation,turn,owned:pool};
        const outputs=projectProDeck(observation,{cards:pool,weights:{...model.weights,future:.65},forecast:before.rawEnd}).outputs;
        const sorted=outputs.map((out,i)=>({out,card:pool[i]})).sort((a,b)=>a.out.value-b.out.value),k=Math.min(3,sorted.length),denominator=choose(sorted.length,k);
        const delta=Object.fromEntries(AXES.map(axis=>[axis,0]));let hand=0,parallel=0;
        sorted.forEach(({out},i)=>{
            const probability=choose(i,k-1)/denominator;
            for(const axis of AXES)delta[axis]+=out.delta[axis]*probability;
            // 固定値は使用可能期間に一度の上積みとして扱い、毎ターン加算しない。
            for(const set of out.sets)delta[set.status]+=Math.max(0,set.value-before.rawEnd[set.status])*set.chance*probability/Math.max(1,input.totalTurns-turn);
            hand+=(out.tokens.passion-out.tokens.fatigue)*probability;parallel+=Number(out.parallel)*probability;
        });
        plans.push({turn,delta,hand,parallel});
    }
    return plans;
}
function endWithOpportunities(forecast,plans){
    const o=forecast.observation,n=o.owned.length,r=forecast.remaining,end={...o.stats};
    if(!r)return end;
    for(let turn=o.turn;turn<o.totalTurns;turn++){
        const future=plans.filter(plan=>plan.turn<=turn),size=n+future.length;
        const draw=clamp(forecast.draw+future.reduce((sum,p)=>sum+p.hand,0)*.4,0,size);
        const seen=clamp(draw/Math.max(1,size)),beforeSeen=clamp(forecast.draw/Math.max(1,n));
        const retention=beforeSeen?Math.min(1,seen/beforeSeen):0;
        for(const axis of AXES){
            end[axis]+=(forecast.rawEnd[axis]-o.stats[axis])/r*retention;
            // 公開プールからの最良3択平均は、発動・配置競合の不確実性を割り引く。
            end[axis]+=future.reduce((sum,p)=>sum+p.delta[axis]*seen*(p.parallel+(1-p.parallel)*Math.min(1,3/Math.max(1,draw)))*.65,0);
        }
    }
    for(const k of AXES)end[k]=Math.max(0,end[k]);end.enrollment=Math.min(end.enrollment,end.experience);
    return end;
}
/** 全単札と幅3の組合せ探索。最大512案の固定式比較で、実ゲームの試行はしない。 */
export function evaluateDeletions(input,options,model,before){
    const plans=futureOpportunities(input,before,model,options.catalog||[]),max=Math.min(options.deleteMax||0,input.owned.length),seen=new Set();
    const inspector=createAhiruRoleInspector(before.observation,before.rawEnd);
    const providers=Object.fromEntries(['satisfaction','accounting'].map(axis=>[axis,input.owned.flatMap((card,i)=>inspector.canRecover(card,axis,model.goals.sThresholds[axis])?[i]:[])]));
    const evaluate=indices=>{
        const forecast=indices.length?model.projectState(input,{...options,selectedIndices:indices}):before;
        const end=endWithOpportunities(forecast,plans);
        const lostSafetyRoles=Object.keys(providers).filter(axis=>providers[axis].length&&providers[axis].every(i=>indices.includes(i))&&forecast.rawEnd[axis]<model.goals.sThresholds[axis]);
        // 未取得の平均像だけを当てにして、必要な最後の供給役を失う案は割り引く。
        const uncertaintyCost=lostSafetyRoles.reduce((sum,axis)=>sum+.5*model.weights[axis]*(model.goals.sThresholds[axis]-forecast.rawEnd[axis]),0);
        return {indices,value:stateValue(end,model)-uncertaintyCost,end,forecast,lostSafetyRoles,uncertaintyCost};
    };
    const keep=evaluate([]);let best=keep,beam=[keep],checked=1,truncated=false;
    for(let depth=1;depth<=max;depth++){
        const next=[];
        for(const row of beam)for(let i=0;i<input.owned.length;i++){
            if(row.indices.includes(i))continue;
            const indices=[...row.indices,i].sort((a,b)=>a-b),key=indices.join(',');if(seen.has(key))continue;seen.add(key);
            if(checked>=512){truncated=true;break;}
            const candidate=evaluate(indices);checked++;next.push(candidate);
            if(candidate.value>best.value+.05)best=candidate;
        }
        if(!next.length||truncated)break;
        next.sort((a,b)=>b.value-a.value||a.indices.join(',').localeCompare(b.indices.join(',')));beam=next.slice(0,3);
    }
    // 小さな数式誤差を削除利益と呼ばず、同等なら保持する。
    if(best.value-keep.value<.2)best=keep;
    return {model:ACTION_MODEL_VERSION,best,keep,checked,truncated,futureAcquisitions:plans.length};
}

/** 公開された提示・除外履歴から残数だけを復元する。シャッフル順や実山札を読まない。 */
export function publicRefreshPool(catalog,history,rarity,currentCards){
    const last=history?.at(-1),signature=cards=>cards.map(c=>c.cardName).sort().join('|');
    if(!history?.length||last.type!=='offer'||last.rarity!==rarity||signature(last.cards||[])!==signature(currentCards))return null;
    const definitions=catalog.filter(c=>c.rarity===rarity),names=new Map(definitions.map(c=>[c.cardName,c]));
    if(names.size!==definitions.length||!names.size)return null;
    let deck=new Map(definitions.map(c=>[c.cardName,2])),discard=new Map(definitions.map(c=>[c.cardName,0]));
    const total=map=>[...map.values()].reduce((a,b)=>a+b,0);
    for(const event of history.filter(e=>e.rarity===rarity)){
        for(const card of event.cards||[]){
            const name=card.cardName;if(!names.has(name))return null;
            if(event.type==='offer'){
                if(!total(deck)){deck=new Map(discard);discard=new Map(definitions.map(c=>[c.cardName,0]));}
                if(!(deck.get(name)>0))return null;
                deck.set(name,deck.get(name)-1);discard.set(name,discard.get(name)+1);
            }else if(event.type==='refresh'){
                if(!(discard.get(name)>0))return null;
                discard.set(name,discard.get(name)-1);
            }
        }
    }
    for(const card of currentCards){const name=card.cardName;if(!(discard.get(name)>0))return null;discard.set(name,discard.get(name)-1);}
    if(!total(deck))deck=discard;
    // バッチ途中の再構成・同名除外が絡む場合は提案を控える。
    const rows=definitions.filter(c=>deck.get(c.cardName)>0);
    return rows.length>=3?rows:null;
}
export function evaluateRefresh(input,options,model,before,current){
    if(input.difficulty==='fresh'||!options.refreshEnabled||!input.offerHistoryComplete||!(input.refreshRemaining>0)||input.mode!=='normal'||input.pickCount!==1)return null;
    const rarity=input.candidates[0]?.rarity;
    if(!rarity||input.candidates.some(c=>c.rarity!==rarity))return null;
    const pool=publicRefreshPool(options.catalog||[],input.offerHistory,rarity,input.candidates);if(!pool)return null;
    const base=stateValue(before.expectedEnd,model),values=pool.map(card=>{
        const observation={...input,candidates:[card],pickCount:1,allowSkip:false};
        return stateValue(model.projectState(observation,{...options,selectedIndices:[0]}).expectedEnd,model)-base;
    });
    const currentGain=Math.max(...current.map(row=>row.value))-base,expectedGain=expectedBest(values,3);
    // 残りの通常研修に権利を残す費用と、近似誤差の余裕を差し引く。
    const reserve=.8+Math.max(0,input.totalTurns-input.turn-1)/Math.max(1,input.refreshRemaining)*.25;
    return {currentGain,expectedGain,reserve,available:currentGain<1&&expectedGain-currentGain>reserve};
}
