#!/usr/bin/env node
/** 完走した対照試験を、取得前の公開値と元方略の選択だけで事後集計する。判断・ゲーム操作は行わない。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {readRunBytes} from './pro-strategy-metrics.mjs';
import {compareSceneArms} from './pro-card-scene-metrics.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export function sceneCohorts(bank){
 const definitions=[['satisfaction-at-least15',s=>s.observation.stats.satisfaction>=15],['satisfaction-below15',s=>s.observation.stats.satisfaction<15],['accounting-at-least15',s=>s.observation.stats.accounting>=15],['accounting-below15',s=>s.observation.stats.accounting<15]];
 if(bank.referenceMode==='best-other')definitions.push(['original-policy-selected-target',s=>s.referenceWasOriginalChoice===false],['original-policy-selected-other',s=>s.referenceWasOriginalChoice===true]);
 return definitions.map(([id,test])=>({id,sceneIds:bank.scenes.filter(test).map(s=>s.sceneId)}));
}
export function compareCohort(reference,target,sceneIds){
 const keep=new Set(sceneIds);if(keep.size!==sceneIds.length)throw Error('局面IDの重複');
 const a=reference.filter(r=>keep.has(r.metadata.sceneId)),b=target.filter(r=>keep.has(r.metadata.sceneId));
 if(a.length!==sceneIds.length||b.length!==sceneIds.length)throw Error('指定局面の完走記録が不足');
 if(sceneIds.length<250)return {n:sceneIds.length,trendSupported:false,reason:'最低250局面に未達のため、得点差の傾向を集計しない'};
 const result=compareSceneArms(a,b),{referenceCards,targetCards,...compact}=result;
 return {trendSupported:true,...compact};
}
async function main(){
 const [manifestFile,outFile]=process.argv.slice(2);if(!manifestFile||!outFile)throw Error('manifest output-file が必要');
 const bytes=await readFile(manifestFile),manifest=JSON.parse(bytes),records={},audit=[];
 for(const run of manifest.runs){records[run.id]=[];for(const file of run.files){const raw=await readRunBytes(file),d=JSON.parse(raw);if(d.simulations?.length!==1)throw Error('1ファイル1方略が必要');records[run.id].push(...d.simulations[0].playRecords);audit.push({id:run.id,file,sha256:sha(raw)});}}
 const comparisons={};
 for(const c of manifest.comparisons){const no=Number(c.id.replace('card-','')),source=manifest.banks[no],raw=await readFile(source.file);if(sha(raw)!==source.sha256)throw Error('局面集SHAが異なる');
  const bank=JSON.parse(raw);if(bank.cardNo!==no)throw Error('対象カードが異なる');
  for(const r of [...records[c.before],...records[c.after]])if(r.metadata.sceneBankSha256!==source.sha256)throw Error('記録と局面集SHAが異なる');
  comparisons[c.id]={referenceMode:bank.referenceMode||'original-other',cohorts:{}};
  for(const cohort of sceneCohorts(bank))comparisons[c.id].cohorts[cohort.id]=compareCohort(records[c.before],records[c.after],cohort.sceneIds);
 }
 const result={generatedAt:new Date().toISOString(),purpose:'exploratory post-hoc subgroup summaries; old continuation policy; not mean125 confirmation',minimumSeeds:250,manifestSha256:sha(bytes),generatorSha256:sha(await readFile(new URL(import.meta.url))),audit,comparisons,
  interpretation:'取得前の公開値と旧方略の選択で分ける事後集計。条件を満たすデッキを後から選ぶ効果や時期の因果比較ではない。複数比較の名目区間。250未満は件数だけを残す。'};
 await mkdir(path.dirname(outFile),{recursive:true});await writeFile(outFile,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(Object.fromEntries(Object.entries(comparisons).map(([id,c])=>[id,Object.fromEntries(Object.entries(c.cohorts).map(([key,r])=>[key,{n:r.n,trendSupported:r.trendSupported,reference:r.reference?.mean,target:r.target?.mean,delta:r.comparison?.meanDifference,interval95:r.comparison?.meanDifference95}]))])),null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e);process.exitCode=1;});
