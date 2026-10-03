#!/usr/bin/env node
/** 記録の集計。ゲームの判断・実行は行わない。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {initialPairIndices,validateInitialRule} from './browser/pro-strategy-research.js';
import {loadRuns,readRunBytes,summarizeOutcomes,pairedOutcomes,wilson,median} from './pro-strategy-metrics.mjs';
/** 本体の初回は12種から異なる4種を一様提示する。物理24枚からの単純抽出ではない。 */
export function startProbability(pairs=null){
 const rule={pairs};validateInitialRule(rule);let accepted=0,total=0;
 for(let a=6;a<=14;a++)for(let b=a+1;b<=15;b++)for(let c=b+1;c<=16;c++)for(let d=c+1;d<=17;d++){
  total++;if(initialPairIndices([a,b,c,d].map(cardNo=>({cardNo})),pairs).length)accepted++;
 }
 return {accepted,total,probability:accepted/total,expectedResets:total/accepted-1};
}
export function effortEstimate(successRate,q,ratios=[0,.01,.05,.1]){
 return {assumption:'independent starts; initial-only reset; fixed reset/full-game duration ratio; unchanged continuation policy',
  expectedCompletedGames:successRate>0?1/successRate:null,
  expectedResets:successRate>0?(1/q-1)/successRate:null,
  expectedStarts:successRate>0?1/(q*successRate):null,
  equivalentFullGameDurations:ratios.map(resetToFullGame=>({resetToFullGame,value:successRate>0?(1+(1/q-1)*resetToFullGame)/successRate:null}))};
}
export function compareEffortRates(beforeRate,beforeQ,afterRate,afterQ){
 if(beforeRate<=0||afterRate<=0)return {breakEvenResetRatioPointEstimate:null,afterBetterFor:null};
 const intercept=1/afterRate-1/beforeRate,slope=(1/afterQ-1)/afterRate-(1/beforeQ-1)/beforeRate;
 const crossing=slope!==0?-intercept/slope:null;
 const positiveCrossing=crossing!==null&&crossing>=0?crossing:null;
 return {breakEvenResetRatioPointEstimate:positiveCrossing,
  afterBetterFor:positiveCrossing!==null?(slope>0?'below_break_even':'above_break_even'):
   intercept<=0&&slope<=0?'all_nonnegative':intercept>=0&&slope>=0?'none_nonnegative':null};
}
export function auditRerolls(outcomes,config){
 if(!config.initial)return {n:outcomes.length,reroll:false};
 if(new Set(outcomes.map(r=>r.actualSeed)).size!==outcomes.length)throw Error('完走ゲームの乱数シード重複');
 const matches=cards=>initialPairIndices(cards.map(cardNo=>({cardNo})),config.initial.pairs);
 for(const r of outcomes){const meta=r.reroll;if(!meta||meta.sessionSeed!==r.seed||meta.attempts!==meta.rejectedStarts.length+1||meta.initialRefreshUsed!==0||r.initialRefreshUsed!==0)throw Error('リセット回数・記録が不正');
  if(meta.initialCards.length!==4||new Set(meta.initialCards.map(String)).size!==4||!matches(meta.initialCards).some(a=>String(a)===String(meta.chosenIndices)))throw Error('初期選択が開始条件に合いません');
  if(JSON.stringify(r.initialPicks)!==JSON.stringify(meta.chosenIndices.map(i=>String(meta.initialCards[i]))))throw Error('取得イベントと初期選択が不一致');
  for(const [i,rejected]of meta.rejectedStarts.entries()){
   const expected=i?`${r.seed.replace(/:(\d+)$/,`-reset${i}:$1`)}`:r.seed;
   if(rejected.seed!==expected||rejected.cards.length!==4||new Set(rejected.cards.map(String)).size!==4||matches(rejected.cards).length)throw Error('不適切な初期リセット');
  }
  const expected=meta.attempts===1?r.seed:r.seed.replace(/:(\d+)$/,`-reset${meta.attempts-1}:$1`);
  if(r.actualSeed!==expected)throw Error('受け入れた実ゲームのシードが不正');
 }
 return {n:outcomes.length,distinctAcceptedSeeds:new Set(outcomes.map(r=>r.actualSeed)).size,reroll:true,allRejectedFailCondition:true,allAcceptedMeetCondition:true,initialRefreshUsed:0};
}
export async function rerollSummary(manifest){
 const groups={},summary={generatedAt:new Date().toISOString(),stage:manifest.stage,n:manifest.n,seed:manifest.seed,groups:{},comparisons:{},files:[]};
 for(const run of manifest.runs){const data=await loadRuns(run.files),config=JSON.parse(run.description);groups[run.id]=data;
  const attempts=data.map(r=>r.reroll?.attempts||1),totalStarts=attempts.reduce((s,v)=>s+v,0),prob=startProbability(config.initial?.pairs??null),outcome=summarizeOutcomes(data);
  const pickedPairs={};for(const r of data)if(r.reroll){const m=r.reroll,key=m.chosenIndices.map(i=>Number(m.initialCards[i])).sort((a,b)=>a-b).join('-');pickedPairs[key]=(pickedPairs[key]||0)+1;}
  summary.groups[run.id]={config,...outcome,audit:auditRerolls(data,config),initialRefreshMean:data.reduce((sum,r)=>sum+r.initialRefreshUsed,0)/data.length,starts:{theoretical:prob,totalStarts,resets:totalStarts-data.length,observedAcceptance:data.length/totalStarts,
   meanResets:totalStarts/data.length-1,medianResets:median(attempts)-1,maxResets:Math.max(...attempts)-1},pickedPairs,
   cardActivity:Object.fromEntries([7,10,11,13,15,16,17,40,49].map(no=>[no,{
    acquiredRate:data.filter(r=>r.cards[no]?.acquired>0).length/data.length,
    meanPlaced:data.reduce((sum,r)=>sum+(r.cards[no]?.placed||0),0)/data.length,
    meanDeleted:data.reduce((sum,r)=>sum+(r.cards[no]?.deleted||0),0)/data.length,
    meanApplied:data.reduce((sum,r)=>sum+(r.cards[no]?.applied||0),0)/data.length,
    meanPlacedByStaff:Object.fromEntries(['leader','teacher','staff'].map(slot=>[slot,data.reduce((sum,r)=>sum+(r.cards[no]?.placedByStaff?.[slot]||0),0)/data.length]))
   }])),
   effort:effortEstimate(outcome.score15.rate,prob.probability),
   effort95:outcome.score15.interval95.map(p=>effortEstimate(p,prob.probability)),
   examples15:data.filter(r=>r.score>=15).slice(0,4).map(r=>({sessionSeed:r.seed,actualSeed:r.actualSeed,score:r.score,stats:r.stats,turnStats:r.turnStats,initial:r.reroll,deck:r.finalDeck}))};
  for(const file of run.files){const bytes=await readRunBytes(file),d=JSON.parse(bytes);summary.files.push({file:path.relative(process.cwd(),file),sha256:createHash('sha256').update(bytes).digest('hex'),episodes:d.settings.episodes,episodeOffset:d.settings.episodeOffset,seed:d.settings.seed,research:d.settings.research,provenance:d.settings.provenance});}
 }
 for(const c of manifest.comparisons||[]){const before=summary.groups[c.before],after=summary.groups[c.after],q=after.starts.theoretical.probability;
  summary.comparisons[c.id]={...c,...pairedOutcomes(groups[c.before],groups[c.after]),
   ...compareEffortRates(before.score15.rate,before.starts.theoretical.probability,after.score15.rate,q)};
 }
 return summary;
}
async function main(){const [input,dir]=process.argv.slice(2);if(!input||!dir)throw Error('manifest.json outputDir');const manifest=JSON.parse(await readFile(input,'utf8')),summary=await rerollSummary(manifest);
 await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'summary.json'),JSON.stringify(summary,null,2)+'\n');
 const lines=['id,n,median,mean,p10,15_count,15_rate,q,mean_resets,expected_completed,expected_resets'];
 for(const [id,s]of Object.entries(summary.groups))lines.push([id,s.n,s.median,s.mean,s.p10,s.score15.count,s.score15.rate,s.starts.theoretical.probability,s.starts.meanResets,s.effort.expectedCompletedGames,s.effort.expectedResets].join(','));
 await writeFile(path.join(dir,'summary.csv'),lines.join('\n')+'\n');console.log(lines.join('\n'));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e);process.exitCode=1;});
