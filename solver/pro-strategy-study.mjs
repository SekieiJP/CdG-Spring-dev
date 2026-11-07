#!/usr/bin/env node
/** Nodeは実験の起動・記録だけを担当。判断と実ゲーム操作はautoplayのブラウザ内。 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const CONFIGS = {
 control:['control','control','control','median'],
 'acq-median':['median','control','control','median'],
 'acq-ceiling':['ceiling','control','control','ceiling'],
 'acq-engine':['engine','control','control','engine'],
 'place-median':['control','median','control','median'],
 'place-ceiling':['control','ceiling','control','ceiling'],
 'place-engine':['control','engine','control','engine'],
 'place-myopic':['control','myopic','control','median'],
 'delete-off':['control','control','off','median'],
 'delete-basic':['control','control','basic','median'],
 'delete-adaptive':['control','control','adaptive','median'],
 'delete-aggressive':['control','control','aggressive','median'],
 'full-median':['median','median','adaptive','median'],
 'full-ceiling':['ceiling','ceiling','adaptive','ceiling'],
 'full-engine':['engine','engine','aggressive','engine']
};
async function main() {
 const stage=process.argv[2]||'development',n=Number(process.argv[3]||250),ids=(process.argv[4]||Object.keys(CONFIGS).join(',')).split(',');
 if(!['development','validation','confirmation'].includes(stage)||n<250||n%250||ids.some(id=>!CONFIGS[id]))throw new Error('stage development|validation|confirmation, N>=250の250倍数, 有効な方略名を指定');
 const root=`solver/local-runs/pro-strategy/${stage}`,seed=`pro-strategy-v1-${stage}`;
 await mkdir(root,{recursive:true});const jobs=[],runs=[];
 for(const id of ids){const [acquisition,placement,deletion,objective]=CONFIGS[id],config={id,acquisition,placement,deletion,objective};
   const configPath=`${root}/${id}-config.json`;await writeFile(configPath,JSON.stringify(config,null,2)+'\n');const files=[];
   for(let b=0;b<n/250;b++){const output=`${root}/${id}-batch${b}.json`;files.push(path.resolve(output));jobs.push({id,b,output,configPath,config});}
   runs.push({id,description:JSON.stringify(config),files});}
 const manifest={stage,n,seed,runs,comparisons:ids.filter(id=>id!=='control'&&ids.includes('control')).map(id=>({id:`control-to-${id}`,before:'control',after:id}))};
 await writeFile(`${root}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
 let index=0,completed=0;
 const resume=process.argv.includes('--resume');
 const strategyVersion=createHash('sha256').update(await readFile('solver/autoplay-agent.mjs')).update(await readFile('solver/browser/pro-strategy-research.js')).digest('hex');
 async function worker(workerIndex){while(index<jobs.length){const job=jobs[index++];
   if(resume){try{const d=JSON.parse(await readFile(job.output,'utf8'));if(d.settings.seed===seed&&d.settings.episodeOffset===job.b*250&&d.settings.episodes===250&&JSON.stringify(d.settings.research)===JSON.stringify(job.config)&&d.simulations[0].playRecords.length===250&&d.settings.provenance.strategyVersion===strategyVersion){console.log(`reuse completed ${job.id} batch${job.b}`);completed++;continue;}}catch{}}
   console.log(`[${new Date().toISOString()}] start ${stage}/${job.id} ${job.b*250}..${job.b*250+249}`);
   const argv=['solver/autoplay-agent.mjs','--difficulty','pro','--episodes','250','--episode-offset',String(job.b*250),'--seed',seed,
     '--policies','pro_goal','--acquisition-model','pro_splus','--refresh-policy','public','--refresh-model','pro_splus',
     '--research-config',job.configPath,'--port',String(18260+workerIndex),'--output',job.output,'--trace-samples','0','--no-report'];
   let output='';await new Promise((resolve,reject)=>{
     const proc=spawn(process.execPath,argv,{stdio:['ignore','pipe','pipe']});
     proc.stdout.on('data',chunk=>{output+=chunk;});proc.stderr.on('data',chunk=>{output+=chunk;});
     proc.on('error',reject);proc.on('exit',code=>code===0?resolve():reject(new Error(`${job.id}: ${code}\n${output}`)));
   });
   const data=JSON.parse(await readFile(job.output,'utf8')),sim=data.simulations[0],k=sim.playRecords.filter(r=>r.result.score.displayScore>=15).length;
   console.log(`[${new Date().toISOString()}] done ${++completed}/${jobs.length} ${job.id} batch${job.b}: median=${sim.scoreSummary.p50} mean=${sim.scoreSummary.mean.toFixed(3)} >=15=${k}/250`);
   await writeFile(`${root}/${job.id}-batch${job.b}.log`,output);
 }}
 await Promise.all([worker(0),worker(1)]);
 console.log(`Manifest: ${root}/manifest.json`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname))main().catch(e=>{console.error(e);process.exitCode=1;});
