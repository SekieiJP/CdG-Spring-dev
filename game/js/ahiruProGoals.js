/** 公式PRO表から、退塾なしでS得点に届く最小経路を作る。 */
const AXES=['experience','enrollment','satisfaction','accounting'];
const cache=new Map();
export function getProSGoals(rankTable){
    const key=JSON.stringify(rankTable);
    if(cache.has(key))return cache.get(key);
    if(!Array.isArray(rankTable))return null;
    const s=rankTable.find(r=>r.grade==='S'),bonus=rankTable.find(r=>r.withdrawalThreshold===0)?.scores.withdrawal;
    if(!Number.isFinite(s?.rankThreshold)||!Number.isFinite(bonus)||!Number.isFinite(s.thresholds.satisfaction)||!Number.isFinite(s.thresholds.accounting))return null;
    const points=(threshold,score)=>{
        const unique=new Map();
        for(const row of rankTable){const t=threshold(row),p=score(row);if(Number.isFinite(t)&&Number.isFinite(p))unique.set(p,Math.min(unique.get(p)??Infinity,t));}
        return [...unique].map(([points,threshold])=>({points,threshold}));
    };
    const experience=points(r=>r.thresholds.experience,r=>r.scores.mobilization),enrollment=points(r=>r.enrollmentDiffThreshold,r=>r.scores.enrollmentDiff),satisfaction=points(r=>r.thresholds.satisfaction,r=>r.scores.satisfaction),unique=new Map();
    for(const e of experience)for(const n of enrollment)for(const a of satisfaction){
        if(e.points+n.points+a.points+bonus<s.rankThreshold)continue;
        const route={experience:Math.max(e.threshold,n.threshold),enrollment:n.threshold,satisfaction:Math.max(s.thresholds.satisfaction,a.threshold),accounting:s.thresholds.accounting};
        unique.set(AXES.map(k=>route[k]).join(','),route);
    }
    const all=[...unique.values()],routes=all.filter(r=>!all.some(other=>AXES.every(k=>other[k]<=r[k])&&AXES.some(k=>other[k]<r[k]))).map(Object.freeze);
    const cap=rows=>Math.min(...rows.filter(r=>r.points===Math.max(...rows.map(r=>r.points))).map(r=>r.threshold));
    const value=Object.freeze({targetPoints:s.rankThreshold,sThresholds:Object.freeze({...s.thresholds}),caps:Object.freeze({experience:cap(experience),enrollment:cap(enrollment),satisfaction:cap(satisfaction),accounting:s.thresholds.accounting}),routes:Object.freeze(routes)});
    if(cache.size>12)cache.clear();cache.set(key,value);return value;
}
