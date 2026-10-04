#!/usr/bin/env node
/** 公開済み判断の順位をコピーする。取得をNodeで評価せず、結果で選別しない。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readRunBytes} from './pro-strategy-metrics.mjs';
import {auditPolicyRecord,policyIdentity} from './pro-policy-value-preflight.mjs';
import {publicScene,prepareChoiceSceneBatch} from './pro-card-scene-input.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),key=a=>[...a].sort((a,b)=>a-b).join(',');
export function collectChoiceScenes(sources,{expectedSourceActor,turnCycle=[0,2,4,6]}={}){
 if(typeof expectedSourceActor!=='string'||!expectedSourceActor||JSON.stringify(turnCycle)!=='[0,2,4,6]')throw Error('固定した元方略版と時期割当が必要');
 const seen=new Set(),scenes=[],sceneAudit=[],sourceAudits=[];let policy=null,versions=null,ordinal=0;
 for(const source of sources){const {split,file,data,sha256}=source;
  if(!['train','validation'].includes(split)||data.simulations?.length!==1||data.settings?.episodes!==250||data.simulations[0].playRecords?.length!==250)
   throw Error('各ソースは学習/検証を固定した全250開始');
  const current=policyIdentity(data.settings.research);if(policy!==null&&current!==policy)throw Error('元取得・配置・削除設定の混在');policy=current;
  if(data.settings.provenance?.strategyVersion!==expectedSourceActor)throw Error('元方略版の混在');
  const records=data.simulations[0].playRecords;
  versions??=[records[0].metadata.provenance.codeHash,records[0].metadata.cardVersion,records[0].metadata.rankVersion,'autoplay'];
  for(let index=0;index<records.length;index++){
   const r=records[index],m=r.metadata;
   if(m.seed!==`${data.settings.seed}:${data.settings.episodeOffset+index}`||m.provenance.strategyVersion!==expectedSourceActor)
    throw Error('開始の欠落・選別・順序・版の不一致');
   auditPolicyRecord(r,{policy,versions,seen});
   const turn=turnCycle[ordinal%turnCycle.length],e=r.events.find(e=>e.type==='research-acquisition-decision'&&e.turn===turn&&!e.observation.allowSkip);
   if(!e||key(e.chosenIndices)!==key(e.advice?.recommended?.indices||[]))throw Error('実選択と公開済み基準評価が一致しない');
   const alternative=e.advice.evaluations.find(a=>key(a.indices)!==key(e.chosenIndices));
   if(!alternative)throw Error('ブラウザの公開評価に別の合法取得がない');
   const sceneId=`choice-${ordinal++}`,observation=publicScene(e.observation);
   scenes.push({sceneId,observation,referenceIndices:[...e.chosenIndices],targetIndices:[...alternative.indices]});
   sceneAudit.push({sceneId,split,sourceSeed:m.seed,sourceTurn:turn,sourceFile:file});
  }
  sourceAudits.push({split,file,sha256,n:250,actor:expectedSourceActor});
 }
 const counts=Object.fromEntries(['train','validation'].map(split=>[split,sceneAudit.filter(s=>s.split===split).length]));
 if(counts.train!==500||counts.validation!==250)throw Error('今回は学習500開始・検証250開始に固定');
 const bank={kind:'choices',versions:versions.slice(0,3),scenes};
 prepareChoiceSceneBatch(JSON.stringify(bank),'target',{episodes:750,versions:bank.versions});
 return {bank,audit:{counts,sourceAudits,sceneAudit,policy:JSON.parse(policy),versions,sourceActor:expectedSourceActor,
  allStartsAccepted:true,rerolls:0,sourceSeedsDisjoint:true,byTurn:Object.fromEntries(turnCycle.map(turn=>[turn,sceneAudit.filter(s=>s.sourceTurn===turn).length]))}};
}
async function main(){
 const [manifestFile,outDir]=process.argv.slice(2);if(!manifestFile||!outDir)throw Error('sources.json output-dir が必要');
 const manifest=JSON.parse(await readFile(manifestFile,'utf8')),sources=[];
 for(const s of manifest.sources){const bytes=await readRunBytes(s.file);sources.push({...s,data:JSON.parse(bytes),sha256:sha(bytes)});}
 const {bank,audit}=collectChoiceScenes(sources,{expectedSourceActor:manifest.expectedSourceActor,turnCycle:manifest.turnCycle});
 await mkdir(outDir,{recursive:true});const bankFile=path.join(outDir,'choices.json'),bytes=JSON.stringify(bank)+'\n';await writeFile(bankFile,bytes);
 const output={createdAt:new Date().toISOString(),purpose:'得点差学習の材料準備。平均12.5達成やカードの因果パワーの結論ではない。',...audit,
  bank:{file:bankFile,sha256:sha(bytes),n:bank.scenes.length},generatorSha256:sha(await readFile(pathToFileURL(path.resolve(process.argv[1])))),
  selection:'各元ゲームから1局面。元記録順にT1/T3/T5/T7を巡回割当。基準は実選択、別取得は同じ観測でブラウザが計算済みの次順位をコピー。実得点で選別しない。実シードは実行用局面に含めない。'};
 await writeFile(path.join(outDir,'audit.json'),JSON.stringify(output,null,2)+'\n');
 console.log(JSON.stringify({counts:audit.counts,byTurn:audit.byTurn,bank:output.bank}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e);process.exitCode=1;});
