#!/usr/bin/env node
/** 起動と集計のみ。初期候補の判定・全操作はブラウザ内の本体で実行する。 */
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {readRunBytes} from './pro-strategy-metrics.mjs';
import {compressRun} from './compress-research-runs.mjs';
const engine={acquisition:'engine',placement:'engine',deletion:'aggressive',objective:'engine'};
export const REROLL_CONFIGS={
 'public-engine':{...engine},
 'any-engine':{...engine,initial:{pairs:null}},
 'any-median':{acquisition:'median',placement:'median',deletion:'adaptive',objective:'median',initial:{pairs:null}},
 ...Object.fromEntries([[7,13],[7,15],[11,15],[13,15],[13,17],[7,17],[11,13],[10,15],[13,16],[9,15],[7,11],[10,13]].map(pair=>[
  `pair-${pair.join('-')}`,{...engine,initial:{pairs:[pair]}}]))
};
export function reusableRun(data,expected){
 const settings=data.settings||{},records=data.simulations?.[0]?.playRecords||[];
 return settings.seed===expected.seed&&settings.episodeOffset===expected.offset&&settings.episodes===250&&
  JSON.stringify(settings.research)===JSON.stringify(expected.config)&&settings.provenance?.strategyVersion===expected.strategyVersion&&
  settings.provenance?.codeHash===expected.codeHash&&records.length===250&&records.every(r=>
   r.metadata.cardVersion===expected.cardVersion&&r.metadata.rankVersion===expected.rankVersion);
}
async function main(){
 const [stage='development',nText='250',idsText=Object.keys(REROLL_CONFIGS).filter(id=>id!=='any-median').join(',')]=process.argv.slice(2);
 const n=Number(nText),ids=idsText.split(','),customIndex=process.argv.indexOf('--configs');
 if(customIndex>=0)Object.assign(REROLL_CONFIGS,JSON.parse(await readFile(process.argv[customIndex+1],'utf8')));
 if(!['development','validation','confirmation'].includes(stage)||n<250||n%250||ids.some(id=>!REROLL_CONFIGS[id]))throw new Error('stage、250の倍数、有効な方略を指定');
 const root=`solver/local-runs/pro-reroll/${stage}`,seed=`pro-reroll-v1-${stage}`,jobs=[],runs=[];
 await mkdir(root,{recursive:true});
 for(const id of ids){const config={id,...REROLL_CONFIGS[id]},configPath=`${root}/${id}-config.json`,files=[];
  await writeFile(configPath,JSON.stringify(config,null,2)+'\n');
  for(let b=0;b<n/250;b++){const output=`${root}/${id}-batch${b}.json`;files.push(path.resolve(output));jobs.push({id,b,config,configPath,output});}
  runs.push({id,description:JSON.stringify(config),files});}
 const baseline=ids.includes('any-engine')?'any-engine':ids.includes('pair-13-17')?'pair-13-17':null;
 const comparisons=baseline?ids.filter(id=>id!==baseline).map(id=>({id:`${baseline}-to-${id}`,before:baseline,after:id})):[];
 if(stage==='validation')for(const [before,after]of [['pair-13-17','relaxed-finance'],['pair-7-15','pair-13-17']])if(ids.includes(before)&&ids.includes(after)&&before!==baseline)comparisons.push({id:`${before}-to-${after}`,before,after});
 await writeFile(`${root}/manifest.json`,JSON.stringify({stage,n,seed,runs,comparisons},null,2)+'\n');
 const strategyVersion=createHash('sha256').update(await readFile('solver/autoplay-agent.mjs')).update(await readFile('solver/browser/pro-strategy-research.js')).digest('hex');
 const sources=await Promise.all((await readdir('game/js')).filter(name=>name.endsWith('.js')).sort().map(async name=>name+await readFile(`game/js/${name}`,'utf8')));
 const codeHash=createHash('sha256').update(sources.join('\n')).digest('hex'),cardVersion='sha256:'+createHash('sha256').update(await readFile('game/data/cards_pro.csv')).digest('hex'),rankVersion='sha256:'+createHash('sha256').update(await readFile('game/data/rankPro.csv')).digest('hex');
 let next=0,done=0;
 async function worker(index){while(next<jobs.length){const job=jobs[next++];
  if(process.argv.includes('--resume'))try{const data=JSON.parse(await readRunBytes(job.output));if(reusableRun(data,{seed,offset:job.b*250,config:job.config,strategyVersion,codeHash,cardVersion,rankVersion})){console.log(`reuse ${job.id}/${job.b}`);done++;continue;}}catch{}
  console.log(`start ${stage}/${job.id} batch${job.b}`);let log='';
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['solver/autoplay-agent.mjs','--difficulty','pro','--episodes','250','--episode-offset',String(job.b*250),'--seed',seed,'--policies','pro_goal','--acquisition-model','pro_splus','--refresh-policy','public','--refresh-model','pro_splus','--research-config',job.configPath,'--port',String(18280+index),'--output',job.output,'--trace-samples','0','--no-report'],{stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',s=>log+=s);child.stderr.on('data',s=>log+=s);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${job.id}: ${code}\n${log}`)));});
  await writeFile(`${root}/${job.id}-batch${job.b}.log`,log);
  const data=JSON.parse(await readRunBytes(job.output)),sim=data.simulations[0];
  console.log(`done ${++done}/${jobs.length} ${job.id}/${job.b}: median=${sim.scoreSummary.p50} mean=${sim.scoreSummary.mean.toFixed(3)} >=15=${sim.playRecords.filter(r=>r.result.score.displayScore>=15).length}/250 starts=${sim.playRecords.reduce((s,r)=>s+(r.metadata.reroll?.attempts||1),0)}`);
  await compressRun(job.output);
 }}
 await Promise.all([worker(0),worker(1)]);
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname))main().catch(error=>{console.error(error);process.exitCode=1;});
