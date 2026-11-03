#!/usr/bin/env node
/** 学習材料の同方略・全開始・漏洩を監査するだけ。ゲーム判断は行わない。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readRunBytes} from './pro-strategy-metrics.mjs';
import {extractValueRows} from './pro-value-dataset.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export function policyIdentity(config){const {id,...rest}=config;return JSON.stringify(canonical(rest));}
export function auditPolicyRecord(record,{policy,versions,seen}){
 if(record.metadata?.difficulty!=='pro'||record.metadata.reroll||record.truncated||!Number.isFinite(record.result?.score?.displayScore))throw Error('リセマラなしPROの完走記録が必要');
 if(policyIdentity(record.metadata.research)!==policy)throw Error('取得・配置・削除方略の不一致');
 const actual=[record.metadata.provenance?.codeHash,record.metadata.cardVersion,record.metadata.rankVersion,record.metadata.source];
 if(JSON.stringify(actual)!==JSON.stringify(versions))throw Error('本体・カード・得点表・記録種別の不一致');
 const seed=record.metadata.seed;if(typeof seed!=='string'||seen.has(seed))throw Error('シード重複または不明。学習・検証を混ぜない');
 if(record.events.filter(e=>e.type==='research-placement-decision').length!==8)throw Error('8ターンの配置判断がそろっていない');
 const rows=extractValueRows(record);if(rows.length<16)throw Error('公開状態の抽出不足');seen.add(seed);return rows;
}
async function main(){
 const [manifestFile,outputFile]=process.argv.slice(2);if(!manifestFile||!outputFile)throw Error('usage: pro-policy-value-preflight.mjs sources.json audit.json');
 const manifest=JSON.parse(await readFile(manifestFile,'utf8')),seen=new Set(),audits=[],pending=[];let policy=null,versions=null;
 for(const split of ['train','validation'])for(const file of manifest[split]||[]){
  const configFile=file.replace(/-batch\d+\.json(?:\.gz)?$/,'-config.json'),config=JSON.parse(await readFile(configFile,'utf8')),identity=policyIdentity(config);
  if(policy!==null&&identity!==policy)throw Error('ソース設定の取得・配置・削除方略が異なる');policy=identity;
  let bytes;try{bytes=await readRunBytes(file);}catch(error){if(error.code==='ENOENT'&&split==='validation'){pending.push({split,file,configSha256:sha(identity),reason:'固定した検証群の完走待ち'});continue;}throw error;}
  const raw=JSON.parse(bytes);if(raw.simulations.length!==1||policyIdentity(raw.settings.research)!==policy)throw Error('実行設定の方略不一致');
  const records=raw.simulations[0].playRecords;if(records.length!==250||raw.settings.episodes!==250)throw Error('各ソースは全250開始で完走すること');
  versions??=[records[0].metadata.provenance.codeHash,records[0].metadata.cardVersion,records[0].metadata.rankVersion,records[0].metadata.source];
  const phases={},turns={},sourceVersions=new Set();let rows=0;
  for(let index=0;index<records.length;index++){
   const record=records[index];if(record.metadata.seed!==`${raw.settings.seed}:${raw.settings.episodeOffset+index}`)throw Error('開始の選別・欠落・順序不一致');
   if(record.metadata.provenance.strategyVersion!==raw.settings.provenance.strategyVersion)throw Error('記録内の研究版が異なる');
   for(const row of auditPolicyRecord(record,{policy,versions,seen})){rows++;phases[row.observation.phase]=(phases[row.observation.phase]||0)+1;turns[row.observation.turn]=(turns[row.observation.turn]||0)+1;}
   sourceVersions.add(record.metadata.provenance.strategyVersion);
  }
  audits.push({split,file,sha256:sha(bytes),configSha256:sha(policy),seeds:records.length,rows,phases,turns,strategyVersions:[...sourceVersions]});
  console.log(`checked ${split} ${file}: ${records.length} starts / ${rows} states`);
 }
 const counts=Object.fromEntries(['train','validation'].map(split=>[split,{seeds:audits.filter(a=>a.split===split).reduce((s,a)=>s+a.seeds,0),rows:audits.filter(a=>a.split===split).reduce((s,a)=>s+a.rows,0)}]));
 const audit={createdAt:new Date().toISOString(),purpose:'同じ設定の後続方略だけを教師にする研究。実装版の差は保存し、固定版の到達検証とは呼ばない。',manifest:manifestFile,readyForDataset:pending.length===0&&counts.train.seeds>=250&&counts.validation.seeds>=250,policySha256:sha(policy),policy:JSON.parse(policy),versions,counts,audits,pending,allStartsAccepted:true,rerolls:0,splitSeedsDisjoint:true,uniqueSeedListSha256:sha([...seen].sort().join('\n')),futureDecisionInput:'公開状態と学習済みmodelのみ。過去のseed・target・結果は判断入力に渡さない。'};
 await mkdir(path.dirname(outputFile),{recursive:true});await writeFile(outputFile,JSON.stringify(audit,null,2)+'\n');console.log(JSON.stringify({readyForDataset:audit.readyForDataset,counts,pending:pending.length}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(error);process.exitCode=1;});
