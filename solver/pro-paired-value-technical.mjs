#!/usr/bin/env node
/** 接続確認のみ。合成教師の学習を実ゲームの成績検証と混同しない。 */
import http from 'node:http';
import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {ACTOR_FILES} from './pro-choice-scene-study.mjs';
import {prepareChoiceSceneBatch} from './pro-card-scene-input.mjs';
import {readRunBytes} from './pro-strategy-metrics.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),physical=['69ccd7dcc729c83823b50d311ac032e11865867e4a1fc9b10ed4816802b6aa2e','sha256:15fbf3fdb5e2a5d0af4830afeb7c71fc8a03bf0517767c4e1e19ceee684a229f','sha256:0648faf52193dd8e3f5173a18e45d10e6fa9f1e6c190a42792a5b02ffa5e9731'];
const bankFile='solver/local-runs/pro-mean125/paired-value-scenes-v1/choices.json',bankBytes=await readFile(bankFile),bank=JSON.parse(bankBytes),dir='solver/local-runs/pro-mean125/paired-value-technical';
await mkdir(dir,{recursive:true});const actor=sha(Buffer.concat(await Promise.all(ACTOR_FILES.map(f=>readFile(f)))));
const gameRoot=path.resolve('game'),port=19050,server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1'),p=decodeURIComponent(url.pathname),research=['/research/pro-paired-value.js','/research/pro-value-model.js'].includes(p);
 const f=research?path.resolve('solver/browser',path.basename(p)):path.resolve(gameRoot,'.'+(p==='/'?'/index.html':p));
 if(!f.startsWith((research?path.resolve('solver/browser'):gameRoot)+path.sep))throw Error('path');
 res.writeHead(200,{'Content-Type':f.endsWith('.js')?'application/javascript':f.endsWith('.html')?'text/html':'text/plain','Cache-Control':'no-store'});res.end(await readFile(f));
}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});let browserFeatures;
try{const page=await browser.newPage();await page.route('**/*',r=>new URL(r.request().url()).origin===`http://127.0.0.1:${port}`?r.continue():r.abort());await page.goto(`http://127.0.0.1:${port}/`);await page.waitForFunction(()=>window.game?.cardManager?.allCards.length>0);
 browserFeatures=await page.evaluate(async scene=>{
  await window.game.setDifficulty('pro');const vm=await import('/research/pro-value-model.js'),pair=await import('/research/pro-paired-value.js'),formula=await import('/js/proAcquisitionAdvisor.js');
  const context={forecast:vm.createValueForecaster(formula.projectProDeck),score:formula.proGoal},root={...scene.observation,rankTable:window.game.scoreManager.rankTable},x=pair.encodePairedFeatures(root,scene.referenceIndices,scene.targetIndices,context),reverse=pair.reversePairedFeatures(x);
  const synthetic=Array.from({length:24},(_,i)=>{const z=[...x];z[z.length-1]=i-12;return {x:z,y:(i-12)*.1,weight:1};});
  const model=await vm.trainValueModel(synthetic,{iterations:20,depth:2,minRows:2,minWeight:1,bins:8,l2:1,learningRate:.1,rowFraction:1,featureFraction:1,schema:pair.PAIRED_SCHEMA,featureNames:pair.PAIRED_FEATURES});
  const gain=pair.predictPairedGain(model,x),reverseGain=pair.predictPairedGain(model,reverse);
  const scalarX=x.slice(0,vm.VALUE_FEATURES.length),scalar=await vm.trainValueModel(Array.from({length:4},()=>({x:scalarX,y:3,weight:1})),{iterations:2});
  const dangerous={...root};for(const name of ['seed','futureScore','futureDeck','rng'])Object.defineProperty(dangerous,name,{get(){throw Error('hidden property access');}});
  if(JSON.stringify(pair.encodePairedFeatures(dangerous,scene.referenceIndices,scene.targetIndices,context))!==JSON.stringify(x)||!x.every(Number.isFinite)||Math.abs(gain+reverseGain)>1e-12||scalar.schema!==vm.VALUE_SCHEMA||vm.predictValue(scalar,scalarX)!==3)throw Error('browser feature/training/prediction compatibility failure');
  return {featureCount:x.length,schema:model.schema,syntheticTrainingRows:24,trainingAndFeaturesInBrowser:true,antisymmetryError:Math.abs(gain+reverseGain),scalarDefaultsCompatible:true,hiddenFieldsNotRead:true,syntheticOnly:true};
 },bank.scenes[0]);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
const configs=JSON.parse(await readFile('solver/research-scenarios/pro-mean125-component-value6-configs.json')),config={id:'paired-value-technical-v1',...configs.baseline};config.valueModelSha256=sha(await readFile(config.valueModelPath));const configFile=dir+'/config.json';await writeFile(configFile,JSON.stringify(config,null,2)+'\n');
const later=bank.scenes.findIndex(s=>s.observation.turn>0&&s.observation.tokens.inspiration>0);if(later<0)throw Error('持ち越し発想を含む接続局面がない');const checks=[];
for(const index of [0,later])for(const arm of ['reference','target']){
 const input=prepareChoiceSceneBatch(bankBytes,arm,{episodes:1,offset:index,versions:physical}),scene=input.scenes[index],output=`${dir}/scene-${index}-${arm}.json`;
 await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['solver/autoplay-agent.mjs','--difficulty','pro','--episodes','1','--episode-offset',String(index),'--seed','pro-paired-value-technical','--policies','pro_goal','--acquisition-model','pro_splus','--refresh-policy','public','--refresh-model','pro_splus','--research-config',configFile,'--decision-batch',bankFile,'--scene-arm',arm,'--port','19050','--output',output,'--trace-samples','0','--no-report'],{stdio:'inherit'});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error('technical continuation exit '+code)));});
 const bytes=await readRunBytes(output),d=JSON.parse(bytes),r=d.simulations?.[0]?.playRecords?.[0],m=r?.metadata,start=r?.events.find(e=>e.type==='research-counterfactual-start'),placement=r?.events.filter(e=>e.type==='research-placement-decision');
 if(d.simulations[0].playRecords.length!==1||!Number.isFinite(r?.result?.score?.displayScore)||r.truncated||m.reroll||m.source!=='counterfactual'||m.sceneKind!=='choices'||m.sceneArm!==arm||m.provenance.strategyVersion!==actor||JSON.stringify([m.provenance.codeHash,m.cardVersion,m.rankVersion])!==JSON.stringify(physical)||JSON.stringify(m.research)!==JSON.stringify(config)||JSON.stringify(m.forcedChoice)!==JSON.stringify(scene.forcedChoice)||m.sceneBankSha256!==input.sha256||m.sceneObservationSha256!==scene.observationSha256||JSON.stringify(start.observation)!==JSON.stringify(scene.observation)||placement.length!==8-scene.observation.turn||placement[0].observation.tokens.inspiration!==0)throw Error('public scene/forced choice/physics/completion mismatch');
 const acquired=r.events.filter(e=>e.type==='acquire').slice(scene.observation.owned.length,scene.observation.owned.length+scene.forcedChoice.length);if(acquired.length!==scene.forcedChoice.length||acquired.some((e,i)=>String(e.card.cardNo)!==String(scene.observation.candidates[scene.forcedChoice[i]].cardNo)))throw Error('forced acquisition mismatch');
 checks.push({sceneId:scene.sceneId,index,arm,turn:scene.observation.turn,pickCount:scene.observation.pickCount,startingInspiration:scene.observation.tokens.inspiration,placementTurns:placement.length,complete:true,rerolls:0,file:output,sha256:sha(bytes),sceneObservationSha256:scene.observationSha256,actor11:actor});
}
if(sha(Buffer.concat(await Promise.all(ACTOR_FILES.map(f=>readFile(f)))))!==actor)throw Error('technical source changed');
const report={createdAt:new Date().toISOString(),purpose:'合成教師と4継続の接続確認のみ。強さ・改善・カードパワーの根拠ではない。',bank:{file:bankFile,sha256:sha(bankBytes),n:750},physical,actor11:actor,browserFeatures,checks};
await writeFile('solver/research-results/pro-mean125-20261004/paired-value-technical-check.json',JSON.stringify(report,null,2)+'\n');console.log('Browser paired-feature training and four public continuations passed.');
