#!/usr/bin/env node
/** 公式完走記録の照合・統計だけ。判断と操作はブラウザで実行する。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readRunBytes,compactRecord,summarizeOutcomes,wilson,pairedOutcomes} from './pro-strategy-metrics.mjs';
import {meanInterval} from './pro-mean125-metrics.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),sha=b=>createHash('sha256').update(b).digest('hex');
export function auditAhiruBatch(data,{seed,offset,config,fingerprints,episodes=250}){
 const s=data.settings,rs=data.simulations?.[0]?.playRecords;
 if(!s||s.seed!==seed||s.episodeOffset!==offset||s.episodes!==episodes||s.difficulty!=='pro'||!same(s.research,config)||s.initialObservation||s.forcedChoice||s.sceneBatch||s.provenance?.strategyVersion!==fingerprints.strategyVersion||s.provenance?.codeHash!==fingerprints.codeHash||data.simulations.length!==1||rs?.length!==episodes)throw Error('開始・設定・版・全完走数の不一致');
 for(let i=0;i<episodes;i++){
  const r=rs[i],m=r.metadata,turns=r.events?.filter(e=>e.type==='research-placement-decision');
  if(!m||m.difficulty!=='pro'||m.source!=='autoplay'||m.reroll||m.research?.initial||m.sceneId||m.forcedChoice||m.calcMode||m.eventId||r.truncated||!Number.isFinite(r.result?.score?.displayScore)||m.seed!==`${seed}:${offset+i}`||!same(m.research,config)||m.provenance?.strategyVersion!==fingerprints.strategyVersion||m.provenance?.codeHash!==fingerprints.codeHash||m.cardVersion!==fingerprints.cardVersion||m.rankVersion!==fingerprints.rankVersion||turns?.length!==8||turns.some((e,t)=>e.turn!==t)||r.events.some(e=>e.type==='research-counterfactual-start'))throw Error('全開始・8配置・リセマラなし・公式得点・固定版の監査不一致');
 }
 return rs;
}
export function assessStability(scores,{requiredSeeds=1000}={}){
 if(![1000,2000].includes(requiredSeeds))throw Error('到達確認は1000開始、旧計画の再監査のみ2000開始');
 if(!scores.length||scores.some(s=>!Number.isFinite(s)))throw Error('有限な公式得点が必要');
 const n=scores.length,mean=scores.reduce((s,v)=>s+v,0)/n,lowCount=scores.filter(s=>s<=8).length;
 return {n,mean,atMost8:{count:lowCount,rate:lowCount/n,interval95:wilson(lowCount,n)},requirements:{seeds:requiredSeeds,meanAtLeast:12,scoreCutoffInclusive:8,lowRateStrictlyBelow:.02},passed:n===requiredSeeds&&mean>=12&&lowCount*100<2*n};
}
export function selectPilotCandidate(groups){
 if(Object.values(groups).some(g=>g.n!==250))throw Error('各250開始の全条件を確認する');
 return Object.entries(groups).filter(([,g])=>g.mean>=12&&g.atMost8.count<=4).sort((a,b)=>a[1].atMost8.count-b[1].atMost8.count||b[1].mean-a[1].mean)[0]?.[0]??null;
}
async function main(){
 const [file,output]=process.argv.slice(2);if(!file||!output)throw Error('manifest.json output.json が必要');
 const manifest=JSON.parse(await readFile(file)),validation=manifest.phase==='validation';
 if(!['development','validation'].includes(manifest.phase)||(validation?![1000,2000].includes(manifest.n):manifest.n!==250)||validation&&manifest.runs.length!==1)throw Error('固定した開発250/検証1000（旧2000も再監査可）の計画が必要');
 const summary={createdAt:new Date().toISOString(),purpose:'PRO・全開始採用。8点以下を含む低得点率。予測・局面継続ではなく実ゲームの公式得点。',manifest,groups:{},comparisons:{},audit:[]},outcomes={};
 for(const run of manifest.runs){
  if(run.files.length!==manifest.n/250||run.config.initial)throw Error('全バッチとリセマラなしの固定方略が必要');
  const all=[];
  for(let b=0;b<run.files.length;b++){
   const bytes=await readRunBytes(run.files[b]),d=JSON.parse(bytes),records=auditAhiruBatch(d,{seed:manifest.seed,offset:b*250,config:run.config,fingerprints:manifest.fingerprints});
   summary.audit.push({id:run.id,file:run.files[b],sha256:sha(bytes),n:records.length,offset:b*250});all.push(...records.map(compactRecord));
  }
  const s=summarizeOutcomes(all),requirement=assessStability(all.map(r=>r.score),{requiredSeeds:validation?manifest.n:1000});
  const {retries,...stats}=s;summary.groups[run.id]={...stats,...requirement,mean95:meanInterval(all.map(r=>r.score)),interpretation:validation?'調整と異なる固定全開始。達成判定は観測平均と全低得点件数。':'候補選択に使う開発250開始。達成の証明ではない。'};outcomes[run.id]=all;
 }
 if(!validation){summary.selectedCandidate=selectPilotCandidate(summary.groups);if(outcomes.baseline)for(const id of Object.keys(outcomes).filter(i=>i!=='baseline'))summary.comparisons[id]=pairedOutcomes(outcomes.baseline,outcomes[id]);}
 summary.planPassed=validation&&Object.values(summary.groups).every(g=>g.passed);
 summary.goalPassed=manifest.n===1000&&summary.planPassed;
 await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(summary,null,2)+'\n');
 console.log(JSON.stringify({groups:Object.fromEntries(Object.entries(summary.groups).map(([id,g])=>[id,{n:g.n,mean:g.mean,mean95:g.mean95,atMost8:g.atMost8,passed:g.passed}])),selectedCandidate:summary.selectedCandidate,goalPassed:summary.goalPassed},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e);process.exitCode=1;});
