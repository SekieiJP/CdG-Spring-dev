#!/usr/bin/env node
/** 公開局面から完走した2群の記録を集計する。カード選択やゲーム操作は行わない。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {compactRecord,readRunBytes,summarizeOutcomes,pairedOutcomes} from './pro-strategy-metrics.mjs';
import {meanInterval,observedCards} from './pro-mean125-metrics.mjs';

const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const policy=m=>JSON.stringify({research:m.research,acquisitionModel:m.acquisitionModel??null,
 acquisitionAblation:m.acquisitionAblation??null,continuationPolicy:m.continuationPolicy??null,
 refreshPolicy:m.refreshPolicy??null,refreshModel:m.refreshModel??null});
const version=m=>JSON.stringify([m.provenance?.strategyVersion,m.provenance?.codeHash,m.cardVersion,m.rankVersion]);
function arm(records,name,minimumSeeds){
 if(records.length<minimumSeeds)throw Error(`各群で最低${minimumSeeds}局面が必要`);
 if(new Set(records.map(r=>r.metadata?.sceneId)).size!==records.length)throw Error('局面IDの欠落・重複');
 for(const r of records){const m=r.metadata;
  if(m?.source!=='counterfactual'||m.reroll||m.research?.initial||m.sceneArm!==name||!m.sceneId||
   !/^[a-f0-9]{64}$/.test(m.sceneBankSha256||'')||!/^[a-f0-9]{64}$/.test(m.sceneObservationSha256||'')||
   !Number.isInteger(m.sceneTurn)||m.sceneTurn<0||m.sceneTurn>7||!Array.isArray(m.forcedChoice))throw Error('局面対照試験の記録が不正');
 }
 if(new Set(records.map(r=>r.metadata.sceneBankSha256)).size!==1||new Set(records.map(r=>policy(r.metadata))).size!==1||
  new Set(records.map(r=>version(r.metadata))).size!==1)throw Error('局面集・後続方略・版の混在');
 // 先頭の強制取得は局面ごとに異なる。同じ選択規則と後続方略であることを上で検査する。
 const outcomes=records.map(r=>({...compactRecord(r),policy:policy(r.metadata)+name}));
 return {outcomes,summary:{...summarizeOutcomes(outcomes,{minimumSeeds}),mean95:meanInterval(outcomes.map(r=>r.score))}};
}
export function compareSceneArms(reference,target,{minimumSeeds=250}={}){
 const a=arm(reference,'reference',minimumSeeds),b=arm(target,'target',minimumSeeds);
 if(reference.length!==target.length)throw Error('2群の局面数が異なる');
 const bySeed=new Map(reference.map(r=>[r.metadata.seed,r]));
 if(bySeed.size!==reference.length)throw Error('参照群のシード重複');
 const pairs=target.map(r=>{const old=bySeed.get(r.metadata.seed),m=r.metadata,n=old?.metadata;
  if(!old||m.sceneId!==n.sceneId||m.sceneTurn!==n.sceneTurn||m.sceneBankSha256!==n.sceneBankSha256||
   m.sceneObservationSha256!==n.sceneObservationSha256||policy(m)!==policy(n)||version(m)!==version(n))throw Error('同一公開局面・同一未来シード・同一後続方略の対でない');
  return [old,r];});
 const changes=predicate=>pairs.map(([x,y])=>Number(predicate(y.result.score))-Number(predicate(x.result.score)));
 const delta=predicate=>{const values=changes(predicate);return {mean:mean(values),interval95:meanInterval(values)};};
 const byTurn={};for(const turn of [...new Set(reference.map(r=>r.metadata.sceneTurn))].sort((x,y)=>x-y)){
  const ar=a.outcomes.filter((_,i)=>reference[i].metadata.sceneTurn===turn),br=b.outcomes.filter((_,i)=>target[i].metadata.sceneTurn===turn);
  byTurn[turn+1]=ar.length>=minimumSeeds?{n:ar.length,...pairedOutcomes(ar,br,{minimumSeeds})}:{n:ar.length,trendSupported:false};
 }
 return {schema:1,n:pairs.length,reference:a.summary,target:b.summary,
  comparison:pairedOutcomes(a.outcomes,b.outcomes,{minimumSeeds}),
  score14RateDifference:delta(s=>s.displayScore>=14),below8RateDifference:delta(s=>s.displayScore<8),
  withdrawalRateDifference:delta(s=>s.withdrawal>0),byTurn,
  referenceCards:observedCards(reference),targetCards:observedCards(target),
  interpretation:'旧方略の公開局面分布に対する取得変更の完走対照試験。開始からの平均12.5達成の検証や全デッキでのカード優劣ではない。時期・相性の細分は250局面未満なら傾向と扱わない。'};
}
async function main(){
 const [manifestFile,outFile]=process.argv.slice(2);if(!manifestFile||!outFile)throw Error('manifest output-file が必要');
 const manifest=JSON.parse(await readFile(manifestFile,'utf8')),groups={},audit=[];
 for(const run of manifest.runs){const records=[];for(const file of run.files){const bytes=await readRunBytes(file),d=JSON.parse(bytes);
  if(d.simulations?.length!==1)throw Error('1ファイル1方略が必要');
  records.push(...d.simulations[0].playRecords);audit.push({id:run.id,file,sha256:createHash('sha256').update(bytes).digest('hex')});}
  groups[run.id]=records;}
 const result={generatedAt:new Date().toISOString(),manifest,audit,comparisons:{}};
 for(const c of manifest.comparisons)result.comparisons[c.id]=compareSceneArms(groups[c.before],groups[c.after]);
 await mkdir(path.dirname(outFile),{recursive:true});await writeFile(outFile,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(Object.fromEntries(Object.entries(result.comparisons).map(([id,r])=>[id,{n:r.n,reference:r.reference.mean,target:r.target.mean,comparison:r.comparison,byTurn:r.byTurn}]))));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e);process.exitCode=1;});
