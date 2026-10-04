#!/usr/bin/env node
/** 対照試験の起動・記録だけ。判断と実ゲームの操作はブラウザで実施する。 */
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {prepareSceneBatch} from './pro-card-scene-input.mjs';
import {readRunBytes} from './pro-strategy-metrics.mjs';
import {compressRun} from './compress-research-runs.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function main(){
 const [stage='card-scenes-development-trials']=process.argv.slice(2);
 if(!/^[a-z0-9-]+$/.test(stage))throw Error('安全なstage名が必要');
 const option=(key,fallback)=>{const i=process.argv.indexOf(key);return i>=0?process.argv[i+1]:fallback;};
 const root=`solver/local-runs/pro-mean125/${stage}`,bankRoot=option('--bank-root','solver/local-runs/pro-mean125/card-scenes-development'),nos=option('--cards','43,51').split(',').map(Number);
 if(!nos.length||new Set(nos).size!==nos.length||nos.some(n=>!Number.isInteger(n)||n<6||n>51))throw Error('有効なカードNoが必要');
 const at=process.argv.indexOf('--port-base'),port=at>=0?Number(process.argv[at+1]):18820;
 if(!Number.isInteger(port)||port<1024||port>65534)throw Error('安全なポートが必要');
 await mkdir(root,{recursive:true});
 const files=['solver/autoplay-agent.mjs','solver/browser/pro-strategy-research.js','solver/browser/pro-risk-research.js','solver/browser/pro-value-model.js','solver/browser/pro-learned-research.js','solver/browser/pro-public-action-kernel.js','solver/pro-card-scene-input.mjs'];
 const sources=await Promise.all((await readdir('game/js')).filter(n=>n.endsWith('.js')).sort().map(async n=>n+await readFile(`game/js/${n}`,'utf8')));
 const fingerprints={strategyVersion:sha(Buffer.concat(await Promise.all(files.map(f=>readFile(f))))),codeHash:sha(sources.join('\n')),cardVersion:'sha256:'+sha(await readFile('game/data/cards_pro.csv')),rankVersion:'sha256:'+sha(await readFile('game/data/rankPro.csv'))};
 const configs=JSON.parse(await readFile(option('--configs','solver/research-scenarios/pro-mean125-leaf-configs.json'),'utf8')),continuation=option('--continuation','champion-v1');
 if(!configs[continuation]||configs[continuation].initial)throw Error('リセマラなしの後続方略が必要');
 const config={...configs[continuation],id:continuation==='champion-v1'?'card-scene-continuation-v1':`card-scene-continuation-${continuation}`,fastPublicActions:true};
 config.valueModelSha256=sha(await readFile(config.valueModelPath));
 const configFile=`${root}/continuation-config.json`;await writeFile(configFile,JSON.stringify(config,null,2)+'\n');
 const jobs=[],runs=[],banks={},comparisons=[];
 for(const no of nos){
  const bankFile=`${bankRoot}/card-${no}.json`,bytes=await readFile(bankFile),bank=JSON.parse(bytes),n=bank.scenes.length;
  if(bank.cardNo!==no||n<500||n%250)throw Error('各カードの時期別250局面が必要');
  banks[no]={file:path.resolve(bankFile),sha256:sha(bytes),n,referenceMode:bank.referenceMode||'original-other',originalTargetCount:bank.scenes.filter(s=>s.referenceWasOriginalChoice===false).length};
  for(const arm of ['reference','target']){
   const input=prepareSceneBatch(bytes,arm,{episodes:n,versions:[fingerprints.codeHash,fingerprints.cardVersion,fingerprints.rankVersion]});
   const id=`card-${no}-${arm}`,outputs=[];
   for(let b=0;b<n/250;b++){const output=`${root}/${id}-batch${b}.json`;outputs.push(path.resolve(output));jobs.push({id,no,arm,b,output,bankFile,input,seed:`pro-mean125-${stage}-card-${no}`});}
   runs.push({id,description:`No${no}: ${arm}; same public scenes and continuation policy`,files:outputs});
  }
  comparisons.push({id:`card-${no}`,before:`card-${no}-reference`,after:`card-${no}-target`});
 }
 await writeFile(`${root}/manifest.json`,JSON.stringify({stage,purpose:'development counterfactuals; not full-game mean125 confirmation',fingerprints,config,banks,runs,comparisons},null,2)+'\n');
 const valid=(data,j)=>{const s=data.settings,rs=data.simulations?.[0]?.playRecords;
  return s?.seed===j.seed&&s.episodeOffset===j.b*250&&s.episodes===250&&JSON.stringify(s.research)===JSON.stringify(config)&&
   s.provenance?.strategyVersion===fingerprints.strategyVersion&&rs?.length===250&&rs.every((r,i)=>{const m=r.metadata,expected=j.input.scenes[j.b*250+i];
    return !!r.result?.score&&!r.truncated&&m.seed===`${j.seed}:${j.b*250+i}`&&m.provenance.strategyVersion===fingerprints.strategyVersion&&m.source==='counterfactual'&&!m.reroll&&m.sceneArm===j.arm&&m.sceneId===expected.sceneId&&m.sceneBankSha256===j.input.sha256&&m.sceneObservationSha256===expected.observationSha256&&
     JSON.stringify(m.forcedChoice)===JSON.stringify(expected.forcedChoice)&&m.provenance.codeHash===fingerprints.codeHash&&m.cardVersion===fingerprints.cardVersion&&m.rankVersion===fingerprints.rankVersion;});};
 let next=0,done=0;
 async function worker(w){while(next<jobs.length){const j=jobs[next++],started=Date.now();
  if(process.argv.includes('--resume'))try{if(valid(JSON.parse(await readRunBytes(j.output)),j)){console.log(`reuse ${j.id}/${j.b}`);done++;continue;}}catch{}
  console.log(`start ${j.id}/${j.b}: 250 public scenes`);let log='',buffer='';
  await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['solver/autoplay-agent.mjs','--difficulty','pro','--episodes','250','--episode-offset',String(j.b*250),'--seed',j.seed,
   '--policies','pro_goal','--acquisition-model','pro_splus','--refresh-policy','public','--refresh-model','pro_splus','--research-config',configFile,
   '--decision-batch',j.bankFile,'--scene-arm',j.arm,'--port',String(port+w),'--output',j.output,'--no-report'],{stdio:['ignore','pipe','pipe']});
   p.stdout.on('data',s=>{log+=s;buffer+=s;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines)if(line.startsWith('CDG_RESEARCH_PROGRESS '))console.log(`[${j.id}/${j.b}] ${line}`);});
   p.stderr.on('data',s=>log+=s);p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error(`${j.id}: ${code}\n${log}`)));});
  await writeFile(`${root}/${j.id}-batch${j.b}.log`,log);
  const d=JSON.parse(await readRunBytes(j.output));if(!valid(d,j))throw Error('完走記録と固定した実験入力の不一致');
  console.log(`done ${++done}/${jobs.length} ${j.id}/${j.b}: minutes=${((Date.now()-started)/60000).toFixed(2)}`);
  await compressRun(j.output);
 }}
 await Promise.all([worker(0),worker(1)]);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
