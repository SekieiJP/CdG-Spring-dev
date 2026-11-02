#!/usr/bin/env node
/** 起動・版管理・保存だけ。教師の得点差、特徴、学習、誤差はブラウザ内。 */
import http from 'node:http';
import path from 'node:path';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex');
const SOURCES=['solver/pro-paired-value-dataset.mjs','solver/pro-paired-value-train.mjs','solver/browser/pro-paired-training.js','solver/browser/pro-paired-value.js','solver/browser/pro-value-model.js','game/js/proAcquisitionAdvisor.js'];
async function main(){
 const technical=process.argv.includes('--technical'),dir=process.argv[2]||'solver/local-runs/pro-mean125/paired-value-v1',bankFile='solver/local-runs/pro-mean125/paired-value-scenes-v1/choices.json';
 if(dir.startsWith('--'))throw Error('出力先の後に --technical を指定');
 const bytes=await readFile(technical?bankFile:path.join(dir,'dataset.json')),data=JSON.parse(bytes),sourceBuffers=await Promise.all(SOURCES.map(f=>readFile(f))),implementationSha256=sha(Buffer.concat(sourceBuffers));
 const gameSources=await Promise.all((await readdir('game/js')).filter(f=>f.endsWith('.js')).sort().map(async f=>f+await readFile(`game/js/${f}`,'utf8')));
 const physical=[sha(gameSources.join('\n')),'sha256:'+sha(await readFile('game/data/cards_pro.csv')),'sha256:'+sha(await readFile('game/data/rankPro.csv'))];
 if(!technical&&(JSON.stringify(data.versions)!==JSON.stringify(physical)||data.provenance.rerolls!==0||data.provenance.allRootsAccepted!==true||data.provenance.sourceSeedsDisjoint!==true||data.counts.continuations!==1500))throw Error('物理版・全継続の監査の不一致');
 const root=path.resolve('game'),browserRoot=path.resolve('solver/browser'),port=19055;
 const server=http.createServer(async(req,res)=>{try{
  const p=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
  if(p==='/paired-input.json'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(bytes);return;}
  const research=['/research/pro-paired-training.js','/research/pro-paired-value.js','/research/pro-value-model.js'].includes(p),file=research?path.resolve(browserRoot,path.basename(p)):path.resolve(root,'.'+(p==='/'?'/index.html':p));
  if(!file.startsWith((research?browserRoot:root)+path.sep))throw Error('path');
  res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html':'text/plain','Cache-Control':'no-store'});res.end(await readFile(file));
 }catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});let trained;
 try{
  const page=await browser.newPage();page.on('console',msg=>{if(msg.text().startsWith('PAIRED '))console.log(msg.text());});
  await page.route('**/*',r=>new URL(r.request().url()).origin===`http://127.0.0.1:${port}`?r.continue():r.abort());
  await page.goto(`http://127.0.0.1:${port}/`);await page.waitForFunction(()=>window.game?.cardManager?.allCards.length>0);
  trained=await page.evaluate(async technical=>{
   await window.game.setDifficulty('pro');
   const input=await(await fetch('/paired-input.json')).json(),training=await import('/research/pro-paired-training.js'),pair=await import('/research/pro-paired-value.js'),vm=await import('/research/pro-value-model.js'),formula=await import('/js/proAcquisitionAdvisor.js');
   let data=input;
   if(technical){
    // 公開状態を材料に作る合成ラベル。実ゲームの得点や改善の根拠ではない。
    const context={forecast:vm.createValueForecaster(formula.projectProDeck),score:formula.proGoal};
    const rows=input.scenes.map(s=>{const o={...s.observation,rankTable:window.game.scoreManager.rankTable},x=pair.encodePairedFeatures(o,s.referenceIndices,s.targetIndices,context),feature=n=>x[pair.PAIRED_FEATURES.indexOf('change-'+n)],synthetic=2*feature('count-8')+feature('count-45')+.2*feature('normal-count');
     return {sceneId:s.sceneId,observation:s.observation,referenceIndices:s.referenceIndices,targetIndices:s.targetIndices,referenceScore:0,targetScore:synthetic};
    });
    data={schema:'pro-paired-teachers-v1',train:rows.slice(0,500),validation:rows.slice(500),counts:{trainRoots:500,validationRoots:250},rankTable:window.game.scoreManager.rankTable};
   }
   const result=await training.fitPairedDataset(data,formula,p=>console.log('PAIRED '+JSON.stringify(p)));
   if(result.audit.trainTotalWeight!==500||result.audit.augmentedRows!==1000||result.audit.features!==204||result.metrics.validation.n!==250||result.metrics.validation.antisymmetryError>1e-12||Object.values(result.metrics.validation.gates).some(g=>g.changes+g.keptReference!==250))throw Error('全局面・学習重み・符号反転の検査失敗');
   if(technical){
    if(result.metrics.validation.learned.mae>=result.metrics.validation.zero.mae)throw Error('合成の既知差を学習できない');
    return {syntheticOnly:true,settings:training.PAIRED_SETTINGS,metrics:result.metrics,audit:result.audit,featuresAndTrainingInBrowser:true};
   }
   return {...result,settings:training.PAIRED_SETTINGS};
  },technical);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
 if(sha(Buffer.concat(await Promise.all(SOURCES.map(f=>readFile(f)))))!==implementationSha256)throw Error('学習中に実装変更');
 const provenance={inputSha256:sha(bytes),implementationSha256,sourceFiles:SOURCES,versions:physical,...(!technical?{counts:data.counts,sourceProvenance:data.provenance,bankSha256:data.bankSha256,continuationActor:data.continuationActor}:{syntheticOnly:true,publicBank:bankFile})};
 if(technical){
  const file='solver/research-results/pro-mean125-20261004/paired-value-training-technical.json';
  await writeFile(file,JSON.stringify({createdAt:new Date().toISOString(),purpose:'合成教師のみで学習・検証・全250局面ゲートの接続を確認。実ゲームの改善やカード評価の根拠ではない。',provenance,...trained},null,2)+'\n');
  console.log('Paired training browser pipeline passed; synthetic labels only.');
 }else{
  await mkdir(dir,{recursive:true});const modelFile=path.join(dir,'paired-model.json');
  await writeFile(modelFile,JSON.stringify({...trained,provenance})+'\n');
  await writeFile(path.join(dir,'training-summary.json'),JSON.stringify({createdAt:new Date().toISOString(),purpose:'固定2択の公式得点差予測。実プレイ全開始での平均12.5点・カード単体パワーは未検証。',provenance,modelFile,modelSha256:sha(await readFile(modelFile)),settings:trained.settings,audit:trained.audit,metrics:trained.metrics},null,2)+'\n');
  console.log(JSON.stringify({modelFile,validation:trained.metrics.validation}));
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
