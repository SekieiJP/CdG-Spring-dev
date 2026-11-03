#!/usr/bin/env node
/** 記録の公開局面を配布し、結果を集計する。全探索・解決・得点はブラウザ内。 */
import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {readRunBytes,compactRecord,summarizeOutcomes} from './pro-strategy-metrics.mjs';
import {meanInterval} from './pro-mean125-metrics.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),mean=a=>a.reduce((s,n)=>s+n,0)/a.length;
export function packTerminalFrame(event,catalog){
 const o=event.observation;
 if(o.difficulty!=='pro'||o.mode!=='normal'||o.turn!==7||o.totalTurns!==8)throw Error('PRO通常ゲームの最終公開局面が必要');
 const observation={difficulty:o.difficulty,mode:o.mode,turn:o.turn,totalTurns:o.totalTurns,stats:Object.fromEntries(['experience','enrollment','satisfaction','accounting'].map(k=>[k,o.stats[k]])),tokens:Object.fromEntries(['passion','fatigue','inspiration','organize'].map(k=>[k,o.tokens[k]||0]))};
 const hand=event.hand.map(c=>{const d=catalog.get(String(c.cardNo));if(!d)throw Error('未知の手札');return {cardNo:d.cardNo,cardName:d.cardName,rarity:d.rarity,category:d.category,effect:d.effect};});
 return {observation,hand};
}
async function main(){
 const [sourceFile='solver/research-scenarios/pro-terminal-audit-sources.json',outDir='solver/local-evaluation/pro-mean125/terminal-exact-audit']=process.argv.slice(2),spec=JSON.parse(await readFile(sourceFile));
 const gameRoot=path.resolve('game'),browserRoot=path.resolve('solver/browser'),port=18891;
 const gameSources=await Promise.all((await readdir('game/js')).filter(n=>n.endsWith('.js')).sort().map(async n=>n+await readFile('game/js/'+n,'utf8')));
 const versions=[sha(gameSources.join('\n')),'sha256:'+sha(await readFile('game/data/cards_pro.csv')),'sha256:'+sha(await readFile('game/data/rankPro.csv'))];
 const inputs=[],observations=[],groups=[];
 for(const source of spec.runs){let records=[],audit=[];for(const file of source.files){const bytes=await readRunBytes(file),d=JSON.parse(bytes);if(d.simulations.length!==1)throw Error('1ファイル1方略');records.push(...d.simulations[0].playRecords);audit.push({file,sha256:sha(bytes)});}
  const metrics=summarizeOutcomes(records.map(compactRecord));
  for(const r of records){const m=r.metadata;if(m.reroll||m.research?.initial||m.source!=='autoplay'||JSON.stringify([m.provenance.codeHash,m.cardVersion,m.rankVersion])!==JSON.stringify(versions))throw Error('同じ本体の一発勝負の記録が必要');
   const events=r.events.filter(e=>e.type==='research-placement-decision'&&e.turn===7);if(events.length!==1)throw Error('最終の公開配置局面が1つ必要');const e=events[0],catalog=new Map(m.catalog.map(c=>[String(c.cardNo),c]));
   const index=inputs.length;inputs.push(packTerminalFrame(e,catalog));observations.push({index,id:source.id,seed:m.seed,sequence:e.placements,actualScore:r.result.score.displayScore,actualWithdrawal:r.result.score.withdrawal,actualStats:Object.fromEntries(['experience','enrollment','satisfaction','accounting'].map(k=>[k,r.result.score[k]]))});
  }
  groups.push({id:source.id,n:records.length,actualMean:metrics.mean,audit});
 }
 const payload=JSON.stringify(inputs),server=http.createServer(async(req,res)=>{try{
  const name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
  if(name==='/'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>PRO terminal audit</title>');return;}
  if(name==='/terminal-public-input.json'){res.writeHead(200,{'Content-Type':'application/json'});res.end(payload);return;}
  const file=name.startsWith('/research/')?path.resolve(browserRoot,name.slice(10)):path.resolve(gameRoot,'.'+name);
  if(name.startsWith('/research/')?!file.startsWith(browserRoot+path.sep):!file.startsWith(gameRoot+path.sep))throw Error('path');
  const bytes=await readFile(file);res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':'text/plain','Cache-Control':'no-store'});res.end(bytes);
 }catch{res.writeHead(404);res.end();}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});let browser;
 try{browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.route('**/*',r=>new URL(r.request().url()).origin===`http://127.0.0.1:${port}`?r.continue():r.abort());await page.goto(`http://127.0.0.1:${port}/`);
  await page.evaluate(async()=>{const [{CardManager},{ScoreManager},{getDifficultyConfig},{getPlacementError},{createPublicActionKernel},{createTerminalExact}]=await Promise.all([import('/js/cardManager.js'),import('/js/scoreManager.js'),import('/js/difficultyConfig.js'),import('/js/placementRules.js'),import('/research/pro-public-action-kernel.js'),import('/research/pro-terminal-exact.js')]);
   const cm=new CardManager(null),sm=new ScoreManager(null);cm.parseCSV(await(await fetch('/data/cards_pro.csv')).text());await sm.loadRankData('/data/rankPro.csv');const rules=getDifficultyConfig('pro');
   const optimizer=createTerminalExact({rules,placementError:(s,c,slot)=>getPlacementError(cm,s,c,slot),resolve:createPublicActionKernel(rules.turns,cm),score:s=>sm.calculateScore(s)});
   window.terminalAudit={optimizer,inputs:await(await fetch('/terminal-public-input.json')).json()};
  });
  const outputs=[];
  for(let i=0;i<inputs.length;i++){
   const optimized=await page.evaluate(i=>{const {optimizer,inputs}=window.terminalAudit,f=inputs[i];return optimizer.optimize(f.observation,f.hand);},i);
   // 観測された操作は探索が終わってから渡し、探索に正解ラベルを与えない。
   const replayed=await page.evaluate(({i,sequence})=>{const {optimizer,inputs}=window.terminalAudit,f=inputs[i];return optimizer.replay(f.observation,f.hand,sequence);},{i,sequence:observations[i].sequence});
   const actual=observations[i];if(replayed.score.displayScore!==actual.actualScore||replayed.score.withdrawal!==actual.actualWithdrawal||JSON.stringify(replayed.stats)!==JSON.stringify(actual.actualStats))throw Error('実際の最終解決と公開局面からの再現が異なる');
   if(optimized.score.displayScore<actual.actualScore&&optimized.complete)throw Error('全探索の最大値が実際の配置より低い');
   outputs.push({...actual,optimized});if((i+1)%25===0)console.log(`TERMINAL_AUDIT_PROGRESS ${i+1}/${inputs.length}`);
  }
  const summary={purpose:'same public terminal hands and histories; diagnostic not a new full-game policy trial',versions,sourceSha256:sha(await readFile(sourceFile)),implementationSha256:sha(Buffer.concat(await Promise.all(['solver/pro-terminal-audit.mjs','solver/browser/pro-terminal-exact.js','solver/browser/pro-public-action-kernel.js','solver/pro-strategy-metrics.mjs','solver/pro-mean125-metrics.mjs'].map(f=>readFile(f))))),publicInputSha256:sha(payload),browserCalculation:true,actualNewFullGames:0,groups:{}};
  for(const g of groups){const rows=outputs.filter(r=>r.id===g.id),complete=rows.every(r=>r.optimized.complete);summary.groups[g.id]={...g,allExact:complete,allReplayMatches:true,states:rows.map(r=>r.optimized.visited),incompleteCount:rows.filter(r=>!r.optimized.complete).length,
   ...(complete?{sameHistoryOptimumMean:mean(rows.map(r=>r.optimized.score.displayScore)),meanGap:mean(rows.map(r=>r.optimized.score.displayScore-r.actualScore)),meanGap95:meanInterval(rows.map(r=>r.optimized.score.displayScore-r.actualScore)),improvedGames:rows.filter(r=>r.optimized.score.displayScore>r.actualScore).length,
    actualWithdrawalGames:rows.filter(r=>r.actualWithdrawal>0).length,minimumWithdrawalGamesAtMaxScore:rows.filter(r=>r.optimized.score.withdrawal>0).length,withdrawalAvoidableAtMaxScore:rows.filter(r=>r.actualWithdrawal>0&&r.optimized.score.withdrawal===0).length,
    actualBelow8:rows.filter(r=>r.actualScore<8).length,minimumBelow8SameHistory:rows.filter(r=>r.optimized.score.displayScore<8).length}:{}),interpretation:complete?'250以上の同じ公開最終手札での配置の取りこぼしを診断。以前の取得・配置・削除は固定。新方略の独立完走検証ではない。':'上限到達があるので全体の最大値と改善傾向を集計しない。'};}
  await mkdir(outDir,{recursive:true});await writeFile(path.join(outDir,'summary.json'),JSON.stringify(summary,null,2)+'\n');await writeFile(path.join(outDir,'frames.json'),JSON.stringify(outputs)+'\n');
  console.log(JSON.stringify({groups:Object.fromEntries(Object.entries(summary.groups).map(([id,{states,audit,...g}])=>[id,{...g,maxVisited:Math.max(...states)}]))},null,2));
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e);process.exitCode=1;});
