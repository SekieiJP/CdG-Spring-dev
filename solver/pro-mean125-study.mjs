#!/usr/bin/env node
/** 起動・記録管理だけを行う。判断、仮想将来、実ゲーム操作はブラウザ内。 */
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {readRunBytes} from './pro-strategy-metrics.mjs';
import {compressRun} from './compress-research-runs.mjs';
async function main(){
 const [stage='v1-development',nText='250',idsText='baseline,rollout-acq,rollout-all,rollout-risk']=process.argv.slice(2),n=Number(nText);
 if(!/^[a-z0-9-]+$/.test(stage)||n<250||n%250)throw Error('安全なstage名と250の倍数を指定');
 const custom=process.argv.indexOf('--configs'),configs=JSON.parse(await readFile(custom>=0?process.argv[custom+1]:'solver/research-scenarios/pro-mean125-configs.json','utf8')),ids=idsText.split(',');
 if(ids.some(id=>!configs[id]||configs[id].initial))throw Error('有効なリセマラなしの設定を指定');
 const portIndex=process.argv.indexOf('--port-base'),portBase=portIndex>=0?Number(process.argv[portIndex+1]):18480;
 if(!Number.isInteger(portBase)||portBase<1024||portBase>65534)throw Error('安全なport-baseを指定');
 const workersIndex=process.argv.indexOf('--workers'),workers=workersIndex>=0?Number(process.argv[workersIndex+1]):2;
 if(!Number.isInteger(workers)||workers<1||workers>2)throw Error('workersは1または2');
 const root=`solver/local-runs/pro-mean125/${stage}`,seed=`pro-mean125-${stage}`,jobs=[],runs=[];
 await mkdir(root,{recursive:true});
 const sha=buffer=>createHash('sha256').update(buffer).digest('hex');
 const files=['solver/autoplay-agent.mjs','solver/browser/pro-strategy-research.js','solver/browser/pro-risk-research.js','solver/browser/pro-value-model.js','solver/browser/pro-learned-research.js','solver/browser/pro-public-action-kernel.js','solver/pro-card-scene-input.mjs','solver/browser/pro-intrinsic-recovery.js','solver/browser/pro-action-candidates.js'];
 const strategyVersion=sha(Buffer.concat(await Promise.all(files.map(file=>readFile(file)))));
 const sources=await Promise.all((await readdir('game/js')).filter(name=>name.endsWith('.js')).sort().map(async name=>name+await readFile(`game/js/${name}`,'utf8')));
 const fingerprints={strategyVersion,codeHash:sha(sources.join('\n')),cardVersion:'sha256:'+sha(await readFile('game/data/cards_pro.csv')),rankVersion:'sha256:'+sha(await readFile('game/data/rankPro.csv'))};
 for(const id of ids){const config={id,...configs[id]};if(config.valueModelPath)config.valueModelSha256=sha(await readFile(config.valueModelPath));const configPath=`${root}/${id}-config.json`,batchFiles=[];await writeFile(configPath,JSON.stringify(config,null,2)+'\n');
  for(let b=0;b<n/250;b++){const output=`${root}/${id}-batch${b}.json`;batchFiles.push(path.resolve(output));jobs.push({id,config,configPath,b,output});}
  runs.push({id,description:JSON.stringify(config),files:batchFiles});}
 const comparisons=['baseline','champion-v1'].filter(reference=>ids.includes(reference)).flatMap(reference=>ids.filter(id=>id!==reference&&(reference==='baseline'||id!=='baseline')).map(id=>({id:`${reference}-to-${id}`,before:reference,after:id})));
 await writeFile(`${root}/manifest.json`,JSON.stringify({stage,n,seed,goal:'no rerolls; mean score >=12.5',fingerprints,runs,comparisons},null,2)+'\n');
 let next=0,done=0;
 async function worker(index){while(next<jobs.length){const job=jobs[next++],started=Date.now();
  if(process.argv.includes('--resume'))try{const d=JSON.parse(await readRunBytes(job.output)),s=d.settings,records=d.simulations?.[0]?.playRecords;
   if(s?.seed===seed&&s.episodeOffset===job.b*250&&s.episodes===250&&JSON.stringify(s.research)===JSON.stringify(job.config)&&s.provenance?.strategyVersion===fingerprints.strategyVersion&&s.provenance?.codeHash===fingerprints.codeHash&&records?.length===250&&records.every(r=>r.metadata.cardVersion===fingerprints.cardVersion&&r.metadata.rankVersion===fingerprints.rankVersion&&!r.metadata.reroll)){console.log(`reuse ${job.id}/${job.b}`);done++;continue;}}catch{}
  console.log(`start ${stage}/${job.id} batch${job.b}`);let log='',progressBuffer='';
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['solver/autoplay-agent.mjs','--difficulty','pro','--episodes','250','--episode-offset',String(job.b*250),'--seed',seed,'--policies','pro_goal','--acquisition-model','pro_splus','--refresh-policy','public','--refresh-model','pro_splus','--research-config',job.configPath,'--port',String(portBase+index),'--output',job.output,'--trace-samples','0','--no-report'],{stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',s=>{log+=s;progressBuffer+=s;const lines=progressBuffer.split('\n');progressBuffer=lines.pop();for(const line of lines)if(line.startsWith('CDG_RESEARCH_PROGRESS '))console.log(`[${job.id}/${job.b}] ${line}`);});child.stderr.on('data',s=>log+=s);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`${job.id}: ${code}\n${log}`)));});
  await writeFile(`${root}/${job.id}-batch${job.b}.log`,log);
  const data=JSON.parse(await readRunBytes(job.output)),sim=data.simulations[0];console.log(`done ${++done}/${jobs.length} ${job.id}/${job.b}: mean=${sim.scoreSummary.mean.toFixed(3)} median=${sim.scoreSummary.p50} minutes=${((Date.now()-started)/60000).toFixed(2)}`);
  await compressRun(job.output);
 }}
 await Promise.all(Array.from({length:workers},(_,index)=>worker(index)));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
