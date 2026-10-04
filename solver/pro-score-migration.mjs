#!/usr/bin/env node
/** 完走記録の対応差を集計する。ゲーム操作・未来の判断は実行しない。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {readRunBytes,compactRecord,summarizeOutcomes} from './pro-strategy-metrics.mjs';
import {scoreMigration} from './pro-score-distribution.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function main(){
 const [specFile,outFile]=process.argv.slice(2);if(!specFile||!outFile)throw Error('比較manifestと出力先を指定');
 const spec=JSON.parse(await readFile(specFile,'utf8')),cache=new Map(),audit=[];
 async function load(manifestFile,id){
  const key=manifestFile+'|'+id;if(cache.has(key))return cache.get(key);
  const manifest=JSON.parse(await readFile(manifestFile)),run=manifest.runs.find(r=>r.id===id);if(!run)throw Error('対象の完走群がない');const outcomes=[];
  for(const file of run.files){const bytes=await readRunBytes(file),d=JSON.parse(bytes);if(d.simulations.length!==1||!d.simulations[0].playRecords?.length)throw Error('1ファイル1方略の完走記録が必要');
   const records=d.simulations[0].playRecords;
   if(records.some(r=>r.metadata.reroll||r.metadata.research?.initial))throw Error('リセマラなしの全開始が必要');
   if(manifest.fingerprints&&records.some(r=>r.metadata.provenance.strategyVersion!==manifest.fingerprints.strategyVersion||r.metadata.provenance.codeHash!==manifest.fingerprints.codeHash||r.metadata.cardVersion!==manifest.fingerprints.cardVersion||r.metadata.rankVersion!==manifest.fingerprints.rankVersion))throw Error('宣言と記録の版が一致しない');
   outcomes.push(...records.map(compactRecord));audit.push({stage:manifest.stage,id,file:file.slice(file.indexOf('/solver/')+1),sha256:sha(bytes)});
  }
  const summary=summarizeOutcomes(outcomes);if(summary.n!==manifest.n)throw Error('全開始の完走件数が必要');cache.set(key,outcomes);return outcomes;
 }
 const comparisons=[];for(const c of spec.comparisons)comparisons.push({...c,...scoreMigration(await load(c.manifest,c.before),await load(c.manifest,c.after))});
 const implementationFiles=['solver/pro-score-migration.mjs','solver/pro-score-distribution.mjs','solver/pro-strategy-metrics.mjs'],implementationSha256=sha(Buffer.concat(await Promise.all(implementationFiles.map(f=>readFile(f)))));
 const result={generatedAt:new Date().toISOString(),purpose:'全開始の対平均差の得点帯寄与を診断する。判断やゲーム実行なし。',newFullGames:0,implementationFiles,implementationSha256,audit,comparisons};
 await mkdir(path.dirname(outFile),{recursive:true});await writeFile(outFile,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(comparisons.map(({id,comparison,byBefore,score13,score14})=>({id,difference:comparison.meanDifference,interval:comparison.meanDifference95,byBefore,score13,score14})),null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
