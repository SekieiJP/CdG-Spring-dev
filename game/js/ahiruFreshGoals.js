import {ScoreManager} from './scoreManager.js?v=20261110-0065';
import {CURRENT_EVENT_ID} from './eventManager.js?v=20261110-0065';
const AXES=['experience','enrollment','satisfaction','accounting'];
// 評価専用。ハイスコア保存の移行や読み書きは実行しない。
const scorer=new ScoreManager(null,{migrateHighScore:false}),cache=new Map();
export function scoreFreshStats(stats,{event=false}={}){
    return scorer.calculateScore({difficulty:'fresh',player:Object.fromEntries(AXES.map(key=>[key,stats[key]])),event:event?{enabled:true,eventId:CURRENT_EVENT_ID}:null});
}
export function freshAdviceScore(stats,input={}){
    const value=scoreFreshStats(stats,{event:input.mode==='event'}),b=value.splusBreakdown;
    // S成立後は公式の丸め前精度。成立前は同点時の小さな進捗だけを足す。
    const smoothPoints=b?8+b.expPrecision+b.diffPrecision+b.expOverflow+b.diffOverflow:
        value.points+.001*(Math.min(stats.experience,30)+3*Math.min(Math.max(0,value.enrollmentDiff),30)-4*value.withdrawal);
    return {...value,smoothPoints};
}
/** 表の表示上のSと、公式得点でSへ届く最小の整数経路を区別する。 */
export function getFreshSGoals(rankTable){
    const key=JSON.stringify(rankTable);if(cache.has(key))return cache.get(key);
    if(!Array.isArray(rankTable))return null;
    const s=rankTable.find(row=>row.grade==='S');
    if(!s||AXES.some(axis=>!Number.isInteger(s.thresholds?.[axis])||s.thresholds[axis]<0))return null;
    const caps=Object.fromEntries(AXES.map(axis=>[axis,['satisfaction','accounting'].includes(axis)?s.thresholds[axis]:Math.max(...rankTable.map(row=>row.thresholds?.[axis]).filter(Number.isFinite))]));
    if(AXES.some(axis=>caps[axis]>100))return null;
    const targetPoints=Array.from({length:17},(_,points)=>points).find(points=>['S','S+'].includes(scorer.calculateRank(points,points).grade));
    if(targetPoints===undefined)return null;
    const candidates=[];
    const meets=stats=>scoreFreshStats(stats).points>=targetPoints;
    for(let satisfaction=0;satisfaction<=caps.satisfaction;satisfaction++)for(let accounting=0;accounting<=caps.accounting;accounting++){
        if(!meets({...caps,satisfaction,accounting}))continue;
        for(let experience=0;experience<=caps.experience;experience++){
            let lo=0,hi=Math.min(experience,caps.enrollment);
            if(!meets({experience,enrollment:hi,satisfaction,accounting}))continue;
            while(lo<hi){const mid=Math.floor((lo+hi)/2);if(meets({experience,enrollment:mid,satisfaction,accounting}))hi=mid;else lo=mid+1;}
            candidates.push({experience,enrollment:lo,satisfaction,accounting});
        }
    }
    const routes=candidates.filter(route=>!candidates.some(other=>AXES.every(axis=>other[axis]<=route[axis])&&AXES.some(axis=>other[axis]<route[axis]))).map(Object.freeze);
    const goals=Object.freeze({targetPoints,sThresholds:Object.freeze({...s.thresholds}),caps:Object.freeze(caps),routes:Object.freeze(routes)});
    if(cache.size>12)cache.clear();cache.set(key,goals);return goals;
}
