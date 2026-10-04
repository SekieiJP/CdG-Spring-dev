#!/usr/bin/env node
/** 2群の実行と記録を管理する。判断・仮想操作・実ゲームはブラウザ内。 */
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareChoiceSceneBatch} from './pro-card-scene-input.mjs';
import {readRunBytes} from './pro-strategy-metrics.mjs';
import {compressRun} from './compress-research-runs.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export const ACTOR_FILES=['solver/autoplay-agent.mjs','solver/browser/pro-strategy-research.js','solver/browser/pro-risk-research.js','solver/browser/pro-value-model.js','solver/browser/pro-learned-research.js','solver/browser/pro-public-action-kernel.js','solver/pro-card-scene-input.mjs','solver/browser/pro-intrinsic-recovery.js','solver/browser/pro-action-candidates.js','solver/browser/pro-opening-table.js','solver/pro-opening-table-input.mjs'];
async function main(){
 const [stage,bankFile]=process.argv.slice(2),option=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
 const workers=Number(option('--workers','1')),port=Number(option('--port-base','19030'));
 if(!/^[a-z0-9-]+$/.test(stage||'')||!bankFile||![1,2].includes(workers)||!Number.isInteger(port)||port<1024||port+workers>65535)throw Error('stage bank --workers 1/2 --port-base が必要');
 const bankBytes=await readFile(bankFile),bank=JSON.parse(bankBytes);if(bank.scenes.length!==750)throw Error('今回の750公開局面が必要');
 const root=`solver/local-runs/pro-mean125/${stage}`;await mkdir(root,{recursive:true});
 const gameSources=await Promise.all((await readdir('game/js')).filter(n=>n.endsWith('.js')).sort().map(async n=>n+await readFile(`game/js/${n}`,'utf8')));
 const fingerprints={strategyVersion:sha(Buffer.concat(await Promise.all(ACTOR_FILES.map(f=>readFile(f))))),codeHash:sha(gameSources.join('\n')),cardVersion:'sha256:'+sha(await readFile('game/data/cards_pro.csv')),rankVersion:'sha256:'+sha(await readFile('game/data/rankPro.csv'))};
 const configs=JSON.parse(await readFile('solver/research-scenarios/pro-mean125-component-value6-configs.json')),
 config={id:'paired-value-continuation-v1',...configs.baseline};config.valueModelSha256=sha(await readFile(config.valueModelPath));
 if(config.initial)throw Error('リセマラなしの基準継続方略が必要');
 const configFile=`${root}/config.json`;await writeFile(configFile,JSON.stringify(config,null,2)+'\n');
 const jobs=[],runs=[],versions=[fingerprints.codeHash,fingerprints.cardVersion,fingerprints.rankVersion],seed=`pro-${stage}`;
 for(const arm of ['reference','target']){
  const input=prepareChoiceSceneBatch(bankBytes,arm,{episodes:750,versions}),files=[];
  for(let b=0;b<3;b++){const output=`${root}/${arm}-batch${b}.json`;files.push(path.resolve(output));jobs.push({arm,b,input,output});}
  runs.push({id:arm,description:'公開研修の'+(arm==='reference'?'記録済み基準取得':'記録済み次順位取得')+'、以後の方略は固定',files});
 }
 const manifest={stage,purpose:'paired acquisition teacher data; not whole-game mean125 confirmation',fingerprints,config,bank:{file:path.resolve(bankFile),sha256:sha(bankBytes),n:750},seed,runs,comparisons:[{id:'alternative-minus-reference',before:'reference',after:'target'}]};
 await writeFile(`${root}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');let next=0,done=0;
 const valid=(d,j)=>{const rs=d.simulations?.[0]?.playRecords;return d.settings?.seed===seed&&d.settings.episodeOffset===j.b*250&&d.settings.episodes===250&&JSON.stringify(d.settings.research)===JSON.stringify(config)&&rs?.length===250&&rs.every((r,i)=>{const m=r.metadata,s=j.input.scenes[j.b*250+i];return m.source==='counterfactual'&&!m.reroll&&!r.truncated&&Number.isFinite(r.result?.score?.displayScore)&&m.sceneKind==='choices'&&m.sceneArm===j.arm&&m.seed===`${seed}:${j.b*250+i}`&&m.sceneId===s.sceneId&&m.sceneBankSha256===j.input.sha256&&m.sceneObservationSha256===s.observationSha256&&JSON.stringify(m.forcedChoice)===JSON.stringify(s.forcedChoice)&&m.provenance.strategyVersion===fingerprints.strategyVersion&&m.provenance.codeHash===fingerprints.codeHash&&m.cardVersion===fingerprints.cardVersion&&m.rankVersion===fingerprints.rankVersion&&r.events.filter(e=>e.type==='research-placement-decision').length===8-s.observation.turn;});};
 async function worker(w){while(next<jobs.length){const j=jobs[next++],started=Date.now();
  if(process.argv.includes('--resume'))try{if(valid(JSON.parse(await readRunBytes(j.output)),j)){console.log(`reuse ${j.arm}/${j.b}`);done++;continue;}}catch{}
  if(sha(Buffer.concat(await Promise.all(ACTOR_FILES.map(f=>readFile(f)))))!==fingerprints.strategyVersion||sha(await readFile(bankFile))!==manifest.bank.sha256||sha(await readFile(config.valueModelPath))!==config.valueModelSha256)throw Error('固定した版・局面・モデルが変わった');
  console.log(`start ${stage}/${j.arm} batch${j.b}: 250 public continuations`);let log='',buffer='';
  await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['solver/autoplay-agent.mjs','--difficulty','pro','--episodes','250','--episode-offset',String(j.b*250),'--seed',seed,'--policies','pro_goal','--acquisition-model','pro_splus','--refresh-policy','public','--refresh-model','pro_splus','--research-config',configFile,'--decision-batch',bankFile,'--scene-arm',j.arm,'--port',String(port+w),'--output',j.output,'--trace-samples','0','--no-report'],{stdio:['ignore','pipe','pipe']});
   p.stdout.on('data',s=>{log+=s;buffer+=s;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines)if(line.startsWith('CDG_RESEARCH_PROGRESS '))console.log(`[${j.arm}/${j.b}] ${line}`);});p.stderr.on('data',s=>log+=s);p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error(`${j.arm}/${j.b}: exit ${code}\n${log}`)));});
  await writeFile(`${root}/${j.arm}-batch${j.b}.log`,log);if(!valid(JSON.parse(await readRunBytes(j.output)),j))throw Error('固定した局面・方略・版と完走記録の不一致');
  await compressRun(j.output);console.log(`done ${++done}/6 ${j.arm}/${j.b}: minutes=${((Date.now()-started)/60000).toFixed(2)}`);
 }}
 await Promise.all(Array.from({length:workers},(_,w)=>worker(w)));
 if(sha(Buffer.concat(await Promise.all(ACTOR_FILES.map(f=>readFile(f)))))!==fingerprints.strategyVersion)throw Error('試験中の版変更');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e);process.exitCode=1;});
