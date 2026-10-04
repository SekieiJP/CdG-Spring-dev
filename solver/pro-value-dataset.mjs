#!/usr/bin/env node
/** 実プレイ記録から公開状態と結果の組を抽出する。判断・ゲーム操作は行わない。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readRunBytes} from './pro-strategy-metrics.mjs';
const KEYS=['experience','enrollment','satisfaction','accounting'],TOKENS=['passion','fatigue','inspiration','organize'];
export function packValueObservation(observation,phase){
 const history=new Map();for(const e of observation.offerHistory||[])for(const c of e.cards||[]){const no=Number(c.cardNo),counts=history.get(no)||[no,0,0];counts[e.type==='refresh'?2:1]++;history.set(no,counts);}
 return {phase,turn:observation.turn,stats:KEYS.map(k=>observation.stats[k]),tokens:TOKENS.map(k=>observation.tokens[k]||0),
  owned:observation.owned.map(c=>[Number(c.cardNo),Number(c.acquiredTurn||0)]),history:[...history.values()],refreshRemaining:observation.refreshRemaining||0};
}
export function extractValueRows(record){
 if(record.metadata?.difficulty!=='pro'||record.metadata.reroll||record.truncated||!Number.isFinite(record.result?.score?.displayScore))throw Error('リセマラなしPROの完走記録が必要');
 const rows=[],events=record.events;
 for(const e of events.filter(e=>e.type==='research-acquisition-decision')){
  const o=e.observation,chosen=e.chosenIndices||e.advice.recommended.indices;
  const after={...o,owned:[...o.owned,...chosen.map(i=>o.candidates[i])],tokens:{...o.tokens,inspiration:Math.max(0,o.tokens.inspiration-Number(o.allowSkip))}};
  rows.push(packValueObservation(after,'acquisition'));
 }
 for(const e of events.filter(e=>e.type==='research-placement-decision')){
  const resolved=events.filter(r=>r.type==='resolve'&&r.turn===e.turn),last=resolved.at(-1),stats=last?.afterStats||e.observation.stats,tokens=last?.afterTokens||e.observation.tokens;
  const after={...e.observation,stats:{...stats},tokens:{...tokens},owned:[...e.observation.owned]};
  rows.push(packValueObservation(after,'after-action'));
  if(e.turn>=7)continue;
  const deletion=events.find(d=>d.type==='research-deletion-decision'&&d.turn===e.turn);
  for(const d of deletion?.decisions||[]){const i=after.owned.findIndex(c=>String(c.cardNo)===String(d.cardNo));if(i>=0)after.owned.splice(i,1);}
  after.turn++;after.tokens.organize=0;rows.push(packValueObservation(after,'before-training'));
 }
 if(!rows.length)throw Error('公開状態の研究記録がない');
 return rows.map(observation=>({seed:record.metadata.seed,target:record.result.score.displayScore,weight:1/rows.length,observation}));
}
async function main(){
 const outputDir=process.argv[2]||'solver/local-runs/pro-mean125/value-v1';await mkdir(outputDir,{recursive:true});
 const files=[],sourceIndex=process.argv.indexOf('--sources');
 if(sourceIndex>=0){const manifest=JSON.parse(await readFile(process.argv[sourceIndex+1],'utf8'));for(const split of ['train','validation'])for(const file of manifest[split]||[])files.push({split,file});if(!files.some(f=>f.split==='train')||!files.some(f=>f.split==='validation'))throw Error('学習・検証ソースが必要');}
 else {const stages=['v1-development','v2-development','v4-development','v4b-development'];
 for(const stage of stages)files.push({split:'train',file:`solver/local-runs/pro-mean125/${stage}/baseline-batch0.json`});
 for(let b=0;b<4;b++){files.push({split:'train',file:`solver/local-runs/pro-strategy/validation/full-engine-batch${b}.json`});files.push({split:'train',file:`solver/local-runs/pro-reroll/validation/public-engine-batch${b}.json`});}
 files.push({split:'validation',file:'solver/local-runs/pro-mean125/v3-development/baseline-batch0.json'});}
 const data={schema:1,createdAt:new Date().toISOString(),purpose:'学習用の公開状態と過去の結果。新規プレイ中の予測にはtarget・seedを渡さない。',train:[],validation:[],sources:[],catalog:null,turns:null,versions:null};
 const seeds={train:new Set(),validation:new Set()};
 for(const {split,file}of files){const bytes=await readRunBytes(file),raw=JSON.parse(bytes),records=raw.simulations[0].playRecords;
  if(records.length<250)throw Error('各ソースは250シード以上');
  for(const r of records){const versions=[r.metadata.provenance.codeHash,r.metadata.cardVersion,r.metadata.rankVersion,r.metadata.source];
   if(data.versions&&JSON.stringify(versions)!==JSON.stringify(data.versions))throw Error('本体・カード・得点表・種別が異なる');data.versions=versions;
   if(seeds[split].has(r.metadata.seed)||seeds[split==='train'?'validation':'train'].has(r.metadata.seed))throw Error('シード重複・学習検証漏洩');seeds[split].add(r.metadata.seed);
   data.catalog||=r.metadata.catalog.map(c=>({cardNo:c.cardNo,cardName:c.cardName,category:c.category,rarity:c.rarity,effect:c.effect}));
   data.turns||=r.events.find(e=>e.type==='research-placement-decision').observation.turns;
   data[split].push(...extractValueRows(r));
  }
  data.sources.push({split,file:path.resolve(file),n:records.length,sha256:createHash('sha256').update(bytes).digest('hex')});console.log(`read ${split} ${file}: ${records.length}`);
 }
 const rankBytes=await readFile('game/data/rankPro.csv');if('sha256:'+createHash('sha256').update(rankBytes).digest('hex')!==data.versions[2])throw Error('現在のランク表と過去データが異なる');
 const lines=rankBytes.toString('utf8').trim().split(/\r?\n/),headers=lines[0].replace(/^\uFEFF/,'').split(','),number=s=>s===''||s===undefined?null:Number(s);
 data.rankTable=lines.slice(1).map(line=>{const values=line.split(','),row=Object.fromEntries(headers.map((h,i)=>[h,values[i]]));return {grade:row['ランク'],thresholds:{experience:number(row['体験基準']),enrollment:number(row['入塾基準']),satisfaction:number(row['満足基準']),accounting:number(row['経理基準'])},scores:{mobilization:number(row['動員スコア']),enrollmentDiff:number(row['入退差スコア']),satisfaction:number(row['満足スコア']),withdrawal:number(row['退塾スコア'])},enrollmentDiffThreshold:number(row['入退差基準']),withdrawalThreshold:number(row['退塾基準']),rankThreshold:number(row['ランク基準スコア'])};});
 data.counts={trainSeeds:seeds.train.size,validationSeeds:seeds.validation.size,trainRows:data.train.length,validationRows:data.validation.length};
 if(data.counts.validationSeeds<250)throw Error('検証は250シード以上');
 await writeFile(path.join(outputDir,'dataset.json'),JSON.stringify(data)+'\n');await writeFile(path.join(outputDir,'dataset-audit.json'),JSON.stringify({...data,train:undefined,validation:undefined,catalog:undefined,rankTable:undefined,turns:undefined},null,2)+'\n');console.log(JSON.stringify(data.counts));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e);process.exitCode=1;});
