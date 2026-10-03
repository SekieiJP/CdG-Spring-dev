import {createRiskPolicy} from './pro-risk-research.js';
/** PRO攻略の仮説をブラウザ内で検証する分析用方略。本体の推薦には接続しない。 */
export const RESEARCH_VERSION = 'pro-human-strategy-v1';
const KEYS = ['experience', 'enrollment', 'satisfaction', 'accounting'];
const SLOTS = ['leader', 'teacher', 'staff'];
/** 初期4候補だけで判定する。pairs=nullは全開始、初回の提示は異なるカード名4種。 */
export function initialPairIndices(candidates, pairs=null) {
    const key=pair=>pair.map(Number).sort((a,b)=>a-b).join('-');
    const allowed=pairs===null?null:new Set(pairs.map(key)), choices=[];
    for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++) {
        if(!allowed||allowed.has(key([candidates[i].cardNo,candidates[j].cardNo])))choices.push([i,j]);
    }
    return choices;
}
export function validateInitialRule(rule) {
    if(!rule||!Object.hasOwn(rule,'pairs')||(rule.pairs!==null&&(!Array.isArray(rule.pairs)||!rule.pairs.length||
        rule.pairs.some(pair=>!Array.isArray(pair)||pair.length!==2||pair[0]===pair[1]||pair.some(n=>!Number.isInteger(n)||n<6||n>17)))))
        throw new Error('初期ペア条件はnullまたはRカードNo6〜17の2枚組');
}
const clamp = (x, lo=0, hi=1) => Math.max(lo, Math.min(hi, x));
export const RESEARCH_MODES = Object.freeze({
    median: Object.freeze({experience:2.5,enrollment:4,satisfaction:3,accounting:5,engine:2.5,risk:1.4,future:.65,route:18,draw:7,inspiration:4}),
    ceiling: Object.freeze({experience:3,enrollment:4.2,satisfaction:2.7,accounting:3.5,engine:4,risk:1,future:.75,route:40,draw:9,inspiration:6}),
    engine: Object.freeze({experience:2.7,enrollment:4.2,satisfaction:2.5,accounting:3.4,engine:8,risk:.8,future:.8,route:24,draw:12,inspiration:8})
});

/** 公式ランク表から退塾0・1の到達経路を求める。値は到達確率ではない。 */
export function targetRoutes(rankTable, target=15) {
    const axes = {experience:[],enrollment:[],satisfaction:[],withdrawal:[]};
    for (const row of rankTable) {
        for (const [axis, threshold, points] of [
            ['experience',row.thresholds.experience,row.scores.mobilization],
            ['enrollment',row.enrollmentDiffThreshold,row.scores.enrollmentDiff],
            ['satisfaction',row.thresholds.satisfaction,row.scores.satisfaction],
            ['withdrawal',row.withdrawalThreshold,row.scores.withdrawal]]) {
            if (threshold !== null && points !== null) axes[axis].push({threshold,points});
        }
    }
    const candidates=[];
    for (const w of [0,1]) {
        const safety=axes.withdrawal.filter(a=>w<=a.threshold).sort((a,b)=>a.threshold-b.threshold)[0]?.points ?? -13;
        for(const e of axes.experience)for(const n of axes.enrollment)for(const s of axes.satisfaction) {
            if(e.points+n.points+s.points+safety<target)continue;
            candidates.push({experience:Math.max(e.threshold,n.threshold+w),enrollment:n.threshold+w,
                satisfaction:Math.max(15,s.threshold),accounting:15-w,withdrawal:w});
        }
    }
    return candidates.filter((r,i)=>!candidates.some((s,j)=>j!==i&&KEYS.every(k=>s[k]<=r[k])&&
        (KEYS.some(k=>s[k]<r[k])||j<i)));
}

export function createResearchPolicy({projectDeck,score,cloneState,resolve,enumerateOptions,catalog=[],config={}}) {
    const routeCache=new Map();
    const weights = mode => ({...(RESEARCH_MODES[mode] || RESEARCH_MODES.median),...(config.weights||{})});
    function routes(observation,mode) {
        const target=mode==='median'?14:15,key=JSON.stringify([target,observation.rankTable]);
        if(!routeCache.has(key))routeCache.set(key,targetRoutes(observation.rankTable,target));
        return routeCache.get(key);
    }
    function value(stats,observation,mode='median') {
        const w=weights(mode),caps={experience:50,enrollment:48,satisfaction:mode==='median'?25:35,accounting:18,...config.caps};
        const scoredStats={...stats,accounting:Math.max(0,stats.accounting-(config.safetyBuffer||0))};
        const goal=score(scoredStats,observation.rankTable);
        const completion=Math.max(0,...routes(observation,mode).map(r=>KEYS.reduce((v,k)=>v*clamp(stats[k]/Math.max(1,r[k])),1)));
        return (config.statScale??1)*KEYS.reduce((sum,k)=>sum+w[k]*(Math.min(stats[k],caps[k])+.05*Math.max(0,stats[k]-caps[k])),0)+
            goal.smoothPoints*(config.smoothWeight??5)+goal.points*(config.pointWeight??2)+w.route*completion;
    }
    function forecast(observation,cards,mode) {
        const w=weights(mode);
        let f=projectDeck(observation,{weights:w,cards});
        // 固定2回の補正。将来の抽選・山札順・ゲームの反復実行は使わない。
        const allowances={8:[15,16,9,1.5],7:[12,11,7,1.5],6:[8,8,4,1],5:[5,5,1.5,.3],4:[2.5,2.5,.8,.3],3:[0,0,0,.8],2:[0,0,0,.4],1:[0,0,0,0]};
        const a=allowances[observation.totalTurns-observation.turn]||[0,0,0,0],scale=config.futureAllowance||0;
        const anticipated=Object.fromEntries(KEYS.map((k,i)=>[k,f.end[k]+a[i]*scale]));
        f=projectDeck(observation,{weights:w,cards,forecast:anticipated});
        f.end=Object.fromEntries(KEYS.map((k,i)=>[k,f.end[k]+a[i]*scale]));
        f.end.enrollment=Math.min(f.end.enrollment,f.end.experience);
        return f;
    }
    function deckValue(observation,cards,mode) {
        const f=forecast(observation,cards,mode),w=weights(mode);
        let utility=value(f.end,observation,mode);
        if(config.sigma>0){const seen=Math.min(1,f.draw/Math.max(1,cards.length)),uses=(observation.totalTurns-observation.turn)*seen;
            const std=Object.fromEntries(['accounting','satisfaction'].map(k=>[k,Math.sqrt(f.outputs.reduce((s,o)=>s+o.delta[k]**2,0)*uses*(1-seen))*config.sigma]));
            const nodes=[[-1.7,.08],[-.85,.24],[0,.36],[.85,.24],[1.7,.08]];utility=nodes.reduce((sum,[z,p])=>sum+p*value({...f.end,accounting:Math.max(0,f.end.accounting+z*std.accounting),satisfaction:Math.max(0,f.end.satisfaction+z*std.satisfaction)},observation,mode),0);}
        return {score:utility+f.engine*w.engine-f.risk*w.risk,forecast:f};
    }
    function acquisition(observation,mode) {
        if(mode==='rollout')return riskPolicy.acquisition(observation);
        const before=deckValue(observation,observation.owned,mode),choices=[];
        const n=observation.candidates.length;
        function add(indices) {
            const after=deckValue(observation,[...observation.owned,...indices.map(i=>observation.candidates[i])],mode);
            const bonus=indices.reduce((sum,i)=>sum+(observation.owned.some(c=>String(c.cardNo)===String(observation.candidates[i].cardNo))?0:(config.cardBonus?.[observation.candidates[i].cardNo]||0)),0)*(observation.totalTurns-observation.turn)/observation.totalTurns;
            choices.push({indices,score:after.score-before.score+bonus,forecast:after.forecast.end,
                engineDelta:after.forecast.engine-before.forecast.engine});
        }
        if(observation.pickCount===2)for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)add([i,j]);
        else for(let i=0;i<n;i++)add([i]);
        if(observation.allowSkip)add([]);
        choices.sort((a,b)=>b.score-a.score||a.indices.length-b.indices.length||String(a.indices).localeCompare(String(b.indices)));
        return {version:RESEARCH_VERSION,mode,before:before.forecast.end,evaluations:choices,recommended:choices[0]};
    }
    function initial(observation,rule,mode) {
        validateInitialRule(rule);
        if(observation.turn!==0||observation.pickCount!==2)throw new Error('初回研修以外のリセマラ判定');
        const eligible=new Set(initialPairIndices(observation.candidates,rule.pairs).map(a=>a.join('-')));
        if(!eligible.size)return {accept:false,chosenIndices:[]};
        const advice=acquisition(observation,mode),evaluations=advice.evaluations.filter(a=>eligible.has(a.indices.join('-')));
        return {accept:true,chosenIndices:evaluations[0].indices,advice:{...advice,evaluations,recommended:evaluations[0]}};
    }
    function placements(observation,hand,state,mode,beamWidth=180,skipRollout=false) {
        if(mode==='rollout')return riskPolicy.placements(observation,hand,state);
        const objective=mode==='myopic'?'median':mode;
        const remaining=observation.totalTurns-observation.turn,w=weights(objective);
        if(config.endgameRollout&&!skipRollout&&remaining===2)return riskPolicy.placements(observation,hand,state);
        const future=mode==='myopic'?observation.stats:forecast({...observation,turn:observation.turn+1},observation.owned,objective).end;
        const growth=Object.fromEntries(KEYS.map(k=>[k,config.signedGrowth?future[k]-observation.stats[k]:Math.max(0,future[k]-observation.stats[k])]));
        function evaluate(next) {
            const end=Object.fromEntries(KEYS.map(k=>[k,Math.max(0,next.player[k]+growth[k])]));
            end.enrollment=Math.min(end.enrollment,end.experience);
            let v=value(end,observation,objective);
            if(remaining<=1) return score(next.player,observation.rankTable).points*10000+v;
            const maxDraw=Math.max(4,observation.owned.length+1);
            const drawFactor=config.tokenHorizon?Math.min(1.25,(remaining-1)/4):1;
            const inspirationFactor=config.tokenHorizon?Math.min(1.5,(remaining-1)/3):1;
            v+=w.draw*drawFactor*(clamp(4+next.tokens.passion-next.tokens.fatigue,0,maxDraw)-4);
            v+=w.inspiration*inspirationFactor*next.tokens.inspiration+Math.min(4,(remaining-1)*1.3)*next.tokens.organize;
            v-=Math.max(0,3-next.player.accounting)*3;
            return v;
        }
        let frontier=[{state:cloneState(state),counts:Object.fromEntries(SLOTS.map(s=>[s,0])),used:0n,seq:[]}];
        frontier[0].value=evaluate(frontier[0].state);
        for(let depth=0;depth<Math.min(hand.length,16);depth++) {
            const expanded=[...frontier],seen=new Set();
            for(const node of frontier)for(const option of enumerateOptions(hand,node.counts)) {
                if(node.used&(1n<<BigInt(option.cardIndex)))continue;
                if(SLOTS.slice(SLOTS.indexOf(option.slot)+1).some(s=>node.counts[s]>0))continue;
                const next=cloneState(node.state);
                if(!resolve(option.card,option.slot,next).applied)continue;
                const used=node.used|(1n<<BigInt(option.cardIndex)),counts={...node.counts,[option.slot]:node.counts[option.slot]+1};
                const key=JSON.stringify([used.toString(),counts,next.player,next.tokens]);
                if(seen.has(key))continue;seen.add(key);
                expanded.push({state:next,used,counts,seq:[...node.seq,{cardIndex:option.cardIndex,slot:option.slot}],value:evaluate(next)});
            }
            expanded.sort((a,b)=>b.value-a.value||a.seq.length-b.seq.length);
            frontier=expanded.slice(0,beamWidth);
        }
        return frontier[0]?.seq||[];
    }
    /** 1回の会議の削除順を評価。取得・配置とは独立して切り替える。 */
    function deletions(observation,deleteMax,mode,objective='median') {
        if(mode==='rollout')return riskPolicy.deletions(observation,deleteMax);
        if(mode==='off'||observation.turn>=observation.totalTurns-1)return [];
        const next={...observation,turn:observation.turn+1,tokens:{...observation.tokens,inspiration:0,organize:0}};
        let owned=[...observation.owned];const removed=[];
        for(let k=0;k<deleteMax&&owned.length>5;k++) {
            const baseline=deckValue(next,owned,objective),candidates=[];
            for(let index=0;index<owned.length;index++) {
                const card=owned[index];if(mode==='basic'&&card.rarity!=='N')continue;
                const after=[...owned];after.splice(index,1);
                if(config.protectFinance&&card.category==='庶務'&&next.stats.accounting<18&&after.filter(c=>c.category==='庶務').length<2)continue;
                const evaluated=deckValue(next,after,objective);
                if(mode!=='basic') {
                    // 最後の回復役を消すとまだ不足する場面では残す。名前・レア度の一律削除を避ける。
                    const losesRole=(status,category,target)=>next.stats[status]<target&&card.category===category&&
                        !after.some(c=>c.category===category)&&evaluated.forecast.end[status]<target;
                    if(losesRole('accounting','庶務',15)||losesRole('satisfaction','応対',15)||losesRole('experience','動員',40))continue;
                }
                candidates.push({index,cardNo:card.cardNo,gain:evaluated.score-baseline.score,after:evaluated.forecast.end});
            }
            candidates.sort((a,b)=>b.gain-a.gain||a.index-b.index);
            const best=candidates[0];if(!best||(mode==='adaptive'&&best.gain<=0))break;
            removed.push(best);owned.splice(best.index,1);
        }
        return removed;
    }
    const baseline={acquisition,placements,deletions,value,forecast};
    const riskPolicy=createRiskPolicy({baseline,score,cloneState,resolve,enumerateOptions,catalog,config});
    return {...baseline,initial,riskPolicy};
}
