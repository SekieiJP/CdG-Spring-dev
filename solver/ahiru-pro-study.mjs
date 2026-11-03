#!/usr/bin/env node
/** 起動と記録管理のみ。ゲーム操作・判断はブラウザの既存エージェント。 */
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {ACTOR_FILES} from './pro-choice-scene-study.mjs';
import {readRunBytes} from './pro-strategy-metrics.mjs';
import {auditAhiruBatch} from './ahiru-pro-metrics.mjs';
import {compressRun} from './compress-research-runs.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function main(){
 const [stage,nText='250',idsText='baseline,downside025,downside050']=process.argv.slice(2),n=Number(nText),option=(key,value)=>{const i=process.argv.indexOf(key);return i<0?value:process.argv[i+1];},workers=Number(option('--workers','2')),port=Number(option('--port-base','19110')),configFile=option('--configs','solver/research-scenarios/ahiru-pro-stability-configs.json'),ids=idsText.split(','),seed=option('--seed',`ahiru-pro-${stage}`);
 if(!/^[a-z0-9:_-]+$/i.test(seed)||!/^[a-z0-9-]+$/.test(stage||'')||![250,1000,2000].includes(n)||![1,2].includes(workers)||!Number.isInteger(port)||port<1024||port+workers>65535||new Set(ids).size!==ids.length||n!==250&&ids.length!==1)throw Error('stage、250/1000（旧2000）、条件、workers1/2、portが必要');
 const configs=JSON.parse(await readFile(configFile));if(ids.some(id=>!configs[id]||configs[id].initial))throw Error('リセマラなしの固定条件が必要');
 const actorHash=async()=>sha(Buffer.concat(await Promise.all(ACTOR_FILES.map(f=>readFile(f))))),sources=await Promise.all((await readdir('game/js')).filter(f=>f.endsWith('.js')).sort().map(async f=>f+await readFile(`game/js/${f}`,'utf8')));
 const fingerprints={strategyVersion:await actorHash(),codeHash:sha(sources.join('\n')),cardVersion:'sha256:'+sha(await readFile('game/data/cards_pro.csv')),rankVersion:'sha256:'+sha(await readFile('game/data/rankPro.csv'))};
 const root=`solver/local-runs/pro-mean125/${stage}`,jobs=[],runs=[];await mkdir(root,{recursive:true});
 for(const id of ids){const config={id,...configs[id]},modelSha=sha(await readFile(config.valueModelPath));if(config.valueModelSha256&&config.valueModelSha256!==modelSha)throw Error('固定されたモデルSHAと異なる');config.valueModelSha256=modelSha;const configPath=`${root}/${id}-config.json`;const files=[];
  for(let b=0;b<n/250;b++){const output=`${root}/${id}-batch${b}.json`;files.push(path.resolve(output));jobs.push({id,b,output,config,configPath});}runs.push({id,config,files});
 }
 const manifest={stage,n,phase:n!==250?'validation':'development',seed,fingerprints,actorFiles:ACTOR_FILES,requirement:'all accepted starts; no rerolls; mean >=12; score <=8 strictly under 2%',configFile,configSha256:sha(await readFile(configFile)),runs};
 const manifestPath=`${root}/manifest.json`;
 if(process.argv.includes('--resume')){const old=JSON.parse(await readFile(manifestPath));if(JSON.stringify(old)!==JSON.stringify(manifest))throw Error('再開条件が元の固定計画と異なる');}else{try{await readFile(manifestPath);throw Error('既存の実行がある。変更せず --resume で監査して再開する');}catch(e){if(e.code!=='ENOENT')throw e;}}
 for(const run of runs)await writeFile(`${root}/${run.id}-config.json`,JSON.stringify(run.config,null,2)+'\n');
 await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');let next=0,done=0;
 async function worker(w){while(next<jobs.length){const j=jobs[next++],started=Date.now();
  if(await actorHash()!==fingerprints.strategyVersion||sha(await readFile(j.config.valueModelPath))!==j.config.valueModelSha256||sha(await readFile(configFile))!==manifest.configSha256)throw Error('固定した方略・モデル・設定が変わった');
  if(process.argv.includes('--resume'))try{auditAhiruBatch(JSON.parse(await readRunBytes(j.output)),{seed,offset:j.b*250,config:j.config,fingerprints});done++;console.log(`reuse ${j.id}/${j.b}`);continue;}catch(e){if(e.code!=='ENOENT')throw e;}
  console.log(`start ${stage}/${j.id} batch${j.b}: 250 accepted starts`);let log='',buffer='';
  await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['solver/autoplay-agent.mjs','--difficulty','pro','--episodes','250','--episode-offset',String(j.b*250),'--seed',seed,'--policies','pro_goal','--acquisition-model','pro_splus','--refresh-policy','public','--refresh-model','pro_splus','--research-config',j.configPath,'--port',String(port+w),'--output',j.output,'--trace-samples','0','--no-report'],{stdio:['ignore','pipe','pipe']});p.stdout.on('data',s=>{log+=s;buffer+=s;const lines=buffer.split('\n');buffer=lines.pop();for(const l of lines)if(l.startsWith('CDG_RESEARCH_PROGRESS '))console.log(`[${j.id}/${j.b}] ${l}`);});p.stderr.on('data',s=>log+=s);p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error(`${j.id}/${j.b}: exit ${code}\n${log}`)));});
  await writeFile(`${root}/${j.id}-batch${j.b}.log`,log);const rs=auditAhiruBatch(JSON.parse(await readRunBytes(j.output)),{seed,offset:j.b*250,config:j.config,fingerprints});const values=rs.map(r=>r.result.score.displayScore);
  await compressRun(j.output);console.log(`done ${++done}/${jobs.length} ${j.id}/${j.b}: mean=${values.reduce((s,v)=>s+v,0)/250} score<=8=${values.filter(v=>v<=8).length}/250 minutes=${((Date.now()-started)/60000).toFixed(2)}`);
 }}
 await Promise.all(Array.from({length:workers},(_,w)=>worker(w)));if(await actorHash()!==fingerprints.strategyVersion)throw Error('試験中の方略変更');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
