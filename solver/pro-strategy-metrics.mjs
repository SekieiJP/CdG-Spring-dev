/** 実ゲームの記録を集計するだけのツール。カードの判断・ゲーム実行は行わない。 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
export function wilson(k,n) {
    if(!n)return [null,null];const z=1.96,p=k/n,d=1+z*z/n;
    const mid=(p+z*z/(2*n))/d,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
    return [Math.max(0,mid-half),Math.min(1,mid+half)];
}
export function median(values) {
    const a=[...values].sort((a,b)=>a-b),n=a.length;
    return n?(a[Math.floor((n-1)/2)]+a[Math.floor(n/2)])/2:null;
}
const q=(a,p)=>[...a].sort((a,b)=>a-b)[Math.max(0,Math.ceil(a.length*p)-1)]??null;
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
export function retryEstimate(k,n,attempts=[10,50,100]) {
    const p=n?k/n:0,interval=wilson(k,n);
    return {assumption:'independent full games with an unchanged strategy; no early restart',
        expectedAttempts:p?1/p:null,expectedAttempts95:interval[1]?[1/interval[1],interval[0]>0?1/interval[0]:null]:[null,null],
        successWithin:attempts.map(count=>({count,probability:1-(1-p)**count,
            interval95:interval.map(v=>v===null?null:1-(1-v)**count)}))};
}
export function compactRecord(record) {
    const s=record.result?.score;
    if(!s||!Number.isFinite(s.displayScore))throw new Error('未完了または得点のない記録');
    if(record.metadata?.difficulty!=='pro')throw new Error('PRO以外の記録');
    if(record.truncated)throw new Error('イベント記録が途中で切れています');
    const events=record.events||[],first=events.find(e=>e.type==='offer');
    const turnStats={},cards={};let acquisitions=0,deleted=0,drawn=0,placed=0,applied=0,failed=0;
    const card=no=>cards[no]||(cards[no]={cardNo:String(no),acquired:0,deleted:0,placed:0,applied:0,failed:0,delta:{experience:0,enrollment:0,satisfaction:0,accounting:0}});
    for(const e of events) {
        if(e.type==='acquire'){card(e.card.cardNo).acquired++;if(e.card.rarity!=='N')acquisitions++;}
        if(e.type==='delete'){deleted++;card(e.card.cardNo).deleted++;}
        if(e.type==='draw')drawn+=e.cards.length;
        if(e.type==='place'){placed++;card(e.card.cardNo).placed++;}
        if(e.type==='resolve'){
            if(e.applied){applied++;card(e.cardNo).applied++;}else{failed++;card(e.cardNo).failed++;}
            const c=card(e.cardNo);for(const key of Object.keys(c.delta))c.delta[key]+=(e.afterStats[key]??0)-(e.beforeStats[key]??0);
            turnStats[e.turn]=e.afterStats;
        }
    }
    return {seed:record.metadata.seed,score:s.displayScore,basePoints:s.points,grade:s.rank?.grade,
        stats:{experience:s.experience,enrollment:s.enrollment,satisfaction:s.satisfaction,accounting:s.accounting,
            withdrawal:s.withdrawal,difference:s.enrollmentDiff},deckSize:record.result.finalDeck.length,
        finalDeck:record.result.finalDeck.map(c=>({cardNo:c.cardNo,cardName:c.cardName})),cards,turnStats,
        acquisitions,deleted,drawn,placed,applied,failed,
        firstOfferHash:createHash('sha256').update(JSON.stringify(first?.cards.map(c=>c.cardNo)||[])).digest('hex'),
        provenance:record.metadata.provenance,cardVersion:record.metadata.cardVersion,rankVersion:record.metadata.rankVersion,
        research:record.metadata.research,source:record.metadata.source,
        policy:JSON.stringify({research:record.metadata.research??null,acquisitionModel:record.metadata.acquisitionModel??null,
            acquisitionAblation:record.metadata.acquisitionAblation??null,continuationPolicy:record.metadata.continuationPolicy??null,
            refreshPolicy:record.metadata.refreshPolicy??null,refreshModel:record.metadata.refreshModel??null,forcedChoice:record.metadata.forcedChoice??null})};
}
export function summarizeOutcomes(outcomes,{minimumSeeds=250}={}) {
    const n=outcomes.length;
    if(n!==new Set(outcomes.map(r=>r.seed)).size)throw new Error('同一方略内のシード重複');
    if(n<minimumSeeds)throw new Error(`傾向の集計には最低${minimumSeeds}シードが必要: ${n}`);
    if(new Set(outcomes.map(r=>r.policy)).size!==1)throw new Error('異なる取得・配置・削除・リフレッシュ方略の混在');
    if(new Set(outcomes.map(r=>r.seed.replace(/:\d+$/,''))).size!==1)throw new Error('開発・検証・局面の異なるシード群の混在');
    if(new Set(outcomes.map(r=>r.provenance?.strategyVersion)).size!==1)throw new Error('異なる分析スクリプト版の混在');
    const versions=new Set(outcomes.map(r=>JSON.stringify([r.provenance?.codeHash,r.cardVersion,r.rankVersion,r.source])));
    if(versions.size!==1)throw new Error('本体・カード・得点表・実行種別の異なる記録を混ぜています');
    const scores=outcomes.map(r=>r.score),k=outcomes.filter(r=>r.score>=15).length;
    const reached=predicate=>outcomes.filter(predicate).length/n;
    return {n,mean:mean(scores),median:median(scores),p10:q(scores,.1),p90:q(scores,.9),min:Math.min(...scores),max:Math.max(...scores),
        score15:{count:k,rate:k/n,interval95:wilson(k,n)},score14:{count:outcomes.filter(r=>r.score>=14).length,rate:reached(r=>r.score>=14)},
        score12Rate:reached(r=>r.score>=12),scoreBelow8Rate:reached(r=>r.score<8),withdrawalZeroRate:reached(r=>r.stats.withdrawal===0),
        meanStats:Object.fromEntries(Object.keys(outcomes[0].stats).map(key=>[key,mean(outcomes.map(r=>r.stats[key]))])),
        milestones:{experience50:reached(r=>r.stats.experience>=50),difference40:reached(r=>r.stats.difference>=40),
            difference48:reached(r=>r.stats.difference>=48),satisfaction25:reached(r=>r.stats.satisfaction>=25),satisfaction35:reached(r=>r.stats.satisfaction>=35)},
        activity:Object.fromEntries(['deckSize','acquisitions','deleted','drawn','placed','applied','failed'].map(key=>[key,mean(outcomes.map(r=>r[key]))])),
        scoreDistribution:Object.fromEntries([...new Set(scores)].sort((a,b)=>a-b).map(s=>[s,scores.filter(v=>v===s).length])),
        retries:retryEstimate(k,n),versions:[...versions].map(JSON.parse)};
}
export function pairedOutcomes(before,after,{minimumSeeds=250,iterations=2000}={}) {
    const old=new Map(before.map(r=>[r.seed,r]));
    if(old.size!==before.length||new Set(after.map(r=>r.seed)).size!==after.length)throw new Error('比較内のシード重複');
    const pairs=after.filter(r=>old.has(r.seed)).map(r=>[old.get(r.seed),r]);
    if(pairs.length<minimumSeeds)throw new Error(`対比較は最低${minimumSeeds}共通シードが必要`);
    if(pairs.some(([a,b])=>JSON.stringify([a.provenance?.codeHash,a.cardVersion,a.rankVersion,a.source])!==JSON.stringify([b.provenance?.codeHash,b.cardVersion,b.rankVersion,b.source])))throw new Error('比較対象の本体・カード・得点表・種別が異なります');
    let seed=0x152503;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
    const rates=[],medians=[],means=[];
    for(let iter=0;iter<iterations;iter++){
        const sample=Array.from({length:pairs.length},()=>pairs[Math.floor(random()*pairs.length)]);
        rates.push(mean(sample.map(([a,b])=>Number(b.score>=15)-Number(a.score>=15))));
        medians.push(median(sample.map(([,b])=>b.score))-median(sample.map(([a])=>a.score)));
        means.push(mean(sample.map(([a,b])=>b.score-a.score)));
    }
    return {n:pairs.length,meanDifference:mean(pairs.map(([a,b])=>b.score-a.score)),meanDifference95:[q(means,.025),q(means,.975)],
        medianDifference:median(pairs.map(([,b])=>b.score))-median(pairs.map(([a])=>a.score)),medianDifference95:[q(medians,.025),q(medians,.975)],
        score15RateDifference:mean(pairs.map(([a,b])=>Number(b.score>=15)-Number(a.score>=15))),score15RateDifference95:[q(rates,.025),q(rates,.975)],
        newly15:pairs.filter(([a,b])=>a.score<15&&b.score>=15).length,lost15:pairs.filter(([a,b])=>a.score>=15&&b.score<15).length,
        firstOfferMismatches:pairs.filter(([a,b])=>a.firstOfferHash!==b.firstOfferHash).length};
}
export async function loadRuns(files) {
    const outcomes=[];
    for(const file of files) {
        const data=JSON.parse(await readFile(file,'utf8'));
        if(data.simulations.length!==1)throw new Error('1ファイル1方略で指定してください');
        outcomes.push(...data.simulations[0].playRecords.map(compactRecord));
    }
    return outcomes;
}
async function main(){
    const [manifestPath,outputDir]=process.argv.slice(2);if(!manifestPath||!outputDir)throw new Error('usage: node solver/pro-strategy-metrics.mjs manifest.json outputDir');
    const manifest=JSON.parse(await readFile(manifestPath,'utf8')),groups={},summary={generatedAt:new Date().toISOString(),manifest,groups:{},comparisons:{}};
    for(const run of manifest.runs){const outcomes=await loadRuns(run.files);groups[run.id]=outcomes;
        summary.groups[run.id]={description:run.description,...summarizeOutcomes(outcomes),
            examples15:outcomes.filter(r=>r.score>=15).slice(0,5).map(r=>({seed:r.seed,score:r.score,stats:r.stats,turnStats:r.turnStats,deck:r.finalDeck})),
            strategyVersions:[...new Set(outcomes.map(r=>r.provenance?.strategyVersion))]};}
    for(const comparison of manifest.comparisons||[])summary.comparisons[comparison.id]={...comparison,...pairedOutcomes(groups[comparison.before],groups[comparison.after])};
    await mkdir(outputDir,{recursive:true});await writeFile(path.join(outputDir,'summary.json'),JSON.stringify(summary,null,2)+'\n');
    const lines=['id,n,median,mean,p10,p90,15_count,15_rate,15_low95,15_high95,below8,withdrawal0,deck,acquisitions,drawn,placed,deleted'];
    for(const [id,s] of Object.entries(summary.groups))lines.push([id,s.n,s.median,s.mean,s.p10,s.p90,s.score15.count,s.score15.rate,...s.score15.interval95,s.scoreBelow8Rate,s.withdrawalZeroRate,s.activity.deckSize,s.activity.acquisitions,s.activity.drawn,s.activity.placed,s.activity.deleted].join(','));
    await writeFile(path.join(outputDir,'summary.csv'),lines.join('\n')+'\n');
    console.log(lines.join('\n'));console.log(JSON.stringify(summary.comparisons,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e);process.exitCode=1;});
