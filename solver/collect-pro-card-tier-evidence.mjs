#!/usr/bin/env node
// Aggregate archived browser play records only; no game trials.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src=path.resolve(process.argv[2] || root);
const output=path.join(root,'solver/research-results/pro-card-tier-20261006/evidence.json');
let commonSeeds, commonVersions;
const {readRunBytes}=await import(path.join(src,'solver/pro-strategy-metrics.mjs'));
const {observedCards}=await import(path.join(src,'solver/pro-mean125-metrics.mjs'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const reportFile=path.join(src,'solver/research-results/pro-strategy-20261003/validation.json'),reportBytes=await readFile(reportFile),report=JSON.parse(reportBytes);
const result={createdAt:new Date().toISOString(),scope:'通常PRO、6方略各1000、共通の1000開始。新規試行ではなく過去記録の記述集計。',sourceReport:'solver/research-results/pro-strategy-20261003/validation.json',sourceReportSha256:sha(reportBytes),groups:{},audit:[]};
for(const run of report.manifest.runs){const seeds=new Set(),rows=new Map(),versions=new Set();
 for(const f of run.files){const bytes=await readRunBytes(path.join(src,f)),data=JSON.parse(bytes),records=data.simulations?.[0]?.playRecords;
  if(data.simulations?.length!==1||records?.length!==250)throw Error('expected completed batches of 250');
  for(const r of records){const m=r.metadata;if(m.difficulty!=='pro'||m.source!=='autoplay'||m.reroll||r.truncated||!Number.isFinite(r.result?.score?.displayScore)||seeds.has(m.seed))throw Error('bad complete records');seeds.add(m.seed);versions.add(JSON.stringify([m.provenance.codeHash,m.cardVersion,m.rankVersion]));}
  for(const c of observedCards(records)){let row=rows.get(c.cardNo);if(!row){row={cardNo:c.cardNo,name:c.name,rarity:c.rarity,gamesOffered:0,gamesAcquired:0,drawn:0,placed:0,applied:0,meaningful:0,stats:{experience:0,enrollment:0,satisfaction:0,accounting:0},tokens:{passion:0,fatigue:0,inspiration:0,organize:0},placedByStaff:{},acquisitionTurns:{}};rows.set(c.cardNo,row);}
   for(const k of ['gamesOffered','gamesAcquired','drawn','placed','applied','meaningful'])row[k]+=c[k];
   for(const k of ['stats','tokens','placedByStaff','acquisitionTurns'])for(const [key,value]of Object.entries(c[k]))row[k][key]=(row[k][key]||0)+value;
  }
  result.audit.push({group:run.id,file:f,sha256:sha(bytes),n:records.length});
 }
 if(seeds.size!==1000||versions.size!==1||rows.size!==51)throw Error('source coverage mismatch');
 const sortedSeeds=JSON.stringify([...seeds].sort((a,b)=>String(a).localeCompare(String(b))));
 const version=[...versions][0];
 if(commonSeeds!==undefined && (commonSeeds!==sortedSeeds || commonVersions!==version))throw Error('policies do not share the same 1000 starts and physics');
 commonSeeds=sortedSeeds;commonVersions=version;
 result.groups[run.id]={n:1000,description:run.description,versions:JSON.parse([...versions][0]),cards:[...rows.values()]};
 console.log('Collected '+run.id+' : '+seeds.size+' completed starts, '+rows.size+' cards');
}
result.commonStartCount=1000;
result.commonSeedSetSha256=sha(Buffer.from(commonSeeds));
await mkdir(path.dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(result,null,2)+'\n');
