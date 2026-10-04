#!/usr/bin/env node
/** 過去の公開局面だけを配布し、新旧計算をブラウザで比較する。実ゲーム操作なし。 */
import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {readRunBytes,compactRecord,summarizeOutcomes} from './pro-strategy-metrics.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const ACTOR_FILES=['solver/autoplay-agent.mjs','solver/browser/pro-strategy-research.js','solver/browser/pro-risk-research.js','solver/browser/pro-value-model.js','solver/browser/pro-learned-research.js','solver/browser/pro-public-action-kernel.js','solver/pro-card-scene-input.mjs','solver/browser/pro-intrinsic-recovery.js','solver/browser/pro-action-candidates.js','solver/browser/pro-opening-table.js','solver/pro-opening-table-input.mjs'];
export function packRefreshFrame(event,catalog){
 const o=event.observation,keys=['experience','enrollment','satisfaction','accounting'],tokens=['passion','fatigue','inspiration','organize'];
 if(o.difficulty!=='pro'||o.mode!=='normal'||o.turn!==0||o.totalTurns!==8||o.pickCount!==2||o.allowSkip||o.candidates.length!==4||o.refreshRemaining!==2)throw Error('PRO初回リフレッシュ前の公開局面が必要');
 const card=c=>{const d=catalog.get(String(c.cardNo));if(!d)throw Error('未知のカード');return {cardNo:d.cardNo,cardName:d.cardName,rarity:d.rarity,category:d.category,effect:d.effect,acquiredTurn:c.acquiredTurn||0};};
 return {difficulty:o.difficulty,mode:o.mode,turn:o.turn,totalTurns:o.totalTurns,stats:Object.fromEntries(keys.map(k=>[k,o.stats[k]])),tokens:Object.fromEntries(tokens.map(k=>[k,o.tokens[k]||0])),owned:o.owned.map(card),candidates:o.candidates.map(card),pickCount:o.pickCount,allowSkip:false,
  turns:o.turns.map(t=>({recommended:t.recommended,recommendedStatus:t.recommendedStatus,training:t.training,deletion:t.deletion})),offerHistory:(o.offerHistory||[]).map(e=>({type:e.type,turn:e.turn,rarity:e.rarity,cards:e.cards.map(card)})),refreshRemaining:o.refreshRemaining};
}
async function main(){
 const [manifestFile='solver/local-runs/pro-mean125/action-coverage-development/manifest.json',groupId='both2',outDir='solver/local-evaluation/pro-mean125/refresh-efficiency-check']=process.argv.slice(2),manifest=JSON.parse(await readFile(manifestFile)),group=manifest.runs.find(r=>r.id===groupId);if(!group)throw Error('対象群がない');
 let records=[];const audit=[];for(const file of group.files){const bytes=await readRunBytes(file),d=JSON.parse(bytes);if(d.simulations.length!==1)throw Error('1ファイル1方略');records.push(...d.simulations[0].playRecords);audit.push({file:file.slice(file.indexOf('/solver/')+1),sha256:sha(bytes)});}
 const metrics=summarizeOutcomes(records.map(compactRecord));if(metrics.n!==250||records.some(r=>r.metadata.reroll||r.metadata.research?.initial))throw Error('全開始250の完走記録が必要');
 const gameSources=await Promise.all((await readdir('game/js')).filter(n=>n.endsWith('.js')).sort().map(async n=>n+await readFile('game/js/'+n,'utf8'))),versions=[sha(gameSources.join('\n')),'sha256:'+sha(await readFile('game/data/cards_pro.csv')),'sha256:'+sha(await readFile('game/data/rankPro.csv'))];
 if(records.some(r=>JSON.stringify([r.metadata.provenance.codeHash,r.metadata.cardVersion,r.metadata.rankVersion])!==JSON.stringify(versions)))throw Error('本体版が異なる');
 const catalog=new Map(records[0].metadata.catalog.map(c=>[String(c.cardNo),c])),inputs=records.map(r=>{const e=r.events.find(e=>e.type==='research-refresh-decision'&&e.turn===0);if(!e)throw Error('初回の公開局面がない');return packRefreshFrame(e,catalog);});
 const config=JSON.parse(group.description),modelBytes=await readFile(config.valueModelPath),model=JSON.parse(modelBytes);if(sha(modelBytes)!==config.valueModelSha256||JSON.stringify(model.provenance.versions.slice(0,3))!==JSON.stringify(versions)||model.provenance.versions[3]!=='autoplay')throw Error('モデル版が異なる');
 const referenceFile='solver/local-runs/pro-mean125/refresh-efficiency-check/pro-risk-reference.js',oldBytes=await readFile(referenceFile),newBytes=await readFile('solver/browser/pro-risk-research.js'),actorBuffers=await Promise.all(ACTOR_FILES.map(f=>readFile(f))),oldActorBuffers=[...actorBuffers];oldActorBuffers[2]=oldBytes;
 const oldStrategyVersion=sha(Buffer.concat(oldActorBuffers)),newStrategyVersion=sha(Buffer.concat(actorBuffers));if(oldStrategyVersion!=='e40efe6719bbd169d767ac0451221abf6f67212ff801394c049b1cfb692b29da')throw Error('元の比較版が異なる');
 const publicPayload=JSON.stringify({inputs,config:{...config,valueModelPath:undefined,valueModelSha256:undefined,id:undefined},model:model.model}),gameRoot=path.resolve('game'),researchRoot=path.resolve('solver/browser'),port=18940;
 const server=http.createServer(async(req,res)=>{try{
  const name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);if(name==='/'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>PRO calculation check</title>');return;}
  if(name==='/public-input.json'){res.writeHead(200,{'Content-Type':'application/json'});res.end(publicPayload);return;}
  if(name==='/reference/pro-risk-research.js'){res.writeHead(200,{'Content-Type':'application/javascript'});res.end(oldBytes);return;}
  const file=name.startsWith('/research/')?path.resolve(researchRoot,name.slice(10)):name==='/reference/pro-action-candidates.js'?path.resolve(researchRoot,'pro-action-candidates.js'):path.resolve(gameRoot,'.'+name);
  if(!file.startsWith(gameRoot+path.sep)&&!file.startsWith(researchRoot+path.sep))throw Error('path');const bytes=await readFile(file);res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':'text/plain','Cache-Control':'no-store'});res.end(bytes);
 }catch{res.writeHead(404);res.end();}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});let browser;
 try{browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.route('**/*',r=>new URL(r.request().url()).origin===`http://127.0.0.1:${port}`?r.continue():r.abort());await page.goto(`http://127.0.0.1:${port}/`);
  await page.evaluate(async()=>{
   const [{CardManager},{ScoreManager},{getDifficultyConfig},{getPlacementError},{createPublicActionKernel},{createResearchPolicy},before,after,formula,advisor]=await Promise.all([import('/js/cardManager.js'),import('/js/scoreManager.js'),import('/js/difficultyConfig.js'),import('/js/placementRules.js'),import('/research/pro-public-action-kernel.js'),import('/research/pro-strategy-research.js'),import('/reference/pro-risk-research.js'),import('/research/pro-risk-research.js'),import('/js/proAcquisitionAdvisor.js'),import('/js/acquisitionAdvisor.js')]);
   const payload=await(await fetch('/public-input.json')).json(),sm=new ScoreManager(null),cm=new CardManager(null);cm.parseCSV(await(await fetch('/data/cards_pro.csv')).text());await sm.loadRankData('/data/rankPro.csv');const rules=getDifficultyConfig('pro');
   const clone=s=>({difficulty:'pro',turn:s.turn,totalTurns:8,player:Object.fromEntries(['experience','enrollment','satisfaction','accounting'].map(k=>[k,s.player[k]])),tokens:{...s.tokens},updateStatus(k,d){const old=this.player[k];this.player[k]=Math.max(0,old+d);if(k==='enrollment')this.player[k]=Math.min(this.player[k],this.player.experience);return this.player[k]-old;}});
   const enumerate=(hand,counts)=>hand.flatMap((c,i)=>rules.slots.filter(slot=>!getPlacementError(cm,{difficulty:'pro',turn:0,totalTurns:8,player:{},slots:rules.slots,config:rules},c,slot.id,Object.fromEntries(rules.slots.map(s=>[s.id,Array(counts[s.id]||0).fill(c)])))).map(slot=>({cardIndex:i,card:c,slot:slot.id})));
   const actors=[before,after].map(module=>{const parser=new CardManager(null),resolve=createPublicActionKernel(rules.turns,parser),counters={formula:0,learned:0},refreshAdvice=o=>{counters.formula++;return advisor.recommendAcquisition(o,{profile:'pro_splus'});};
    const args={projectDeck:formula.projectProDeck,score:formula.proGoal,cloneState:clone,resolve,enumerateOptions:enumerate,catalog:cm.allCards,turns:rules.turns,publicActionParser:parser,config:payload.config,valueModel:payload.model,refreshAdvice};const base=createResearchPolicy(args),baseline={...base,futureRefresh:(...args)=>{counters.learned++;return base.futureRefresh(...args);}};
    return {risk:module.createRiskPolicy({...args,baseline}),counters};});
   window.refreshCheck={actors,inputs:payload.inputs.map(o=>({...o,rankTable:sm.rankTable}))};
  });
  const outputs=[];for(let i=0;i<inputs.length;i++){const row=await page.evaluate(i=>{const {actors,inputs}=window.refreshCheck,out=[];for(const k of i%2?[1,0]:[0,1]){const t=performance.now();const advice=actors[k].risk.acquisition(inputs[i]);out[k]={advice,ms:performance.now()-t};}if(JSON.stringify(out[0].advice)!==JSON.stringify(out[1].advice))throw Error('new/old advice mismatch');return {oldMs:out[0].ms,newMs:out[1].ms,advice:out[1].advice};},i);outputs.push(row);if((i+1)%25===0)console.log(`REFRESH_CHECK_PROGRESS ${i+1}/${inputs.length}`);}
  const counters=await page.evaluate(()=>window.refreshCheck.actors.map(a=>a.counters));if(!counters[0].formula||counters[1].formula!==0||counters[0].learned!==counters[1].learned)throw Error('unused computation audit failed');
  const sum=k=>outputs.reduce((s,r)=>s+r[k],0),summary={purpose:'same 250 public initial states, browser calculation equivalence; not a new scoring policy result',n:inputs.length,browserCalculation:true,actualNewFullGames:0,allOutputsEqual:true,sourceManifest:manifestFile,groupId,sourceAudit:audit,versions,oldStrategyVersion,newStrategyVersion,referenceCommit:'6593b20',oldRiskSha256:sha(oldBytes),newRiskSha256:sha(newBytes),modelSha256:sha(modelBytes),publicInputSha256:sha(publicPayload),adviceSha256:sha(JSON.stringify(outputs.map(r=>r.advice))),counters:{old:counters[0],new:counters[1]},timing:{oldTotalMs:sum('oldMs'),newTotalMs:sum('newMs'),ratio:sum('newMs')/sum('oldMs'),interpretation:'同時に他の研究計算が動く端末上の参考値。順序は交互で、独立した方略キャッシュを使う。スマートフォンの性能や得点の改善を示さない。'}};
  await mkdir(outDir,{recursive:true});await writeFile(path.join(outDir,'summary.json'),JSON.stringify(summary,null,2)+'\n');await writeFile(path.join(outDir,'frames.json'),JSON.stringify(outputs)+'\n');console.log(JSON.stringify(summary,null,2));
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e);process.exitCode=1;});
