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
 const dataset=JSON.parse(datasetBytes),specs={shortfall2:{depth:2,iterations:240,learningRate:.05,minRows:80,minWeight:3,l2:3},shortfall3:{depth:3,iterations:180,learningRate:.05,minRows:80,minWeight:3,l2:3},scalar3x4:{depth:3,iterations:640},component3:{depth:3,iterations:160,componentwise:true},depth3:{depth:3,iterations:160},depth4:{depth:4,iterations:160},monotone3:{depth:3,iterations:160,monotone:true},depth2:{depth:2,iterations:240},depth5:{depth:5,iterations:240,minRows:60,minWeight:2,l2:3,learningRate:.05},depth6:{depth:6,iterations:240,minRows:60,minWeight:2,l2:3,learningRate:.05},monotone5:{depth:5,iterations:240,minRows:60,minWeight:2,l2:3,learningRate:.05,monotone:true}},ids=idsText.split(',');
 specs.failure2={...specs.shortfall2};specs.failure3={...specs.shortfall3};
 if(ids.some(id=>!specs[id]))throw Error('学習条件の指定が不正');
 const shortfall=dataset.targetKind==='pro-shortfall9',failure=dataset.targetKind==='pro-failure8';
 if(dataset.targetKind&&!['official-score','pro-shortfall9','pro-failure8'].includes(dataset.targetKind)||ids.some(id=>id.startsWith('shortfall')!==shortfall||id.startsWith('failure')!==failure))throw Error('学習対象とモデルの種類が異なる');
 if(dataset.counts.trainSeeds<250||dataset.counts.validationSeeds<250)throw Error('各群250シード以上が必要');
 const trainSeeds=new Set(dataset.train.map(r=>r.seed)),validationSeeds=new Set(dataset.validation.map(r=>r.seed));
 if([...trainSeeds].some(s=>validationSeeds.has(s)))throw Error('学習・検証シードが重複');
 const modelSources=await Promise.all(['solver/pro-value-train.mjs','solver/pro-value-dataset.mjs','solver/pro-value-scene-dataset.mjs','solver/browser/pro-value-model.js','solver/browser/pro-risk-targets.js','solver/browser/pro-strategy-research.js','solver/browser/pro-learned-research.js'].map(file=>readFile(file)));
 const referenceModels=[];for(const reference of dataset.referenceModels||[]){const bytes=await readFile(reference.file),data=JSON.parse(bytes);if(sha(bytes)!==reference.sha256||JSON.stringify(data.provenance.versions)!==JSON.stringify(dataset.versions))throw Error('比較用モデルのSHAまたはゲーム版が異なる');referenceModels.push({...reference,model:data.model});}
 const provenance={datasetSha256:sha(datasetBytes),implementationSha256:sha(Buffer.concat(modelSources)),versions:dataset.versions,counts:dataset.counts,sources:dataset.sources,targetKind:dataset.targetKind||'official-score'};
 const root=path.resolve('game'),port=18680,server=http.createServer(async(req,res)=>{try{
  const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
  if(pathname==='/value-dataset.json'){res.writeHead(200,{'Content-Type':'application/json'});res.end(datasetBytes);return;}
  const file=['/research/pro-risk-targets.js','/research/pro-value-model.js','/research/pro-strategy-research.js','/research/pro-risk-research.js','/research/pro-learned-research.js','/research/pro-public-action-kernel.js'].includes(pathname)?path.resolve('solver/browser',path.basename(pathname)):path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)&&!file.startsWith(path.resolve('solver/browser')+path.sep))throw Error('path');
  const bytes=await readFile(file);res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html':'text/plain','Cache-Control':'no-store'});res.end(bytes);
 }catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage();page.on('console',msg=>{if(msg.text().startsWith('VALUE '))console.log(msg.text());});page.on('pageerror',err=>console.error(err.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===`http://127.0.0.1:${port}`?route.continue():route.abort());await page.goto(`http://127.0.0.1:${port}/`);await page.waitForFunction(()=>window.game?.cardManager?.allCards.length>0);
  await page.evaluate(async()=>{
   const data=await(await fetch('/value-dataset.json')).json(),vm=await import('/research/pro-value-model.js'),formula=await import('/js/proAcquisitionAdvisor.js'),targets=await import('/research/pro-risk-targets.js');
   const forecast=vm.createValueForecaster(formula.projectProDeck);
   const context={forecast,score:formula.proGoal};let done=0;
   const encode=rows=>rows.map(r=>{if(++done%10000===0)console.log('VALUE features '+done);return {x:vm.encodeValueFeatures(vm.unpackValueObservation(r.observation,data),r.observation.phase,context),y:['pro-shortfall9','pro-failure8'].includes(data.targetKind)?targets.encodeRiskTarget(r.target,data.targetKind):r.target,targetComponents:r.targetComponents,weight:r.weight,phase:r.observation.phase,turn:r.observation.turn,seed:r.seed};});
   window.valueResearch={train:encode(data.train),validation:encode(data.validation),vm};
   window.valueResearch.metrics=model=>{const {train,validation}=window.valueResearch;
    const measure=(rows,predictor=model)=>{
     if(!['pro-shortfall9','pro-failure8'].includes(data.targetKind))return vm.valueMetrics(predictor,rows);
     const weight=rows.reduce((sum,row)=>sum+row.weight,0);let se=0,ae=0,bias=0;
     for(const row of rows){const error=targets.clipRiskPrediction(vm.predictValue(predictor,row.x),data.targetKind)-row.y;se+=row.weight*error**2;ae+=row.weight*Math.abs(error);bias+=row.weight*error;}
     return {rows:rows.length,weight,rmse:Math.sqrt(se/weight),mae:ae/weight,bias:bias/weight,...(data.targetKind==='pro-failure8'?{brier:se/weight}:{}),prediction:data.targetKind==='pro-failure8'?'min(1, max(0, fixed-tree prediction))':'max(0, fixed-tree prediction)'};
    };
    const byTurn={};for(let turn=0;turn<8;turn++){const rows=validation.filter(r=>r.turn===turn);byTurn[turn]={seeds:new Set(rows.map(r=>r.seed)).size,...measure(rows)};}
    const byPhase={};for(const phase of ['acquisition','after-action','before-training']){const rows=validation.filter(r=>r.phase===phase);byPhase[phase]={seeds:new Set(rows.map(r=>r.seed)).size,...measure(rows)};}
    const leaves=validation.filter(row=>row.phase==='after-action'&&row.turn>=1&&row.turn<=6);
    return {train:measure(train),validation:measure(validation),byPhase,byTurn,...(['pro-shortfall9','pro-failure8'].includes(data.targetKind)?{planningLeaves:{seeds:new Set(leaves.map(row=>row.seed)).size,...measure(leaves)},planningLeavesBaselines:{zero:measure(leaves,{...model,base:0,trees:[]}),trainingMean:measure(leaves,{...model,trees:[]})}}:{})};
   };console.log('VALUE features complete '+done);
  });
  const summary={createdAt:new Date().toISOString(),purpose:'リセマラなしPRO。過去の結果だけを教師として使用。予測精度は実プレイ改善の証明ではない。',provenance,models:{},references:{}};
  for(const reference of referenceModels){const metrics=await page.evaluate(model=>window.valueResearch.metrics(model),reference.model);summary.references[reference.id]={file:reference.file,sha256:reference.sha256,metrics,interpretation:'同じ検証250開始の同じ公開状態に対する固定モデルの誤差。実ゲーム改善の証明ではない。'};}
  for(const id of ids){console.log(`start training ${id}`);const start=Date.now();
   const trained=await page.evaluate(async({id,spec})=>{const {train,validation,vm}=window.valueResearch;
    let model,components=null,componentAudit=null;
    if(spec.componentwise){
     const keys=['mobilizationPoints','enrollmentDiffPoints','satisfactionPoints','withdrawalPoints'];
     for(const row of [...train,...validation])if(!row.targetComponents||keys.some(key=>!Number.isFinite(row.targetComponents[key]))||Math.abs(keys.reduce((sum,key)=>sum+row.targetComponents[key],0)-row.y)>1e-9)throw Error('公式内訳と実得点が一致する教師データが必要');
     components={};const {componentwise,...settings}=spec;
     for(const key of keys){const rows=train.map(row=>({...row,y:row.targetComponents[key]}));
      const part=await vm.trainValueModel(rows,{...settings,onProgress:p=>console.log('VALUE '+id+' '+key+' '+JSON.stringify(p))});
      components[key]={model:part,validation:vm.valueMetrics(part,validation.map(row=>({...row,y:row.targetComponents[key]})))};
     }
     const parts=keys.map(key=>components[key].model),first=parts[0];
     model={...first,base:parts.reduce((sum,part)=>sum+part.base,0),trees:parts.flatMap(part=>part.trees),settings:{...first.settings,iterations:parts.reduce((sum,part)=>sum+part.trees.length,0),targetKind:'sum-of-official-components',componentIterations:first.settings.iterations,components:keys}};
     const errors=validation.map(row=>Math.abs(vm.predictValue(model,row.x)-parts.reduce((sum,part)=>sum+vm.predictValue(part,row.x),0)));
     componentAudit={validationRows:validation.length,validationSeeds:new Set(validation.map(row=>row.seed)).size,maxSumDifference:Math.max(...errors),labelsMatchOfficialScore:true,combinationComputedInBrowser:true,prediction:'unclipped component sum; same fixed scalar model evaluator'};
     if(componentAudit.maxSumDifference>1e-9)throw Error('成分別予測と固定木の合成結果が異なる');
    }else model=await vm.trainValueModel(train,{...spec,onProgress:p=>console.log('VALUE '+id+' '+JSON.stringify(p))});
    return {model,metrics:window.valueResearch.metrics(model),...(components?{components,componentAudit}:{})};
   },{id,spec:specs[id]});
   const file=path.join(dir,id+'-model.json');await writeFile(file,JSON.stringify({...trained,provenance,id})+'\n');summary.models[id]={file:path.resolve(file),sha256:sha(await readFile(file)),settings:trained.model.settings,metrics:trained.metrics,...(trained.componentAudit?{componentAudit:trained.componentAudit,componentMetrics:Object.fromEntries(Object.entries(trained.components).map(([key,value])=>[key,value.validation]))}:{}),seconds:(Date.now()-start)/1000};await writeFile(path.join(dir,'training-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(`done ${id}: ${JSON.stringify(summary.models[id])}`);
  }
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
