#!/usr/bin/env node
/** サーバー・ブラウザ起動・記録のみ。特徴量作成、学習、予測はブラウザで行う。 */
import http from 'node:http';
import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function main(){
 const [dir='solver/local-runs/pro-mean125/value-v1',idsText='depth3,depth4,monotone3']=process.argv.slice(2),datasetBytes=await readFile(path.join(dir,'dataset.json'));
 const dataset=JSON.parse(datasetBytes),specs={depth3:{depth:3,iterations:160},depth4:{depth:4,iterations:160},monotone3:{depth:3,iterations:160,monotone:true},depth2:{depth:2,iterations:240},depth5:{depth:5,iterations:240,minRows:60,minWeight:2,l2:3,learningRate:.05},depth6:{depth:6,iterations:240,minRows:60,minWeight:2,l2:3,learningRate:.05},monotone5:{depth:5,iterations:240,minRows:60,minWeight:2,l2:3,learningRate:.05,monotone:true}},ids=idsText.split(',');
 if(ids.some(id=>!specs[id]))throw Error('学習条件の指定が不正');
 if(dataset.counts.trainSeeds<250||dataset.counts.validationSeeds<250)throw Error('各群250シード以上が必要');
 const trainSeeds=new Set(dataset.train.map(r=>r.seed)),validationSeeds=new Set(dataset.validation.map(r=>r.seed));
 if([...trainSeeds].some(s=>validationSeeds.has(s)))throw Error('学習・検証シードが重複');
 const modelSources=await Promise.all(['solver/pro-value-dataset.mjs','solver/pro-value-scene-dataset.mjs','solver/pro-value-train.mjs','solver/browser/pro-value-model.js','solver/browser/pro-strategy-research.js','solver/browser/pro-learned-research.js'].map(file=>readFile(file)));
 const provenance={datasetSha256:sha(datasetBytes),implementationSha256:sha(Buffer.concat(modelSources)),versions:dataset.versions,counts:dataset.counts,sources:dataset.sources};
 const root=path.resolve('game'),port=18680,server=http.createServer(async(req,res)=>{try{
  const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
  if(pathname==='/value-dataset.json'){res.writeHead(200,{'Content-Type':'application/json'});res.end(datasetBytes);return;}
  const file=['/research/pro-value-model.js','/research/pro-strategy-research.js','/research/pro-risk-research.js','/research/pro-learned-research.js','/research/pro-public-action-kernel.js'].includes(pathname)?path.resolve('solver/browser',path.basename(pathname)):path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)&&!file.startsWith(path.resolve('solver/browser')+path.sep))throw Error('path');
  const bytes=await readFile(file);res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html':'text/plain','Cache-Control':'no-store'});res.end(bytes);
 }catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage();page.on('console',msg=>{if(msg.text().startsWith('VALUE '))console.log(msg.text());});page.on('pageerror',err=>console.error(err.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===`http://127.0.0.1:${port}`?route.continue():route.abort());await page.goto(`http://127.0.0.1:${port}/`);await page.waitForFunction(()=>window.game?.cardManager?.allCards.length>0);
  await page.evaluate(async()=>{
   const data=await(await fetch('/value-dataset.json')).json(),vm=await import('/research/pro-value-model.js'),formula=await import('/js/proAcquisitionAdvisor.js');
   const forecast=vm.createValueForecaster(formula.projectProDeck);
   const context={forecast,score:formula.proGoal};let done=0;
   const encode=rows=>rows.map(r=>{if(++done%10000===0)console.log('VALUE features '+done);return {x:vm.encodeValueFeatures(vm.unpackValueObservation(r.observation,data),r.observation.phase,context),y:r.target,weight:r.weight,phase:r.observation.phase,turn:r.observation.turn,seed:r.seed};});
   window.valueResearch={train:encode(data.train),validation:encode(data.validation),vm};console.log('VALUE features complete '+done);
  });
  const summary={createdAt:new Date().toISOString(),purpose:'リセマラなしPRO。過去の結果だけを教師として使用。予測精度は実プレイ改善の証明ではない。',provenance,models:{}};
  for(const id of ids){console.log(`start training ${id}`);const start=Date.now();
   const trained=await page.evaluate(async({id,spec})=>{const {train,validation,vm}=window.valueResearch;
    const model=await vm.trainValueModel(train,{...spec,onProgress:p=>console.log('VALUE '+id+' '+JSON.stringify(p))});
    const byTurn={};for(let turn=0;turn<8;turn++){const rows=validation.filter(r=>r.turn===turn);byTurn[turn]={seeds:new Set(rows.map(r=>r.seed)).size,...vm.valueMetrics(model,rows)};}
    const byPhase={};for(const phase of ['acquisition','after-action','before-training']){const rows=validation.filter(r=>r.phase===phase);byPhase[phase]={seeds:new Set(rows.map(r=>r.seed)).size,...vm.valueMetrics(model,rows)};}
    return {model,metrics:{train:vm.valueMetrics(model,train),validation:vm.valueMetrics(model,validation),byPhase,byTurn}};
   },{id,spec:specs[id]});
   const file=path.join(dir,id+'-model.json');await writeFile(file,JSON.stringify({...trained,provenance,id})+'\n');summary.models[id]={file:path.resolve(file),sha256:sha(await readFile(file)),settings:trained.model.settings,metrics:trained.metrics,seconds:(Date.now()-start)/1000};await writeFile(path.join(dir,'training-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(`done ${id}: ${JSON.stringify(summary.models[id])}`);
  }
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
