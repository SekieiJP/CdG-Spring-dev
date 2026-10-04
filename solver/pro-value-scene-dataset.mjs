#!/usr/bin/env node
/** 完走した局面対照試験を、過去の公開状態の学習データに追加する。判断は行わない。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {extractValueRows,packValueObservation} from './pro-value-dataset.mjs';
import {readRunBytes} from './pro-strategy-metrics.mjs';
import {compareSceneArms} from './pro-card-scene-metrics.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export function extractSceneRows(record,totalWeight=.5){
 const m=record.metadata,start=record.events.find(e=>e.type==='research-counterfactual-start');
 if(m?.source!=='counterfactual'||!m.sceneId||!['target','reference'].includes(m.sceneArm)||!start||
  !/^[a-f0-9]{64}$/.test(m.sceneBankSha256||'')||!Number.isFinite(totalWeight)||totalWeight<=0)throw Error('公開局面の対照記録が必要');
 const o=start.observation,chosen=start.forcedChoice;
 if(!Array.isArray(chosen)||JSON.stringify(chosen)!==JSON.stringify(m.forcedChoice)||sha(JSON.stringify(o))!==m.sceneObservationSha256)throw Error('強制取得の公開観測と記録が異なる');
 const after={...o,owned:[...o.owned,...chosen.map(i=>({...o.candidates[i],acquiredTurn:o.turn}))],tokens:{...o.tokens,inspiration:Math.max(0,o.tokens.inspiration-Number(o.allowSkip))}};
 const observations=[packValueObservation(after,'acquisition'),...extractValueRows(record).map(r=>r.observation)];
 const seed=`cf:${m.sceneBankSha256}:${m.seed}:${m.sceneArm}`;
 return observations.map(observation=>({seed,target:record.result.score.displayScore,weight:totalWeight/observations.length,observation}));
}
async function main(){
 const [baseDir,manifestFile,preparationFile,outDir,weightText='.5']=process.argv.slice(2),weight=Number(weightText);
 if(!baseDir||!manifestFile||!preparationFile||!outDir||!Number.isFinite(weight)||weight<=0||weight>1)throw Error('base-dir manifest preparation-audit output-dir weight が必要');
 const bytes=await readFile(path.join(baseDir,'dataset.json')),data=JSON.parse(bytes),manifest=JSON.parse(await readFile(manifestFile,'utf8')),prep=JSON.parse(await readFile(preparationFile,'utf8'));
 const originalCounts={...data.counts},originalSources=[...data.sources],trainHashes=new Set(data.sources.filter(s=>s.split==='train').map(s=>s.sha256)),validationHashes=new Set(data.sources.filter(s=>s.split==='validation').map(s=>s.sha256));
 if(data.schema!==1||data.counts.trainSeeds<250||data.counts.validationSeeds<250||prep.sources.some(s=>!trainHashes.has(s.sha256)||validationHashes.has(s.sha256)))throw Error('局面の参照元は学習側の完走記録だけに限る');
 const groups={},audit=[],seen=new Set(data.train.map(r=>r.seed)),validation=new Set(data.validation.map(r=>r.seed));
 for(const run of manifest.runs){groups[run.id]=[];for(const file of run.files){const raw=await readRunBytes(file),d=JSON.parse(raw);if(d.simulations?.length!==1)throw Error('1ファイル1方略が必要');
  groups[run.id].push(...d.simulations[0].playRecords);audit.push({id:run.id,file:path.resolve(file),n:d.simulations[0].playRecords.length,sha256:sha(raw)});}}
 for(const c of manifest.comparisons)compareSceneArms(groups[c.before],groups[c.after]);
 let games=0,rows=0;const cases=new Set();
 for(const records of Object.values(groups))for(const r of records){const m=r.metadata;
  if(JSON.stringify([m.provenance.codeHash,m.cardVersion,m.rankVersion])!==JSON.stringify(data.versions.slice(0,3)))throw Error('本体・カード・得点表の混在');
  const extracted=extractSceneRows(r,weight),id=extracted[0].seed;
  if(seen.has(id)||validation.has(id))throw Error('学習・検証の重複');seen.add(id);cases.add(m.sceneBankSha256+':'+m.sceneId);
  data.train.push(...extracted);games++;rows+=extracted.length;
 }
 data.versions=[...data.versions.slice(0,3),'autoplay-and-public-counterfactuals'];
 data.sources.push(...audit.map(a=>({...a,split:'train',kind:'public-counterfactual',gameWeight:weight})));
 data.counts={...data.counts,trainSeeds:seen.size,trainRows:data.train.length,originalFullGameTrainSeeds:originalCounts.trainSeeds,counterfactualPlays:games,counterfactualCases:cases.size,counterfactualRows:rows,counterfactualEffectiveWeight:games*weight};
 data.sceneAugmentation={generatorSha256:sha(await readFile(fileURLToPath(import.meta.url))),baseDatasetSha256:sha(bytes),baseSources:originalSources,manifestSha256:sha(await readFile(manifestFile)),preparationSha256:sha(await readFile(preparationFile)),weight,
  scope:'既存の学習側の公開局面のみ。2群とも学習側に置き、検証側は既存の別250開始シードを維持。途中局面からの継続を全ゲーム達成の証拠には数えない。'};
 data.createdAt=new Date().toISOString();
 await mkdir(outDir,{recursive:true});await writeFile(path.join(outDir,'dataset.json'),JSON.stringify(data)+'\n');
 await writeFile(path.join(outDir,'dataset-audit.json'),JSON.stringify({...data,train:undefined,validation:undefined,catalog:undefined,rankTable:undefined,turns:undefined},null,2)+'\n');
 console.log(JSON.stringify(data.counts));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e);process.exitCode=1;});
