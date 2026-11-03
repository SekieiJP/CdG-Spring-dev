#!/usr/bin/env node
/** 少数完走は接続確認のみ。成績の比較は各250開始以上で行う。 */
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {ACTOR_FILES} from './pro-choice-scene-study.mjs';
import {auditAhiruBatch} from './ahiru-pro-metrics.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const option=(key,value)=>{const i=process.argv.indexOf(key);return i<0?value:process.argv[i+1];};
const stage=option('--stage','ahiru-technical-20261103'),configPath=option('--configs','solver/research-scenarios/ahiru-pro-stability-configs.json'),ids=option('--ids','baseline,downside025,downside050').split(','),seed=option('--seed','ahiru-pro-technical-20261103'),outputReport=option('--output','solver/research-results/ahiru-advice-20261103/technical.json'),port=Number(option('--port','19100'));
if(!/^[a-z0-9-]+$/.test(stage)||!ids.length||ids.some(id=>!/^[-a-z0-9]+$/.test(id))||new Set(ids).size!==ids.length||!Number.isInteger(port)||port<1024||port>65535)throw Error('接続確認の条件が不正');
const actor=async()=>sha(Buffer.concat(await Promise.all(ACTOR_FILES.map(file=>readFile(file)))));
const sources=await Promise.all((await readdir('game/js')).filter(file=>file.endsWith('.js')).sort().map(async file=>file+await readFile(`game/js/${file}`,'utf8')));
const fingerprints={strategyVersion:await actor(),codeHash:sha(sources.join('\n')),cardVersion:'sha256:'+sha(await readFile('game/data/cards_pro.csv')),rankVersion:'sha256:'+sha(await readFile('game/data/rankPro.csv'))};
const configBytes=await readFile(configPath),configs=JSON.parse(configBytes),root=`solver/local-runs/pro-mean125/${stage}`;
if(ids.some(id=>!configs[id]||configs[id].initial))throw Error('全条件の固定設定が必要');
await mkdir(root,{recursive:true});const manifestPath=root+'/manifest.json';
if((await readdir(root)).length)throw Error('既存の接続記録は上書きしない');
await writeFile(manifestPath,JSON.stringify({stage,configPath,configSha256:sha(configBytes),ids,seed,fingerprints},null,2)+'\n');
const checks=[],records=new Map();
for(const id of ids){
    const config={id,...configs[id]},modelHash=sha(await readFile(config.valueModelPath));
    if(config.valueModelSha256&&config.valueModelSha256!==modelHash)throw Error('固定モデルと不一致');config.valueModelSha256=modelHash;
    if(await actor()!==fingerprints.strategyVersion||sha(await readFile(configPath))!==sha(configBytes))throw Error('固定したコード・条件が変更された');
    const file=`${root}/${id}-config.json`,output=`${root}/${id}.json`;await writeFile(file,JSON.stringify(config,null,2)+'\n');
    console.log('start technical '+id);
    await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['solver/autoplay-agent.mjs','--difficulty','pro','--episodes','1','--episode-offset','0','--seed',seed,'--policies','pro_goal','--acquisition-model','pro_splus','--refresh-policy','public','--refresh-model','pro_splus','--research-config',file,'--port',String(port),'--output',output,'--trace-samples','0','--no-report'],{stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',s=>log+=s);child.stderr.on('data',s=>log+=s);child.on('error',reject);child.on('exit',async code=>{try{await writeFile(`${root}/${id}.log`,log);code===0?resolve():reject(Error(`${id}: ${code}\n${log}`));}catch(error){reject(error);}});});
    const bytes=await readFile(output),data=JSON.parse(bytes),rs=auditAhiruBatch(data,{seed,offset:0,config,fingerprints,episodes:1});records.set(id,rs[0]);
    checks.push({id,complete:true,placementTurns:8,rerolls:0,sha256:sha(bytes),output,modelSha256:modelHash});console.log('done technical '+id);
}
let zeroWeightTraceMatchesLegacy=null;
if(records.has('legacy-zero')&&records.has('baseline')){
    const normalized=record=>({score:record.result.score,deck:record.result.finalDeck.map(card=>[String(card.cardNo),card.effect,card.acquiredTurn]).sort(),events:record.events.flatMap(event=>{
        if(event.type==='research-acquisition-decision')return [[event.type,event.turn,event.chosenIndices.map(i=>String(event.observation.candidates[i].cardNo))]];
        if(event.type==='research-placement-decision')return [[event.type,event.turn,event.placements.map(p=>[p.cardNo,p.slot])]];
        if(event.type==='resolve')return [[event.type,event.turn,event.cardNo,event.staff,event.applied,event.afterStats,event.afterTokens]];
        if(event.type==='draw')return [[event.type,event.turn,event.requested,event.cards.map(card=>card.cardNo)]];
        if(event.type==='delete')return [[event.type,event.turn,event.card.cardNo]];
        if(event.type==='refresh')return [[event.type,event.turn,event.cards.map(card=>card.cardNo)]];
        return [];
    })});
    zeroWeightTraceMatchesLegacy=JSON.stringify(normalized(records.get('legacy-zero')))===JSON.stringify(normalized(records.get('baseline')));
    if(!zeroWeightTraceMatchesLegacy)throw Error('係数0で従来の平均モデルの行動・最終値が変わった');
}
if(await actor()!==fingerprints.strategyVersion)throw Error('接続確認中の版変更');
const report={createdAt:new Date().toISOString(),purpose:'少数のブラウザ接続と全8配置の技術確認。得点から強さの傾向は主張しない。',fingerprints,configPath,configSha256:sha(configBytes),checks,zeroWeightTraceMatchesLegacy};
await writeFile(outputReport,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({checks:checks.length,zeroWeightTraceMatchesLegacy,allComplete:true}));
