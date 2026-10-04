#!/usr/bin/env node
/** 過去の公開研修局面を整理する。新規ゲームの判断や未来の結果による選別は行わない。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readRunBytes} from './pro-strategy-metrics.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
import {publicScene} from './pro-card-scene-input.mjs';
export {publicScene} from './pro-card-scene-input.mjs';

async function main(){
 const [manifestFile,groupId,outDir,nosText='43,51']=process.argv.slice(2),nos=nosText.split(',').map(Number),perTurn=250;
 if(!manifestFile||!groupId||!outDir||nos.some(n=>!Number.isInteger(n)||n<6||n>51))throw Error('manifest group output-dir cardNos が必要');
 const manifest=JSON.parse(await readFile(manifestFile,'utf8')),run=manifest.runs.find(r=>r.id===groupId);if(!run)throw Error('群がない');
 const bins=new Map(nos.map(no=>[no,new Map([[2,[]],[4,[]]])])),usedSources=new Map(nos.map(no=>[no,new Set()])),seeds=new Set(),audit=[];let versions=null;
 for(const file of run.files){const bytes=await readRunBytes(file),data=JSON.parse(bytes);audit.push({file,sha256:sha(bytes)});
  for(const rec of data.simulations[0].playRecords){const m=rec.metadata;if(m.difficulty!=='pro'||m.source!=='autoplay'||m.reroll||!rec.result?.score)throw Error('リセマラなし完走の記録が必要');
   if(seeds.has(m.seed))throw Error('重複開始シード');seeds.add(m.seed);const v=JSON.stringify([m.provenance.codeHash,m.cardVersion,m.rankVersion]);if(versions&&versions!==v)throw Error('本体・カード・得点表の混在');versions=v;
   for(const no of nos)for(const turn of [2,4]){const bin=bins.get(no).get(turn);if(bin.length>=perTurn||usedSources.get(no).has(m.seed))continue;
    const e=rec.events.find(e=>e.type==='research-acquisition-decision'&&e.turn===turn&&!e.observation.allowSkip&&e.observation.pickCount===1&&e.observation.candidates.some(c=>Number(c.cardNo)===no)&&!e.chosenIndices.some(i=>Number(e.observation.candidates[i].cardNo)===no));
    if(e){usedSources.get(no).add(m.seed);bin.push({sourceSeed:m.seed,sourceTurn:turn,observation:publicScene(e.observation),targetIndices:[e.observation.candidates.findIndex(c=>Number(c.cardNo)===no)],referenceIndices:[...e.chosenIndices]});}
   }
  }
 }
 await mkdir(outDir,{recursive:true});const coverage=[];
 for(const [no,buckets]of bins){const scenes=[...buckets.values()].flat();if(scenes.length!==perTurn*2||new Set(scenes.map(s=>s.sourceSeed)).size!==perTurn*2)throw Error(`No${no}: 各取得時期で異なる250局面を満たさない`);
  const executable=scenes.map((s,i)=>({sceneId:`card-${no}-${i}`,observation:s.observation,targetIndices:s.targetIndices,referenceIndices:s.referenceIndices}));
  const file=path.join(outDir,`card-${no}.json`);await writeFile(file,JSON.stringify({cardNo:no,versions:JSON.parse(versions),scenes:executable})+'\n');
  coverage.push({cardNo:no,n:scenes.length,byTurn:Object.fromEntries([...buckets].map(([t,a])=>[t,a.length])),file:path.resolve(file),sha256:sha(await readFile(file))});
 }
 await writeFile(path.join(outDir,'audit.json'),JSON.stringify({schema:1,generatorSha256:sha(await readFile(fileURLToPath(import.meta.url))),sources:audit,versions:JSON.parse(versions),coverage,selection:'完走した旧方略が選ばなかったカードを、公開提示から拾う。T3/T5各250局面。時期別の評価も最低250局面を満たす。最終得点・非公開未来を選別に用いない。参照元シードは実行用局面に含めない。',sourceSeedCount:seeds.size},null,2)+'\n');console.log(JSON.stringify(coverage));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e);process.exitCode=1;});
