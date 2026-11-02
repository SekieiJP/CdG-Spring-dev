#!/usr/bin/env node
/** 判断時の公開情報と、過去の行動・最終結果を分離して保存する。ゲーム操作は行わない。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {publicScene} from './pro-card-scene-input.mjs';
import {auditAhiruBatch,assessStability} from './ahiru-pro-metrics.mjs';
import {readRunBytes} from './pro-strategy-metrics.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),KEYS=['experience','enrollment','satisfaction','accounting'];
export function extractAhiruDecisionRows(record,{gameId}){
 const m=record.metadata,score=record.result?.score;
 if(m?.difficulty!=='pro'||m.source!=='autoplay'||m.reroll||m.research?.initial||m.calcMode||m.eventId||record.truncated||!gameId||!Number.isFinite(score?.displayScore)||KEYS.some(k=>!Number.isFinite(score[k])))throw Error('通常PROのリセマラなし全完走記録が必要');
 const publicRows=[],labels=[];let ordinal=0;
 for(const event of record.events){
  if(!['research-acquisition-decision','research-deletion-decision'].includes(event.type))continue;
  const phase=event.type==='research-acquisition-decision'?'acquisition':'deletion',o=publicScene(event.observation);
  if(o.difficulty!=='pro'||o.mode!=='normal'||o.totalTurns!==8||!Number.isInteger(o.turn)||o.turn<0||o.turn>7||event.turn!==o.turn||Object.values(o.stats).some(v=>!Number.isFinite(v)||v<0)||Object.values(o.tokens).some(v=>!Number.isInteger(v)||v<0))throw Error('判断局面の公開状態が不正');
  const rowId=`${gameId}-decision-${ordinal++}`;
  let action;
  if(phase==='acquisition'){
   const indices=event.chosenIndices;
   if(!Array.isArray(indices)||new Set(indices).size!==indices.length||indices.some(i=>!Number.isInteger(i)||i<0||i>=o.candidates.length)||![1,2].includes(o.pickCount)||!(indices.length===o.pickCount||o.allowSkip&&indices.length===0))throw Error('実取得の番号・枚数が不正');
   action={indices:[...indices],cardNos:indices.map(i=>String(o.candidates[i].cardNo)),skipped:indices.length===0};
  }else{
   if(!Number.isInteger(event.deleteMax)||event.deleteMax<0||!Array.isArray(event.decisions)||event.decisions.length>event.deleteMax)throw Error('実削除の枚数が不正');
   const available=o.owned.map(c=>String(c.cardNo)),deleted=[];
   for(const decision of event.decisions){const no=String(decision.cardNo),index=available.indexOf(no);if(index<0)throw Error('所有していない札の削除');available.splice(index,1);deleted.push(no);}
   action={cardNos:deleted,deleteMax:event.deleteMax};
  }
  publicRows.push({rowId,gameId,phase,...(phase==='deletion'?{deleteMax:event.deleteMax}:{}),observation:o});labels.push({rowId,gameId,action});
 }
 if(!publicRows.length)throw Error('取得・削除の公開判断がない');
 return {publicRows,labels,outcome:{gameId,score:score.displayScore,grade:score.rank?.grade??null,stats:Object.fromEntries(KEYS.map(k=>[k,score[k]])),withdrawal:score.withdrawal,enrollmentDiff:score.enrollmentDiff},weightPerDecision:1/publicRows.length};
}
async function main(){
 const [manifestFile,groupId,outputDir]=process.argv.slice(2),diagnostic=process.argv.includes('--diagnostic');
 if(!manifestFile||!groupId||!outputDir)throw Error('manifest group output [--diagnostic] が必要');
 const manifestBytes=await readFile(manifestFile),manifest=JSON.parse(manifestBytes),run=manifest.runs.find(r=>r.id===groupId);
 if(!run||![250,2000].includes(manifest.n)||run.files.length!==manifest.n/250||!diagnostic&&(manifest.phase!=='validation'||manifest.n!==2000))throw Error('達成方略の固定2000開始、または明示した開発診断が必要');
 const publicRows=[],labels=[],outcomes=[],sources=[],sourceSeeds=new Set(),roots=[];let next=0;
 for(let b=0;b<run.files.length;b++){
  const file=run.files[b],bytes=await readRunBytes(file),data=JSON.parse(bytes),records=auditAhiruBatch(data,{seed:manifest.seed,offset:b*250,config:run.config,fingerprints:manifest.fingerprints});
  for(const r of records){if(sourceSeeds.has(r.metadata.seed))throw Error('元開始の重複');sourceSeeds.add(r.metadata.seed);
   const gameId=`game-${next++}`,rows=extractAhiruDecisionRows(r,{gameId});publicRows.push(...rows.publicRows);labels.push(...rows.labels);outcomes.push(rows.outcome);roots.push({gameId,weightPerDecision:rows.weightPerDecision,sourceSeed:r.metadata.seed});
  }
  sources.push({file,sha256:sha(bytes),n:records.length,offset:b*250});
 }
 if(next!==manifest.n)throw Error('全開始がそろっていない');
 const assessment=assessStability(outcomes.map(r=>r.score));if(!diagnostic&&!assessment.passed)throw Error('2000シードの達成条件を満たしていない');
 const counts={games:next,decisions:publicRows.length,acquisition:publicRows.filter(r=>r.phase==='acquisition').length,deletion:publicRows.filter(r=>r.phase==='deletion').length};
 const input={schema:'ahiru-public-decisions-v1',purpose:'判断時の公開情報だけ。行動と実際の最終結果は別ファイル。未公開の未来順序・実seed・結果を新規判断に渡さない。',rows:publicRows};
 const teachers={schema:'ahiru-decision-teachers-v1',purpose:'過去の行動と公式結果。指針候補や校正の材料であり、個別選択の因果効果は示さない。',labels,outcomes,roots:roots.map(({sourceSeed,...r})=>r)};
 const audit={createdAt:new Date().toISOString(),purpose:diagnostic?'開発診断。達成方略の攻略指針の完成とは呼ばない。':'全2000開始で条件を満たした方略の観測材料。簡略指針・セリフの品質は別に検証する。',diagnostic,assessment,counts,manifestFile,manifestSha256:sha(manifestBytes),sourceActor:manifest.fingerprints.strategyVersion,physical:manifest.fingerprints,config:run.config,sources,allStartsAccepted:true,rerolls:0,sourceSeedsUnique:true,phaseCounts:publicRows.reduce((out,r)=>{const key=r.phase+'-turn-'+r.observation.turn;out[key]=(out[key]||0)+1;return out;},{}),selection:'全完走の全取得・削除判断を記録順に採用。成績による除外なし。250元開始未満の下位群は傾向の主張に使わない。',generatorSha256:sha(await readFile('solver/ahiru-decision-dataset.mjs'))};
 await mkdir(outputDir,{recursive:true});
 for(const [name,data] of [['public-decisions.json',input],['teachers.json',teachers],['source-seeds.private.json',roots]])await writeFile(path.join(outputDir,name),JSON.stringify(data)+'\n');
 audit.publicInputSha256=sha(await readFile(path.join(outputDir,'public-decisions.json')));audit.teachersSha256=sha(await readFile(path.join(outputDir,'teachers.json')));
 await writeFile(path.join(outputDir,'audit.json'),JSON.stringify(audit,null,2)+'\n');console.log(JSON.stringify({counts,assessment,diagnostic}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e);process.exitCode=1;});
