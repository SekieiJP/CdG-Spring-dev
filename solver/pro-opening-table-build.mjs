#!/usr/bin/env node
/** 起動・公開モデルの配布・保存のみ。ペア評価と仮想操作はブラウザ内。 */
import http from 'node:http';
import path from 'node:path';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function main(){
 const args=process.argv.slice(2),dir=args[0]||'solver/local-runs/pro-mean125/opening-table-v1';
 const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
 const worlds=Number(option('--worlds','250')),maxJobs=Number(option('--max-jobs','198')),port=Number(option('--port','18890'));
 if(!Number.isInteger(worlds)||worlds<1||worlds>256||!Number.isInteger(maxJobs)||maxJobs<1||maxJobs>198||!Number.isInteger(port)||port<1024||port>65534)throw Error('worlds 1〜256、max-jobs 1〜198、安全なportが必要');
 const configs=JSON.parse(await readFile('solver/research-scenarios/pro-mean125-combo2-configs.json','utf8')),config={...configs.both2,planning:{...configs.both2.planning,worlds,contextSalt:false,salt:'pro-opening-table-v1'}};
 const modelBytes=await readFile(config.valueModelPath),model=JSON.parse(modelBytes).model;
 if(!model)throw Error('固定モデルが必要');
 const files=['solver/autoplay-agent.mjs','solver/browser/pro-strategy-research.js','solver/browser/pro-risk-research.js','solver/browser/pro-value-model.js','solver/browser/pro-learned-research.js','solver/browser/pro-public-action-kernel.js','solver/pro-card-scene-input.mjs','solver/browser/pro-intrinsic-recovery.js','solver/browser/pro-action-candidates.js','solver/browser/pro-opening-table.js','solver/pro-opening-table-build.mjs'];
 const js=await Promise.all((await readdir('game/js')).filter(n=>n.endsWith('.js')).sort().map(async n=>n+await readFile('game/js/'+n,'utf8')));
 const fingerprints={implementation:sha(Buffer.concat(await Promise.all(files.map(f=>readFile(f))))),codeHash:sha(js.join('\n')),cardVersion:'sha256:'+sha(await readFile('game/data/cards_pro.csv')),rankVersion:'sha256:'+sha(await readFile('game/data/rankPro.csv')),modelSha256:sha(modelBytes)};
 const provenance={fingerprints,config,worlds,method:'two public hypothetical turns then fixed learned value; utility is not an actual final score',actualGames:0};
 const root=path.resolve('game'),researchRoot=path.resolve('solver/browser'),input=JSON.stringify({model,config}),server=http.createServer(async(req,res)=>{try{
  const name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
  if(name==='/opening-input.json'){res.writeHead(200,{'Content-Type':'application/json'});res.end(input);return;}
  const file=name.startsWith('/research/')?path.resolve(researchRoot,name.slice('/research/'.length)):path.resolve(root,'.'+(name==='/'?'/index.html':name));
  if(name.startsWith('/research/')?!file.startsWith(researchRoot+path.sep):!file.startsWith(root+path.sep))throw Error('path');
  const bytes=await readFile(file);res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html':file.endsWith('.csv')?'text/csv':'text/plain','Cache-Control':'no-store'});res.end(bytes);
 }catch{res.writeHead(404);res.end();}});
 await mkdir(dir,{recursive:true});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 let browser;
 try{browser=await chromium.launch({headless:true});const page=await browser.newPage();
  await page.route('**/*',route=>new URL(route.request().url()).origin===`http://127.0.0.1:${port}`?route.continue():route.abort());
  await page.goto(`http://127.0.0.1:${port}/`);
  const header=await page.evaluate(async()=>{
   const [{CardManager},{ScoreManager},{getDifficultyConfig},formula,research,opening]=await Promise.all([import('/js/cardManager.js'),import('/js/scoreManager.js'),import('/js/difficultyConfig.js'),import('/js/proAcquisitionAdvisor.js'),import('/research/pro-strategy-research.js'),import('/research/pro-opening-table.js')]);
   const cm=new CardManager(null);cm.parseCSV(await(await fetch('/data/cards_pro.csv')).text());
   const sm=new ScoreManager(null);await sm.loadRankData('/data/rankPro.csv');
   const rules=getDifficultyConfig('pro'),input=await(await fetch('/opening-input.json')).json();
   const clean=c=>({cardNo:Number(c.cardNo),cardName:c.cardName,category:c.category,rarity:c.rarity,effect:c.effect});
   const catalog=cm.allCards.map(clean),basic=cm.getBasicCards().map(clean),r=catalog.filter(c=>c.rarity==='R').sort((a,b)=>a.cardNo-b.cardNo);
   const clone=s=>({difficulty:'pro',turn:s.turn,totalTurns:8,player:Object.fromEntries(['experience','enrollment','satisfaction','accounting'].map(k=>[k,s.player[k]])),tokens:{...s.tokens},updateStatus(k,d){const old=this.player[k];this.player[k]=Math.max(0,old+d);if(k==='enrollment')this.player[k]=Math.min(this.player[k],this.player.experience);return this.player[k]-old;}});
   const enumerate=(hand,counts)=>hand.flatMap((c,cardIndex)=>{const p=cm.parseEffect(c.effect),slots=p.staffRestrictions.length?p.staffRestrictions:['leader','teacher','staff'];return slots.filter(slot=>c.effect.includes('並行')||counts[slot]===0).map(slot=>({cardIndex,card:c,slot}));});
   const policy=research.createResearchPolicy({projectDeck:formula.projectProDeck,score:formula.proGoal,cloneState:clone,resolve:null,enumerateOptions:enumerate,catalog,turns:rules.turns,publicActionParser:cm,config:input.config,valueModel:input.model,refreshAdvice:o=>formula.recommendAcquisition(o,{profile:'pro_splus'})});
   const observation={difficulty:'pro',mode:'normal',turn:0,totalTurns:rules.turns.length,stats:{...rules.initialStatus},tokens:{passion:0,fatigue:0,inspiration:0,organize:0},owned:basic,candidates:r,pickCount:2,allowSkip:false,rankTable:sm.rankTable,turns:rules.turns,offerHistory:[],refreshRemaining:2};
   for(const name of ['seed','rng','deckOrder','result','finalScore'])Object.defineProperty(observation,name,{get(){throw Error('private '+name);}});
   window.openingBuild={observation,policy,clone,catalog,opening,jobs:opening.openingPairJobs(r.map(c=>c.cardNo))};
   return {schema:opening.OPENING_TABLE_SCHEMA,estimated:true,initial:{totalTurns:rules.turns.length,stats:rules.initialStatus,basicNos:basic.map(c=>c.cardNo).sort((a,b)=>a-b)},cardNos:r.map(c=>c.cardNo),jobs:window.openingBuild.jobs};
  });
  const {jobs,...tableHeader}=header,file=path.join(dir,'table.json');let saved;
  if(args.includes('--resume')){saved=JSON.parse(await readFile(file,'utf8'));if(JSON.stringify(saved.provenance)!==JSON.stringify(provenance)||JSON.stringify(saved.cardNos)!==JSON.stringify(header.cardNos)||JSON.stringify(saved.initial)!==JSON.stringify(header.initial))throw Error('初回表の再開条件が異なる');}
  else {try{await readFile(file);throw Error('既存の表を上書きしない。--resumeを指定');}catch(e){if(e.code!=='ENOENT')throw e;}saved={...tableHeader,provenance,rows:[],complete:false};}
  const rowKey=r=>r.remaining+':'+r.pair.join(','),keys=new Set();
  for(const row of saved.rows){if(!jobs.some(j=>rowKey(j)===rowKey(row))||keys.has(rowKey(row))||!Number.isFinite(row.score)||!Number.isFinite(row.predictedFinalScore)||row.estimated!==true)throw Error('再開行が不正');keys.add(rowKey(row));}
  let count=0;
  for(const job of jobs){if(keys.has(rowKey(job)))continue;if(count>=maxJobs)break;
   const row=await page.evaluate(job=>{const {observation:root,policy,clone}=window.openingBuild;const o={...root,refreshRemaining:job.remaining},owned=[...root.owned,...job.pair.map(n=>root.candidates.find(c=>c.cardNo===n))];
    const result=policy.riskPolicy.evaluate(o,owned,clone({turn:0,player:root.stats,tokens:root.tokens}),'training');if(!result.estimated)throw Error('初回表は固定評価による推定値');return {...job,score:result.score,predictedFinalScore:result.mean,forecast:result.forecast,estimated:true};
   },job);
   saved.rows.push(row);keys.add(rowKey(job));count++;saved.complete=saved.rows.length===jobs.length;
   await writeFile(file,JSON.stringify(saved,null,2)+'\n');console.log(`OPENING_TABLE_PROGRESS ${saved.rows.length}/${jobs.length} pair=${job.pair.join(',')} remaining=${job.remaining}`);
  }
  if(saved.complete)await page.evaluate(table=>window.openingBuild.opening.validateOpeningTable(table,window.openingBuild.catalog),saved);
  console.log(JSON.stringify({file:path.resolve(file),rows:saved.rows.length,complete:saved.complete,actualGames:0,worlds,sha256:sha(await readFile(file)),fingerprints}));
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
