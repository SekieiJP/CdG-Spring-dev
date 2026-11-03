#!/usr/bin/env node
/** 実プレイ記録の統計のみ。ブラウザ方略の判断・実ゲームを実行しない。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readRunBytes,compactRecord,summarizeOutcomes} from './pro-strategy-metrics.mjs';
import {scoreMigration} from './pro-score-distribution.mjs';
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
export function meanInterval(scores,iterations=2000){let n=0x1235125,values=[];const rand=()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);
 if(!scores.length)return [null,null];for(let i=0;i<iterations;i++){let total=0;for(let j=0;j<scores.length;j++)total+=scores[Math.floor(rand()*scores.length)];values.push(total/scores.length);}values.sort((a,b)=>a-b);return [values[Math.ceil(iterations*.025)-1],values[Math.ceil(iterations*.975)-1]];}
export function observedCards(records){
 const catalog=records[0].metadata.catalog||[],rows=Object.fromEntries(catalog.map(c=>[String(c.cardNo),{cardNo:String(c.cardNo),name:c.cardName,rarity:c.rarity,category:c.category,gamesOffered:0,gamesAcquired:0,acquisitionTurns:{},drawn:0,placed:0,applied:0,failed:0,meaningful:0,placedByStaff:{},stats:{experience:0,enrollment:0,satisfaction:0,accounting:0},tokens:{passion:0,fatigue:0,inspiration:0,organize:0},scoresWhenAcquired:[],scoresWhenNotAcquired:[]} ]));
 for(const record of records){const acquired=new Set(),offered=new Set();
  for(const event of record.events){if(event.type==='offer')for(const c of event.cards)offered.add(String(c.cardNo));
   if(event.type==='acquire'){const row=rows[String(event.card.cardNo)];if(!row)continue;acquired.add(String(event.card.cardNo));row.acquisitionTurns[event.turn]=(row.acquisitionTurns[event.turn]||0)+1;}
   if(event.type==='draw')for(const c of event.cards)if(rows[String(c.cardNo)])rows[String(c.cardNo)].drawn++;
   if(event.type==='place'){const row=rows[String(event.card.cardNo)];if(row){row.placed++;row.placedByStaff[event.staff]=(row.placedByStaff[event.staff]||0)+1;}}
   if(event.type==='resolve'){const row=rows[String(event.cardNo)];if(!row)continue;event.applied?row.applied++:row.failed++;
    let active=false;for(const key of Object.keys(row.stats)){const delta=event.afterStats[key]-event.beforeStats[key];row.stats[key]+=delta;active||=delta!==0;}
    for(const key of Object.keys(row.tokens)){const delta=(event.afterTokens[key]||0)-(event.beforeTokens[key]||0);row.tokens[key]+=delta;active||=delta!==0;}if(active)row.meaningful++;}
  }
  for(const [no,row] of Object.entries(rows)){if(offered.has(no))row.gamesOffered++;if(acquired.has(no)){row.gamesAcquired++;row.scoresWhenAcquired.push(record.result.score.displayScore);}else row.scoresWhenNotAcquired.push(record.result.score.displayScore);}
 }
 return Object.values(rows).map(row=>{const {scoresWhenAcquired,scoresWhenNotAcquired,...output}=row;return {...output,scoreMeanWhenAcquired:mean(scoresWhenAcquired),scoreMeanWhenNotAcquired:mean(scoresWhenNotAcquired),
  descriptiveOnly:true,trendSupportAtLeast250:row.gamesAcquired>=250,meaningfulPerPlacement:row.placed?row.meaningful/row.placed:null,
  notes:'保有と得点の共起は因果効果ではない。直接変化量は実際の条件・コスト・上限を適用した解決記録。相性・取得時期の優位は別途対照試験が必要。'};}).sort((a,b)=>Number(a.cardNo)-Number(b.cardNo));
}
export function predictionCalibration(records){
 const rows=[];
 for(let turn=0;turn<8;turn++){
  const pairs=records.map(r=>{const e=r.events.find(e=>e.type==='research-acquisition-decision'&&e.turn===turn&&!e.observation?.allowSkip),predicted=e?.advice?.recommended?.mean??e?.advice?.recommended?.predictedScore;return Number.isFinite(predicted)?[predicted,r.result.score.displayScore]:null;}).filter(Boolean);
  if(!pairs.length)continue;const differences=pairs.map(([predicted,actual])=>predicted-actual);
  rows.push({turn,n:pairs.length,minimum250:pairs.length>=250,predictedMean:mean(pairs.map(p=>p[0])),actualMean:mean(pairs.map(p=>p[1])),bias:mean(differences),bias95:meanInterval(differences),meanAbsoluteError:mean(differences.map(Math.abs)),
   interpretation:'主研修の選択後の推定値。仮想将来または学習時の後続方略に対する値で、実際の後続方略の差と選択後の分布変化も誤差に含む。'});
 }
 return rows;
}
export function deletionCoverage(records){
 const turns=Array.from({length:8},()=>[]);let gamesBelow5=0;
 for(const r of records){let below=false;for(const e of r.events.filter(e=>e.type==='research-deletion-decision')){const n=e.observation.owned.length-e.decisions.length;turns[e.turn].push(n);below||=n<5;}gamesBelow5+=Number(below);}
 return {n:records.length,gamesBelow5,descriptiveOnly:true,byTurn:turns.map((rows,turn)=>({turn,n:rows.length,minimum250:rows.length>=250,min:rows.length?Math.min(...rows):null,mean:mean(rows),below5Count:rows.filter(n=>n<5).length})),
  interpretation:'保持枚数の条件が実際に働いた頻度。少数の圧縮事例の効果を一般化しない。'};
}
export function forecastStatsCalibration(records){
 return Array.from({length:8},(_,turn)=>{const pairs=records.map(r=>{const e=r.events.find(e=>e.type==='research-acquisition-decision'&&e.turn===turn&&!e.observation?.allowSkip),p=e?.advice?.recommended?.forecast;return p?[p,r.result.score]:null;}).filter(Boolean);
  return {turn,n:pairs.length,minimum250:pairs.length>=250,axes:Object.fromEntries(['experience','enrollment','satisfaction','accounting'].map(k=>{const errors=pairs.map(([p,a])=>p[k]-a[k]);return [k,{bias:mean(errors),bias95:meanInterval(errors),meanAbsoluteError:mean(errors.map(Math.abs))}];})),
   interpretation:'旧固定式の所有集合の投影と実際の最終値。後から取得するカードと実際の操作方略の差を含む。学習予測自体のパラメータ推定ではない。'};
 });
}
async function main(){
 const [manifestFile,outDir]=process.argv.slice(2);if(!manifestFile||!outDir)throw Error('manifestと出力先を指定');
 const manifest=JSON.parse(await readFile(manifestFile,'utf8')),summary={generatedAt:new Date().toISOString(),manifest,groups:{},comparisons:{},audit:[]},outcomesByGroup={};
 for(const run of manifest.runs){let records=[];for(const file of run.files){const bytes=await readRunBytes(file),data=JSON.parse(bytes),batch=data.simulations?.[0]?.playRecords;
   if(!batch?.length||data.simulations.length!==1)throw Error('1ファイル1方略の完走記録が必要');
   if(batch.some(r=>r.metadata.reroll||r.metadata.research?.initial))throw Error('一発勝負の評価へリセマラを混ぜない');
   if(manifest.fingerprints&&batch.some(r=>r.metadata.provenance.strategyVersion!==manifest.fingerprints.strategyVersion||r.metadata.provenance.codeHash!==manifest.fingerprints.codeHash||r.metadata.cardVersion!==manifest.fingerprints.cardVersion||r.metadata.rankVersion!==manifest.fingerprints.rankVersion))throw Error('実行設定と記録の版が異なる');
   summary.audit.push({id:run.id,file,sha256:createHash('sha256').update(bytes).digest('hex'),n:batch.length,version:data.settings.provenance.strategyVersion});records.push(...batch);}
  const outcomes=records.map(compactRecord),stats=summarizeOutcomes(outcomes),cat=outcomes.filter(r=>r.score<8),w0=outcomes.filter(r=>r.stats.withdrawal===0),w1=outcomes.filter(r=>r.stats.withdrawal>0);
  outcomesByGroup[run.id]=outcomes;summary.groups[run.id]={description:run.description,...stats,score13:{count:outcomes.filter(r=>r.score>=13).length,rate:outcomes.filter(r=>r.score>=13).length/outcomes.length},mean95:meanInterval(outcomes.map(r=>r.score)),resets:0,predictionCalibration:predictionCalibration(records),forecastStatsCalibration:forecastStatsCalibration(records),deletionCoverage:deletionCoverage(records),
   failure:{below8Count:cat.length,below8Mean:mean(cat.map(r=>r.score)),noWithdrawalCount:w0.length,noWithdrawalMean:mean(w0.map(r=>r.score)),withdrawalCount:w1.length,withdrawalMean:mean(w1.map(r=>r.score))},
   analysis:'developmentは方略の選択用。mean125達成は独立した1000シード以上の検証で判断する。',cards:observedCards(records),
   examplesHigh:outcomes.filter(r=>r.score>=14).slice(0,5).map(r=>({seed:r.seed,score:r.score,stats:r.stats,turnStats:r.turnStats,deck:r.finalDeck}))};
 }
 for(const c of manifest.comparisons||[]){const {comparison,...migration}=scoreMigration(outcomesByGroup[c.before],outcomesByGroup[c.after]);summary.comparisons[c.id]={...c,...comparison,migration};}
 await mkdir(outDir,{recursive:true});await writeFile(path.join(outDir,'summary.json'),JSON.stringify(summary,null,2)+'\n');
 console.log(JSON.stringify({groups:Object.fromEntries(Object.entries(summary.groups).map(([id,s])=>[id,{n:s.n,mean:s.mean,mean95:s.mean95,median:s.median,p10:s.p10,below8:s.failure.below8Count,withdrawal:s.failure.withdrawalCount,score15:s.score15.count,stats:s.meanStats,activity:s.activity}])),comparisons:summary.comparisons},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e);process.exitCode=1;});
