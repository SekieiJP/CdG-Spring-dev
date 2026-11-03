import {hasCompatibleRiskHead} from './pro-value-model.js';
import {createOpeningTablePolicy} from './pro-opening-table.js';
import {createRiskPolicy} from './pro-risk-research.js';
import {createPublicActionKernel} from './pro-public-action-kernel.js';
import {createLearnedPolicy} from './pro-learned-research.js';
import {createIntrinsicRecoveryCheck} from './pro-intrinsic-recovery.js';
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

export function createResearchPolicy({projectDeck,score:sourceScore,cloneState,resolve,enumerateOptions,catalog=[],turns=null,publicActionParser=null,config={},refreshAdvice=null,valueModel=null,openingTable=null}) {
    if(config.planning?.valueHorizon&&!valueModel)throw Error('学習済みの固定評価が必要');
    if(config.planning?.shortfallWeight>0&&!hasCompatibleRiskHead(valueModel,'pro-shortfall9'))throw Error('損失係数には互換な低得点損失モデルが必要');
    if((config.planning?.failureWeight>0||config.learned?.acquisitionFailureWeight>0)&&!hasCompatibleRiskHead(valueModel,'pro-failure8'))throw Error('頻度係数には互換な低得点頻度モデルが必要');
    if(config.fastPublicActions){if(!turns||!publicActionParser)throw Error('公開効果の適用器とターン設定が必要');resolve=createPublicActionKernel(turns,publicActionParser);}
    if(config.placementRolloutTurns!==undefined&&(!Number.isInteger(config.placementRolloutTurns)||config.placementRolloutTurns<2||config.placementRolloutTurns>8))throw Error('配置の先読み範囲は残り2〜8ターン');
    if(config.targetScore!==undefined&&(!Number.isInteger(config.targetScore)||config.targetScore<1||config.targetScore>16))throw Error('目標経路は1〜16点');
    if(['placementBeam','lateBeam'].some(k=>config[k]!==undefined&&(!Number.isInteger(config[k])||config[k]<8||config[k]>2000)))throw Error('探索幅は8〜2000');
    if(config.statBuffers&&Object.entries(config.statBuffers).some(([k,v])=>!KEYS.includes(k)||!Number.isFinite(v)||v<0||v>12))throw Error('パラメータ余裕は既知の軸の0〜12');
    if(config.deleteFloor!==undefined&&(!Number.isInteger(config.deleteFloor)||config.deleteFloor<2||config.deleteFloor>12))throw Error('保持枚数は2〜12枚');
    if(config.effectRecoveryProtection!==undefined&&typeof config.effectRecoveryProtection!=='boolean')throw Error('実効果による回復役保護は真偽値');
    if(config.effectRecoveryProtection&&!publicActionParser)throw Error('回復効果のパーサーが必要');
    const recoveryCheck=config.effectRecoveryProtection?createIntrinsicRecoveryCheck(publicActionParser):null;
    const activationGoals=config.activationGoals??[];
    if(!Array.isArray(activationGoals)||activationGoals.length>12||activationGoals.some(g=>!g||!Number.isInteger(g.cardNo)||g.cardNo<1||g.cardNo>51||!KEYS.includes(g.stat)||!Number.isFinite(g.threshold)||g.threshold<1||g.threshold>60||!Number.isFinite(g.weight)||g.weight<0||g.weight>50||!Number.isInteger(g.minRemaining)||g.minRemaining<2||g.minRemaining>8))throw Error('条件発動の目標指定が不正');
    // 保有している条件付き札を早く働かせる仮説。最終ターンの得点評価には足さない。
    function activationValue(observation,stats){return activationGoals.reduce((sum,g)=>sum-(observation.totalTurns-observation.turn>=g.minRemaining&&observation.owned.some(c=>Number(c.cardNo)===g.cardNo)?g.weight*Math.max(0,g.threshold-stats[g.stat]):0),0);}
    const routeCache=new Map(),scoreCache=new Map(),tableKeys=new WeakMap();
    const tableKey=table=>{if(!tableKeys.has(table))tableKeys.set(table,JSON.stringify(table));return tableKeys.get(table);};
    function score(stats,table){const key=tableKey(table)+'|'+KEYS.map(k=>stats[k]).join(',');
        if(!scoreCache.has(key)){if(scoreCache.size>60000)scoreCache.clear();scoreCache.set(key,sourceScore(stats,table));}return scoreCache.get(key);}
    const baseMode=mode=>mode?.replace(/^acq-/,''),weights=mode=>({...RESEARCH_MODES[baseMode(mode)]||RESEARCH_MODES.median,...config.weights,...(mode?.startsWith('acq-')?config.acquisitionWeights:{})});
    function routes(observation,mode) {
        const target=config.targetScore??(baseMode(mode)==='median'?14:15),key=target+'|'+tableKey(observation.rankTable);
        if(!routeCache.has(key))routeCache.set(key,targetRoutes(observation.rankTable,target));
        return routeCache.get(key);
    }
    function value(stats,observation,mode='median') {
        const w=weights(mode),caps={experience:50,enrollment:48,satisfaction:baseMode(mode)==='median'?25:35,accounting:18,...config.caps};
        const buffers={accounting:config.safetyBuffer||0,...config.statBuffers},scoredStats=Object.fromEntries(KEYS.map(k=>[k,Math.max(0,stats[k]-(buffers[k]||0))]));
        if(config.statBuffers)scoredStats.enrollment=Math.min(scoredStats.enrollment,scoredStats.experience);
        const goal=score(scoredStats,observation.rankTable);
        const completion=Math.max(0,...routes(observation,mode).map(r=>KEYS.reduce((v,k)=>v*clamp(stats[k]/Math.max(1,r[k])),1)));
        return (config.statScale??1)*KEYS.reduce((sum,k)=>sum+w[k]*(Math.min(stats[k],caps[k])+.05*Math.max(0,stats[k]-caps[k])),0)+
            goal.smoothPoints*(config.smoothWeight??5)+goal.points*(config.pointWeight??2)+w.route*completion;
    }
    function forecast(observation,cards,mode) {
        const w=weights(mode),projectedCards=cards.map(c=>config.predictiveEffects?.[c.cardNo]?{cardNo:c.cardNo,cardName:c.cardName,category:c.category,rarity:c.rarity,effect:config.predictiveEffects[c.cardNo]}:c);
        let f=projectDeck(observation,{weights:w,cards:projectedCards});
        // 固定2回の補正。将来の抽選・山札順・ゲームの反復実行は使わない。
        const allowances={8:[15,16,9,1.5],7:[12,11,7,1.5],6:[8,8,4,1],5:[5,5,1.5,.3],4:[2.5,2.5,.8,.3],3:[0,0,0,.8],2:[0,0,0,.4],1:[0,0,0,0]};
        const a=allowances[observation.totalTurns-observation.turn]||[0,0,0,0],scale=config.futureAllowance||0;
        const anticipated=Object.fromEntries(KEYS.map((k,i)=>[k,f.end[k]+a[i]*scale]));
        f=projectDeck(observation,{weights:w,cards:projectedCards,forecast:anticipated});
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
    function acquisition(observation,mode,skipRollout=false) {
        if(mode==='rollout')return riskPolicy.acquisition(observation);
        if(mode==='learned'&&config.lateAcquisitionRollout&&!skipRollout&&observation.totalTurns-observation.turn<=config.lateAcquisitionRollout)return riskPolicy.acquisition(observation);
        if(mode==='learned')return learnedPolicy.acquisition(observation);
        if(config.acquisitionWeights)mode='acq-'+mode;
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
    function placements(observation,hand,state,mode,beamWidth=config.placementBeam??180,skipRollout=false) {
        if(mode==='rollout')return riskPolicy.placements(observation,hand,state);
        if(mode==='learned')return learnedPolicy.placements(observation,hand,state);
        const objective=mode==='myopic'?'median':mode;
        const remaining=observation.totalTurns-observation.turn,w=weights(objective);
        if(!skipRollout&&config.lateBeam&&remaining<=(config.lateBeamTurns??2))beamWidth=Math.max(beamWidth,config.lateBeam);
        if(!skipRollout&&(config.endgameRollout&&remaining===2||config.placementRolloutTurns&&remaining>1&&remaining<=config.placementRolloutTurns))return riskPolicy.placements(observation,hand,state);
        const future=mode==='myopic'?observation.stats:forecast({...observation,turn:observation.turn+1},observation.owned,objective).end;
        const growth=Object.fromEntries(KEYS.map(k=>[k,config.signedGrowth?future[k]-observation.stats[k]:Math.max(0,future[k]-observation.stats[k])]));
        function evaluate(next) {
            const end=Object.fromEntries(KEYS.map(k=>[k,Math.max(0,next.player[k]+growth[k])]));
            end.enrollment=Math.min(end.enrollment,end.experience);
            let v=value(end,observation,objective);
            if(remaining<=1) return score(next.player,observation.rankTable).points*10000+v;
            const maxDraw=Math.max(4,observation.owned.length+1);
            const parallelRatio=observation.owned.filter(c=>(c.effect||'').includes('並行')).length/Math.max(1,observation.owned.length);
            const throughputFactor=config.adaptiveDraw?Math.max(.2,Math.min(1,parallelRatio+.2)):1;
            const drawFactor=(config.tokenHorizon?Math.min(1.25,(remaining-1)/4):1)*throughputFactor;
            const inspirationFactor=config.tokenHorizon?Math.min(1.5,(remaining-1)/3):1;
            v+=w.draw*drawFactor*(clamp(4+next.tokens.passion-next.tokens.fatigue,0,maxDraw)-4);
            v+=w.inspiration*inspirationFactor*next.tokens.inspiration+Math.min(4,(remaining-1)*1.3)*next.tokens.organize;
            v+=activationValue(observation,next.player);
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
        if(mode==='learned')return learnedPolicy.deletions(observation,deleteMax);
        if(mode==='off'||observation.turn>=observation.totalTurns-1)return [];
        const next={...observation,turn:observation.turn+1,tokens:{...observation.tokens,inspiration:0,organize:0}};
        let owned=[...observation.owned];const removed=[];
        for(let k=0;k<deleteMax&&owned.length>(config.deleteFloor??5);k++) {
            const baseline=deckValue(next,owned,objective),candidates=[];
            for(let index=0;index<owned.length;index++) {
                const card=owned[index];if(mode==='basic'&&card.rarity!=='N')continue;
                if(observation.turn<(config.protectUntil??6)&&config.protectCards?.includes(Number(card.cardNo))&&owned.filter(c=>String(c.cardNo)===String(card.cardNo)).length===1)continue;
                const after=[...owned];after.splice(index,1);
                if(config.protectFinance&&card.category==='庶務'&&next.stats.accounting<18&&after.filter(c=>c.category==='庶務').length<2)continue;
                const evaluated=deckValue(next,after,objective);
                if(mode!=='basic') {
                    // 最後の回復役を消すとまだ不足する場面では残す。名前・レア度の一律削除を避ける。
                    const losesRole=(status,category,target)=>next.stats[status]<target&&card.category===category&&
                        !after.some(c=>c.category===category)&&evaluated.forecast.end[status]<target;
                    const losesEffect=(status,target)=>next.stats[status]<target&&evaluated.forecast.end[status]<target&&
                        recoveryCheck(card,status,next,target,evaluated.forecast.end)&&!after.some(c=>recoveryCheck(c,status,next,target,evaluated.forecast.end));
                    if(recoveryCheck?
                        losesEffect('accounting',15)||losesEffect('satisfaction',15)||losesEffect('experience',40)||config.protectEnrollment&&losesEffect('enrollment',Number(config.protectEnrollment)):
                        losesRole('accounting','庶務',15)||losesRole('satisfaction','応対',15)||losesRole('experience','動員',40)||config.protectEnrollment&&losesRole('enrollment','教務',Number(config.protectEnrollment)))continue;
                }
                candidates.push({index,cardNo:card.cardNo,gain:evaluated.score-baseline.score,after:evaluated.forecast.end});
            }
            candidates.sort((a,b)=>b.gain-a.gain||a.index-b.index);
            const best=candidates[0];if(!best||(mode==='adaptive'&&best.gain<=0))break;
            removed.push(best);owned.splice(best.index,1);
        }
        return removed;
    }
    const baseline={acquisition,placements,deletions,value,forecast,activationValue,futureRefresh:(...args)=>learnedPolicy.refresh(...args),futureValue:(ob,phase)=>{const predictedScore=learnedPolicy.estimate(ob,phase),next=phase==='after-action'?{...ob,turn:ob.turn+1}:ob,f=forecast(next,next.owned,'engine');return {mean:predictedScore,shortfall:learnedPolicy.shortfall(ob,phase),failure:learnedPolicy.failure(ob,phase),forecast:f.end,tie:value(f.end,next,'engine')+f.engine*8-f.risk*.8+activationValue(ob,ob.stats)};}};
    const riskPolicy=createRiskPolicy({baseline,score,cloneState,resolve,enumerateOptions,catalog,config,refreshAdvice});
    const learnedPolicy=valueModel?createLearnedPolicy({baseline,projectDeck,score,cloneState,resolve,enumerateOptions,model:valueModel,catalog,config}):null;
    const opening=openingTable?createOpeningTablePolicy({table:openingTable,catalog,refreshCost:config.openingRefreshCost??0}):null;
    if(!opening)return {...baseline,initial,riskPolicy,learnedPolicy};
    if(!learnedPolicy)throw Error('初回表の後続学習評価が必要');
    // 実際の初回だけを置き換え、仮想将来とそれ以外の操作は固定する。
    return {...baseline,initial,riskPolicy,
        acquisition:(ob,mode,skipRollout=false)=>(skipRollout?null:opening.acquisition(ob))??acquisition(ob,mode,skipRollout),
        learnedPolicy:{...learnedPolicy,refresh:(ob,...args)=>opening.refresh(ob)||learnedPolicy.refresh(ob,...args)}};
}
