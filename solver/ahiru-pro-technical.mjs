#!/usr/bin/env node
/** 3完走は接続確認。方略の成績比較は別の各250開始で行う。 */
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {ACTOR_FILES} from './pro-choice-scene-study.mjs';
import {auditAhiruBatch} from './ahiru-pro-metrics.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const actor=async()=>sha(Buffer.concat(await Promise.all(ACTOR_FILES.map(f=>readFile(f)))));
const sources=await Promise.all((await readdir('game/js')).filter(f=>f.endsWith('.js')).sort().map(async f=>f+await readFile(`game/js/${f}`,'utf8'))),fingerprints={strategyVersion:await actor(),codeHash:sha(sources.join('\n')),cardVersion:'sha256:'+sha(await readFile('game/data/cards_pro.csv')),rankVersion:'sha256:'+sha(await readFile('game/data/rankPro.csv'))};
const configs=JSON.parse(await readFile('solver/research-scenarios/ahiru-pro-stability-configs.json')),root='solver/local-runs/pro-mean125/ahiru-technical-20261103';await mkdir(root,{recursive:true});const checks=[];
for(const id of ['baseline','downside025','downside050']){
 const config={id,...configs[id]};config.valueModelSha256=sha(await readFile(config.valueModelPath));const configFile=`${root}/${id}-config.json`,output=`${root}/${id}.json`,seed='ahiru-pro-technical-20261103';await writeFile(configFile,JSON.stringify(config,null,2)+'\n');
 await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['solver/autoplay-agent.mjs','--difficulty','pro','--episodes','1','--episode-offset','0','--seed',seed,'--policies','pro_goal','--acquisition-model','pro_splus','--refresh-policy','public','--refresh-model','pro_splus','--research-config',configFile,'--port','19100','--output',output,'--trace-samples','0','--no-report'],{stdio:'inherit'});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error(`${id}: ${code}`)));});
 const bytes=await readFile(output);auditAhiruBatch(JSON.parse(bytes),{seed,offset:0,config,fingerprints,episodes:1});checks.push({id,complete:true,placementTurns:8,rerolls:0,sha256:sha(bytes),output,modelSha256:config.valueModelSha256});
}
if(await actor()!==fingerprints.strategyVersion)throw Error('接続確認中の版変更');
const report={createdAt:new Date().toISOString(),purpose:'全3条件のブラウザ接続と8配置完走のみ。少数の得点から強さを主張しない。',fingerprints,checks};await mkdir('solver/research-results/ahiru-advice-20261103',{recursive:true});await writeFile('solver/research-results/ahiru-advice-20261103/technical.json',JSON.stringify(report,null,2)+'\n');console.log('All three browser integration checks passed.');
