import { CardManager } from './cardManager.js?v=20260815-0055';

/** 公開情報の固定回数の算術投影。抽選・ゲームの将来試行は行わない。 */
export const ADVISOR_VERSION = 'pro-formula-v1';
export const PROFILES = Object.freeze({
    pro_splus: Object.freeze({ experience: 2.3, enrollment: 4.6, satisfaction: 2.6, accounting: 4.2, goal: 30, points: 5, engine: 1.5, risk: 1.2, future: .65 }),
    pro_lean: Object.freeze({ experience: 2.8, enrollment: 4.0, satisfaction: 2.2, accounting: 3.8, goal: 25, points: 5, engine: .7, risk: 1.6, future: .55 }),
    pro_balanced: Object.freeze({ experience: 2.5, enrollment: 3.5, satisfaction: 2.0, accounting: 3.0, goal: 18, points: 4, engine: 2.0, risk: 1.0, future: .72 }),
    pro_engine: Object.freeze({ experience: 2.7, enrollment: 3.6, satisfaction: 1.8, accounting: 2.8, goal: 15, points: 3, engine: 4.5, risk: .7, future: .8 }),
    pro_bridge: Object.freeze({ experience: 2.2, enrollment: 3.2, satisfaction: 3.0, accounting: 3.2, goal: 22, points: 5, engine: 1.2, risk: 1.3, future: .65 }),
    pro_precision: Object.freeze({ experience: 3.2, enrollment: 4.3, satisfaction: 1.5, accounting: 2.6, goal: 25, points: 4, engine: 1.4, risk: .8, future: .75 })
});
export const DEFAULT_PROFILE = 'pro_splus';
const KEYS = ['experience','enrollment','satisfaction','accounting'];
const TOKENS = ['passion','fatigue','inspiration','organize'];
const SLOTS = ['leader','teacher','staff'];
const NAMES = { experience:'動員の不足', enrollment:'入退差の不足', satisfaction:'高満足の加点', accounting:'退塾・経理コスト', goal:'S+への補完', points:'公式得点への寄与', engine:'ドロー・並行配置・圧縮', risk:'発動・配置の難しさ' };
const parser = new CardManager(null), cache = new Map(), tableCache = new Map();
export const clamp = (v, a=0, b=1) => Math.max(a,Math.min(b,v));
const parsed = card => { if(!cache.has(card.effect||''))cache.set(card.effect||'',parser.parseEffect(card.effect||''));return cache.get(card.effect||''); };
export const withdrawal = stats => Math.max(0,15-stats.satisfaction)+Math.max(0,15-stats.accounting);

function scoring(table) {
    if(!Array.isArray(table)||!table.length)throw new Error('PRO推薦には公開ランク表が必要です');
    const key=JSON.stringify(table);
    if(tableCache.has(key))return tableCache.get(key);
    const axes = { experience:[], difference:[], satisfaction:[], safety:[] };
    for(const row of table){
        for(const [axis,threshold,points] of [
            ['experience',row.thresholds.experience,row.scores.mobilization],
            ['difference',row.enrollmentDiffThreshold,row.scores.enrollmentDiff],
            ['satisfaction',row.thresholds.satisfaction,row.scores.satisfaction],
            ['safety',row.withdrawalThreshold===null?null:-row.withdrawalThreshold,row.scores.withdrawal]]){
            if(points!==null&&threshold!==null){const old=axes[axis].find(r=>r.threshold===threshold);if(old)old.points=points;else axes[axis].push({threshold,points});}
        }
    }
    for(const rows of Object.values(axes))rows.sort((a,b)=>a.threshold-b.threshold);
    const target=table.find(r=>r.grade==='S+')?.rankThreshold;
    if(!Number.isFinite(target))throw new Error('PRO推薦のS+基準がありません');
    const routes=[];
    for(const exp of axes.experience)for(const diff of axes.difference)for(const sat of axes.satisfaction){
        if(exp.points+diff.points+sat.points+axes.safety.at(-1).points<target)continue;
        routes.push({experience:Math.max(exp.threshold,diff.threshold),enrollment:diff.threshold,satisfaction:Math.max(15,sat.threshold),accounting:15});
    }
    // 同じか低い全パラメータで届く経路に支配された目標は除く。
    const minimal=routes.filter((r,i)=>!routes.some((s,j)=>j!==i&&KEYS.every(k=>s[k]<=r[k])&&(KEYS.some(k=>s[k]<r[k])||j<i)));
    const result={axes,target,routes:minimal};tableCache.set(key,result);return result;
}
function axisValue(rows,value,smooth){
    if(!smooth){return [...rows].reverse().find(r=>value>=r.threshold)?.points||0;}
    if(value<=rows[0].threshold)return rows[0].points;
    for(let i=1;i<rows.length;i++)if(value<rows[i].threshold){const a=rows[i-1],b=rows[i];return a.points+(b.points-a.points)*(value-a.threshold)/(b.threshold-a.threshold);}
    return rows.at(-1).points;
}
export function proGoal(stats,rankTable){
    const {axes,routes,target}=scoring(rankTable),diff=stats.enrollment-withdrawal(stats);
    const points = smooth => axisValue(axes.experience,stats.experience,smooth)+axisValue(axes.difference,diff,smooth)+
        axisValue(axes.satisfaction,stats.satisfaction,smooth)+axisValue(axes.safety,-withdrawal(stats),smooth);
    const values=routes.map(r=>KEYS.reduce((v,k)=>v*clamp(stats[k]/Math.max(1,r[k])),1));
    return { points:points(false), smoothPoints:points(true), goal:Math.max(0,...values), target, routes };
}
function conditionChance(condition,slot,observation,forecast,future){
    const context={player:observation.stats,turn:observation.turn,totalTurns:observation.totalTurns};
    if(condition.type==='staff'||condition.type==='unknown')return Number(parser.evaluateCondition(condition,slot,context));
    if(condition.type==='remainingTurns'){
        const remaining=observation.totalTurns-observation.turn;
        return clamp((remaining-condition.value+1)/Math.max(1,remaining));
    }
    const now=Number(parser.evaluateCondition(condition,slot,context));
    if(condition.type==='status'){
        const start=observation.stats[condition.status],end=forecast[condition.status],span=Math.max(1,Math.abs(end-start)+1);
        const reach=condition.comparison==='gte'?clamp((end-condition.value+1)/span):clamp((condition.value-start+1)/span);
        return (1-future)*now+future*reach;
    }
    return (1-future)*now+future*Number(parser.evaluateCondition(condition,slot,{...context,player:forecast}));
}
function cardOutput(card,observation,forecast,weights){
    const effect=parsed(card),slots=effect.staffRestrictions.length?effect.staffRestrictions:SLOTS;
    const remaining=observation.totalTurns-observation.turn;
    const outputs=slots.map(slot=>{
        const delta=Object.fromEntries(KEYS.map(k=>[k,0])),tokens=Object.fromEntries(TOKENS.map(k=>[k,0]));
        const sets=[];let risk=0;
        const add=(effects,chance)=>{for(const item of effects){
            if(item.type==='change')delta[item.status]+=item.value*chance;
            if(item.type==='set')sets.push({status:item.status,value:item.value,chance});
            if(item.type==='token')tokens[item.token]+=chance;
        }};
        add(effect.baseEffects,1);
        for(const block of effect.conditionalBlocks){const chance=conditionChance(block.condition,slot,observation,forecast,remaining<=1?0:weights.future);add(block.effects,chance);risk+=1-chance;}
        const hasCost=[...effect.baseEffects,...effect.conditionalBlocks.flatMap(b=>b.effects)].some(i=>i.type==='change'&&i.value<0);
        if(hasCost){
            const now=Number(parser.simulateCardEffect(card,slot,observation.stats,null,observation).applied);
            const later=Number(parser.simulateCardEffect(card,slot,forecast,null,observation).applied);
            const future=remaining<=1?0:weights.future,affordable=now*(1-future)+later*future;
            for(const k of KEYS)delta[k]*=affordable;for(const k of TOKENS)tokens[k]*=affordable;
            for(const set of sets)set.chance*=affordable;risk+=1-affordable;
        }
        for(const k of TOKENS)if(k!=='organize'&&remaining<=1)tokens[k]=0;
        if(remaining<=1)tokens.organize=0;
        // 推奨カテゴリの+1は公開済みの残りターンの比率で加える。
        const recommended=observation.turns.slice(observation.turn).filter(t=>t.recommended===card.category);
        for(const t of recommended)if(t.recommendedStatus)delta[t.recommendedStatus]+=1/Math.max(1,remaining);
        const parallel=effect.baseEffects.some(i=>i.type==='immediate'&&i.effect==='parallel');
        const usefulness=KEYS.reduce((s,k)=>s+delta[k]*weights[k],0)+tokens.passion*4-tokens.fatigue*4+tokens.inspiration*2+tokens.organize*3;
        return {delta,tokens,sets,slot,parallel,risk,exclusive:slots.length===1,value:usefulness};
    });
    return outputs.sort((a,b)=>b.value-a.value)[0];
}

/** 所有集合を平均ドロー率とスタッフ競合で投影。反復は2回の代数補正だけ。 */
export function projectProDeck(observation,{weights=PROFILES[DEFAULT_PROFILE],cards=observation.owned,forecast=observation.stats}={}){
    const remaining=Math.max(0,observation.totalTurns-observation.turn),n=Math.max(1,cards.length);
    const outputs=cards.map(c=>cardOutput(c,observation,forecast,weights));
    const slotCounts=Object.fromEntries(SLOTS.map(s=>[s,outputs.filter(o=>!o.parallel&&o.exclusive&&o.slot===s).length]));
    const normal=outputs.filter(o=>!o.parallel).length,parallel=outputs.length-normal;
    const currentDraw=clamp(4+observation.tokens.passion-observation.tokens.fatigue,0,n);
    const net=outputs.reduce((s,o)=>s+o.tokens.passion-o.tokens.fatigue,0)/n;
    const playFraction=(parallel+Math.min(normal,3))/n;
    const futureDraw=clamp(4/Math.max(.45,1-net*playFraction),0,n);
    const draw=(currentDraw+futureDraw*Math.max(0,remaining-1))/Math.max(1,remaining);
    const seen=clamp(draw/n),sums=Object.fromEntries(KEYS.map(k=>[k,0]));
    let engine=0,risk=0;
    const setOutputs=[];
    for(const output of outputs){
        const competition=output.parallel?1:Math.min(.92,3/Math.max(1,normal*seen))*(output.exclusive?Math.min(1,1.3/Math.max(1,slotCounts[output.slot]*seen)):1);
        const uses=remaining*seen*competition;
        for(const k of KEYS)sums[k]+=output.delta[k]*uses;
        for(const set of output.sets)setOutputs.push({...set,activation:clamp(uses*set.chance)});
        engine+=uses*(output.tokens.passion-output.tokens.fatigue+output.tokens.inspiration*.45+output.tokens.organize*.6);
        risk+=output.risk*seen;
    }
    const end=Object.fromEntries(KEYS.map(k=>[k,Math.max(0,observation.stats[k]+sums[k])]));
    // 設定値を毎ターン加算しない。継続して払うコストがある場合の回復も一度に制限。
    for(const set of setOutputs)end[set.status]+=Math.max(0,set.value-end[set.status])*set.activation;
    end.enrollment=Math.min(end.enrollment,end.experience);
    return {end,engine,risk,draw,parallel,outputs};
}
const useful=(key,value)=>Math.min(value,key==='experience'?50:key==='enrollment'?48:key==='satisfaction'?35:18)+.05*Math.max(0,value-(key==='experience'?50:key==='enrollment'?48:key==='satisfaction'?35:18));
export function proUtility(stats,rankTable,weights=PROFILES[DEFAULT_PROFILE]){
    const goal=proGoal(stats,rankTable);
    return KEYS.reduce((v,k)=>v+useful(k,stats[k])*weights[k],0)+goal.goal*weights.goal+goal.smoothPoints*weights.points;
}
function combinations(n,count,start=0,prefix=[]){if(!count)return[prefix];const rows=[];for(let i=start;i<=n-count;i++)rows.push(...combinations(n,count-1,i+1,[...prefix,i]));return rows;}
export function recommendAcquisition(observation,{profile=DEFAULT_PROFILE,ablation=null}={}){
    if(observation.difficulty!=='pro'||observation.mode!=='normal')return null;
    if(!PROFILES[profile])throw new Error(`未知のPRO取得評価: ${profile}`);
    if(ablation&&!Object.hasOwn(NAMES,ablation))throw new Error(`未知のPRO評価特徴: ${ablation}`);
    const weights=PROFILES[profile];
    let before=projectProDeck(observation,{weights});before=projectProDeck(observation,{weights,forecast:before.end});
    const baseline=proGoal(before.end,observation.rankTable);
    const alternatives=combinations(observation.candidates.length,Math.min(observation.pickCount,observation.candidates.length));
    if(observation.allowSkip)alternatives.push([]);
    const evaluations=alternatives.map(indices=>{
        const acquired=indices.map(i=>observation.candidates[i]);
        const after=indices.length?projectProDeck(observation,{weights,cards:[...observation.owned,...acquired],forecast:before.end}):before;
        const goal=proGoal(after.end,observation.rankTable),features={};
        for(const k of KEYS)features[k]=useful(k,after.end[k])-useful(k,before.end[k]);
        features.goal=goal.goal-baseline.goal;features.points=goal.smoothPoints-baseline.smoothPoints;
        features.engine=after.engine-before.engine;features.risk=before.risk-after.risk;
        const contributions=Object.fromEntries(Object.entries(features).map(([k,v])=>[k,k===ablation?0:v*weights[k]]));
        const score=Object.values(contributions).reduce((s,v)=>s+v,0);
        const reasons=Object.entries(contributions).filter(([,v])=>v>.001).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([k])=>NAMES[k]);
        return {indices,cardNos:acquired.map(c=>c.cardNo),skip:!indices.length,score,features,contributions,forecast:after.end,
            throughput:{draw:after.draw,parallel:after.parallel},reasons:reasons.length?reasons:[indices.length?'既存デッキとの補完':'デッキの希釈を避ける']};
    }).sort((a,b)=>b.score-a.score||a.indices.join(',').localeCompare(b.indices.join(',')));
    return {version:ADVISOR_VERSION,profile,ablation,targetRank:'S+',recommended:evaluations[0]||null,evaluations};
}
