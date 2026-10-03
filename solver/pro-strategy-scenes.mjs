#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const root='solver/local-runs/pro-strategy/scenes';await mkdir(root,{recursive:true});
const runs=[],jobs=[];
for(const scene of ['engine-ready','finance-short'])for(const choice of [0,1,2]){
 const id=`${scene}-${choice}`,output=`${root}/${id}.json`;jobs.push({scene,choice,id,output});
 runs.push({id,description:`${scene}: forced ${[49,43,50][choice]}`,files:[path.resolve(output)]});}
let index=0;
async function worker(w){while(index<jobs.length){const j=jobs[index++];console.log(`start scene ${j.id}: 250 seeds`);
 await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['solver/autoplay-agent.mjs','--difficulty','pro','--episodes','250',
  '--policies','pro_goal','--acquisition-model','pro_splus','--refresh-policy','public','--refresh-model','pro_splus',
  '--seed',`pro-strategy-v1-scene-${j.scene}`,'--decision-file',`solver/research-scenarios/${j.scene}.json`,
  '--forced-choice',String(j.choice),'--port',String(18270+w),'--output',j.output,'--no-report'],{stdio:['ignore','pipe','pipe']});
 let log='';p.stdout.on('data',c=>log+=c);p.stderr.on('data',c=>log+=c);p.on('error',reject);p.on('exit',code=>code?reject(Error(`${j.id}\n${log}`)):resolve());});
 const d=JSON.parse(await readFile(j.output,'utf8')),s=d.simulations[0];console.log(`done ${j.id}: median=${s.scoreSummary.p50}, >=15=${s.playRecords.filter(r=>r.result.score.displayScore>=15).length}/250`);
}}
await Promise.all([worker(0),worker(1)]);
const comparisons=[];for(const scene of ['engine-ready','finance-short'])for(const c of [1,2])comparisons.push({id:`${scene}-0-to-${c}`,before:`${scene}-0`,after:`${scene}-${c}`});
await writeFile(`${root}/manifest.json`,JSON.stringify({stage:'scenes',n:250,runs,comparisons},null,2)+'\n');
