#!/usr/bin/env node
/** 完走記録の公開会議をコピーする。将来の成績で局面を選別しない。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readRunBytes} from './pro-strategy-metrics.mjs';
import {publicScene,prepareMeetingSceneBatch} from './pro-card-scene-input.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export function collectMeetingScenes(records,{cardNo,turn=0,minimumSeeds=250}){
 if(!Number.isInteger(cardNo)||cardNo<1||cardNo>51||!Number.isInteger(turn)||turn<0||turn>6||!Number.isInteger(minimumSeeds)||minimumSeeds<250)
  throw Error('対象札・会議時期・最低250開始が必要');
 const seen=new Set(),scenes=[],audit=[];let versions=null,sourcePolicy=null;
 for(const r of records){const m=r.metadata;
  if(m?.difficulty!=='pro'||m.source!=='autoplay'||m.reroll||m.research?.initial||r.truncated||!Number.isFinite(r.result?.score?.displayScore)||
   typeof m.seed!=='string'||!m.seed||seen.has(m.seed)||r.events.filter(e=>e.type==='research-placement-decision').length!==8)
   throw Error('重複のないリセマラなし全完走記録が必要');
  seen.add(m.seed);
  const v=[m.provenance?.codeHash,m.cardVersion,m.rankVersion],p=JSON.stringify({research:{...m.research,id:undefined},actor:m.provenance?.strategyVersion,
   acquisitionModel:m.acquisitionModel??null,acquisitionAblation:m.acquisitionAblation??null,continuationPolicy:m.continuationPolicy??null,
   refreshPolicy:m.refreshPolicy??null,refreshModel:m.refreshModel??null});
  if(v.some(x=>typeof x!=='string'||!x)||typeof m.provenance?.strategyVersion!=='string'||
   versions&&JSON.stringify(versions)!==JSON.stringify(v)||sourcePolicy&&sourcePolicy!==p)throw Error('本体・カード・得点表・方略の混在');
  versions=v;sourcePolicy=p;
  if(scenes.length>=minimumSeeds)continue;
  const e=r.events.find(e=>e.type==='research-deletion-decision'&&e.turn===turn),index=e?.observation.owned.findIndex(c=>Number(c.cardNo)===cardNo);
  if(!e||index<0)continue;
  const o=publicScene({...e.observation,candidates:[],pickCount:0,allowSkip:false});
  const sceneId=`meeting-card-${cardNo}-turn-${turn}-${scenes.length}`;
  scenes.push({sceneId,observation:o,targetOwnedIndex:index,deleteMax:e.deleteMax});
  audit.push({sceneId,sourceSeed:m.seed,sourceTurn:turn,sourceActor:m.provenance.strategyVersion});
 }
 if(scenes.length<minimumSeeds)throw Error(`No${cardNo}: 指定会議に所持している異なる${minimumSeeds}開始が不足`);
 const bank={kind:'meeting',cardNo,referenceMode:'keep-versus-one-legal-delete',versions,scenes};
 prepareMeetingSceneBatch(JSON.stringify(bank),'target',{episodes:minimumSeeds,versions});
 return {bank,audit,sourceSeedCount:seen.size,sourcePolicy:JSON.parse(sourcePolicy)};
}
async function main(){
 const [manifestFile,groupId,outDir,nosText='1,2,3,4,5',turnText='0']=process.argv.slice(2),nos=nosText.split(',').map(Number),turn=Number(turnText);
 if(!manifestFile||!groupId||!outDir||!nos.length||new Set(nos).size!==nos.length)throw Error('manifest group output cardNos turn が必要');
 const manifest=JSON.parse(await readFile(manifestFile,'utf8')),run=manifest.runs.find(r=>r.id===groupId);if(!run)throw Error('元方略の群がない');
 const records=[],sources=[];
 for(const file of run.files){const bytes=await readRunBytes(file),d=JSON.parse(bytes);
  if(d.simulations?.length!==1)throw Error('1ファイル1方略が必要');
  records.push(...d.simulations[0].playRecords);sources.push({file,sha256:sha(bytes)});
 }
 await mkdir(outDir,{recursive:true});const coverage=[],sceneSources={};
 for(const cardNo of nos){const result=collectMeetingScenes(records,{cardNo,turn}),file=path.join(outDir,`card-${cardNo}.json`),bytes=JSON.stringify(result.bank)+'\n';
  await writeFile(file,bytes);coverage.push({cardNo,n:result.bank.scenes.length,turn,file,sha256:sha(bytes)});sceneSources[cardNo]=result.audit;
 }
 await writeFile(path.join(outDir,'audit.json'),JSON.stringify({schema:1,kind:'meeting',sources,coverage,sceneSources,
  selection:'指定会議で対象を所持している全完走記録を元の順序で先頭250開始。得点・非公開未来で選別しない。元シードは実行用局面へ渡さない。',
  intervention:'同じ公開会議で対象1枚だけを保持または合法削除。他の削除は両群で行わず、その後は固定方略。最良の別札削除との比較ではない。'},null,2)+'\n');
 console.log(JSON.stringify(coverage));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e);process.exitCode=1;});
