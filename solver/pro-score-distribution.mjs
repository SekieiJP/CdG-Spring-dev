#!/usr/bin/env node
/** 完走集計の得点分布を診断する。判断・仮想操作・ゲームは実行しない。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {pairedOutcomes} from './pro-strategy-metrics.mjs';
export function diagnoseDistribution(group,{target=12.5,maxScore=16}={}){
 const {n,scoreDistribution}=group;
 if(!Number.isInteger(n)||n<250||group.resets!==0||!Number.isFinite(target)||target<0||target>maxScore)throw Error('全開始250以上・リセマラなしの完走集計が必要');
 const rows=Object.entries(scoreDistribution||{}).map(([s,count])=>({score:Number(s),count}));
 if(!rows.length||rows.some(r=>!Number.isInteger(r.score)||r.score>maxScore||!Number.isInteger(r.count)||r.count<1)||rows.reduce((a,r)=>a+r.count,0)!==n)throw Error('得点分布の件数・範囲が不正');
 const mean=rows.reduce((a,r)=>a+r.score*r.count,0)/n;
 if(!Number.isFinite(group.mean)||Math.abs(mean-group.mean)>1e-9)throw Error('平均と得点分布が一致しない');
 const bands=[['below8',s=>s<8],['8-9',s=>s>=8&&s<10],['10-11',s=>s>=10&&s<12],['12',s=>s===12],['13',s=>s===13],['14',s=>s===14],['15-16',s=>s>=15]];
 const buckets=bands.map(([id,test])=>{const included=rows.filter(r=>test(r.score)),count=included.reduce((a,r)=>a+r.count,0);return {id,count,rate:count/n,contributionToMean:included.reduce((a,r)=>a+r.score*r.count,0)/n,shortfallFromTargetPerStart:included.reduce((a,r)=>a+Math.max(0,target-r.score)*r.count,0)/n,surplusFromTargetPerStart:included.reduce((a,r)=>a+Math.max(0,r.score-target)*r.count,0)/n};});
 const hypotheticalRepair=(test,to)=>{const affected=rows.filter(r=>test(r.score)),gain=affected.reduce((a,r)=>a+Math.max(0,to-r.score)*r.count,0)/n;return {replacementScore:to,affectedCount:affected.reduce((a,r)=>a+r.count,0),gainPerStart:gain,meanAfterReplacement:mean+gain,remainingGap:Math.max(0,target-mean-gain),reachesTarget:mean+gain>=target-1e-9};};
 const shortfall=buckets.reduce((a,b)=>a+b.shortfallFromTargetPerStart,0),surplus=buckets.reduce((a,b)=>a+b.surplusFromTargetPerStart,0);
 return {n,target,mean,gap:Math.max(0,target-mean),buckets,grossShortfallPerStart:shortfall,grossSurplusPerStart:surplus,netShortfallPerStart:shortfall-surplus,
  below8Repair:[8,12,15,maxScore].map(to=>hypotheticalRepair(s=>s<8,to)),
  onePointUpgradesNeeded:Math.ceil(Math.max(0,(target-mean)*n)-1e-9),
  eligibleForOnePointCount:rows.filter(r=>r.score<maxScore).reduce((a,r)=>a+r.count,0),
  interpretation:'全開始の集計に対する算術的な置換例。救済の実現可能性・カードの因果効果・新方略の成績を示さない。少数の得点帯から場面別の攻略傾向を推論しない。'};
}
export function scoreMigration(before,after){
 if(before.length!==after.length||[...before,...after].some(r=>!Number.isInteger(r.score)||r.score>16||r.reroll||r.research?.initial))throw Error('選別なしの同数の開始が必要');
 const comparison=pairedOutcomes(before,after);
 if(comparison.n!==before.length||comparison.firstOfferMismatches!==0)throw Error('全開始と初回提示の一致が必要');
 const lookup=new Map(after.map(r=>[r.seed,r])),n=before.length,pairs=before.map(a=>[a,lookup.get(a.seed)]);
 const bands=[['below8',s=>s<8],['8-9',s=>s>=8&&s<10],['10-11',s=>s>=10&&s<12],['12',s=>s===12],['13',s=>s===13],['14',s=>s===14],['15-16',s=>s>=15]];
 const byBefore=bands.map(([id,test])=>{const rows=pairs.filter(([a])=>test(a.score)),gained=rows.reduce((s,[a,b])=>s+Math.max(0,b.score-a.score),0),lost=rows.reduce((s,[a,b])=>s+Math.max(0,a.score-b.score),0);return {id,count:rows.length,improvedCount:rows.filter(([a,b])=>b.score>a.score).length,declinedCount:rows.filter(([a,b])=>b.score<a.score).length,gainedPoints:gained,lostPoints:lost,netContributionPerStart:(gained-lost)/n};});
 return {n,comparison,byBefore,score13:{before:before.filter(r=>r.score>=13).length,after:after.filter(r=>r.score>=13).length},score14:{before:before.filter(r=>r.score>=14).length,after:after.filter(r=>r.score>=14).length},score15:{before:before.filter(r=>r.score>=15).length,after:after.filter(r=>r.score>=15).length},
  interpretation:'全開始の対応差を変更前の得点帯に分解した事後診断。帯の少数例での優位や、プレイ前に得点帯を識別できることを証明しない。各帯の寄与の和は全開始の対平均差に一致する。'};
}
async function main(){
 const [manifestFile,outFile]=process.argv.slice(2);if(!manifestFile||!outFile)throw Error('集計参照manifestと出力先を指定');
 const manifest=JSON.parse(await readFile(manifestFile,'utf8')),groups=[];
 for(const source of manifest.sources){const bytes=await readFile(source.summary),data=JSON.parse(bytes),group=data.groups[source.group];if(!group)throw Error('対象の完走群がない');groups.push({id:source.id,source:{summary:source.summary,group:source.group,summarySha256:createHash('sha256').update(bytes).digest('hex'),stage:data.manifest.stage,fingerprints:data.manifest.fingerprints,audit:data.audit.filter(a=>a.id===source.group)},diagnosis:diagnoseDistribution(group)});}
 await mkdir(path.dirname(outFile),{recursive:true});await writeFile(outFile,JSON.stringify({generatedAt:new Date().toISOString(),purpose:'低得点救済と中高得点化のどちらが平均12.5に必要かを診断。群を混ぜず、各全250開始で集計する。',newFullGames:0,groups},null,2)+'\n');
 console.log(JSON.stringify(groups.map(({id,diagnosis:d})=>({id,mean:d.mean,gap:d.gap,buckets:d.buckets,repairs:d.below8Repair,onePointUpgradesNeeded:d.onePointUpgradesNeeded})),null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e);process.exitCode=1;});
