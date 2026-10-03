#!/usr/bin/env node
/** 記録管理はNode、公開された解決状態の効果診断はブラウザ。本体の判断には接続しない。 */
import http from 'node:http';
import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {readRunBytes} from './pro-strategy-metrics.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function main(){
 const [manifestFile,groupId,outDir]=process.argv.slice(2);
 if(!manifestFile||!groupId||!outDir)throw Error('manifest group output-dir が必要');
 const manifest=JSON.parse(await readFile(manifestFile,'utf8')),group=manifest.runs.find(r=>r.id===groupId);
 if(!group)throw Error('群がない');
 let catalog=null,records=[],versions=null;const seeds=new Set(),audit=[];
 for(const file of group.files){const bytes=await readRunBytes(file),data=JSON.parse(bytes);
  audit.push({file,sha256:sha(bytes)});
  for(const record of data.simulations[0].playRecords){const meta=record.metadata;
   if(meta.difficulty!=='pro'||meta.reroll||meta.source!=='autoplay'||!record.result?.score)throw Error('リセマラなし完走の記録が必要');
   if(seeds.has(meta.seed))throw Error('開始シードの重複');seeds.add(meta.seed);
   const v=JSON.stringify([meta.provenance.codeHash,meta.cardVersion,meta.rankVersion,meta.provenance.strategyVersion]);
   if(versions&&versions!==v)throw Error('版の混在');versions=v;catalog ||= meta.catalog;
   records.push({resolves:record.events.filter(e=>e.type==='resolve').map(e=>({turn:e.turn,cardNo:e.cardNo,staff:e.staff,beforeStats:e.beforeStats,afterStats:e.afterStats,beforeTokens:e.beforeTokens,afterTokens:e.afterTokens,applied:e.applied,recommendedApplied:e.recommendedApplied})),
    score:record.result.score.displayScore});
  }
 }
 if(records.length<250)throw Error('最低250シード');
 const implementationSha256=sha(Buffer.concat(await Promise.all(['solver/pro-action-diagnostics.mjs','game/js/cardManager.js'].map(file=>readFile(file)))));
 const gameRoot=path.resolve('game'),port=18690,payload={catalog,records};
 const server=http.createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname),file=path.resolve(gameRoot,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(gameRoot+path.sep))throw Error('path');const bytes=await readFile(file);res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html':'text/plain'});res.end(bytes);
 }catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage();await page.route('**/*',route=>new URL(route.request().url()).origin===`http://127.0.0.1:${port}`?route.continue():route.abort());await page.goto(`http://127.0.0.1:${port}/`);
  const summary=await page.evaluate(async({catalog,records})=>{
   const {CardManager}=await import('/js/cardManager.js'),parser=new CardManager(null),byNo=new Map(catalog.map(c=>[String(c.cardNo),c])),byTurn=Array.from({length:8},(_,turn)=>({turn,games:records.length,requestedEnrollment:0,actualEnrollment:0,lostEnrollment:0,gamesWithLoss:0})),byCard=new Map();
   for(const record of records){const affected=new Set();
    for(const event of record.resolves){if(!event.applied)continue;
     const card=byNo.get(String(event.cardNo));if(!card)throw Error('カード定義がない');
     const effect=parser.parseEffect(card.effect),applicable=parser.getApplicableEffects(effect,event.staff,{...event.beforeStats},{turn:event.turn,totalTurns:8,player:event.beforeStats});
     const requested=applicable.filter(e=>e.type==='change'&&e.status==='enrollment').reduce((s,e)=>s+e.value,0)+(event.recommendedApplied&&card.category==='教務'?1:0),actual=event.afterStats.enrollment-event.beforeStats.enrollment,loss=requested-actual;
     if(requested<0||loss<0)throw Error('非加算入塾効果はこの診断で扱えない');
     const row=byTurn[event.turn];row.requestedEnrollment+=requested;row.actualEnrollment+=actual;row.lostEnrollment+=loss;if(loss>0)affected.add(event.turn);
     const no=String(card.cardNo);if(!byCard.has(no))byCard.set(no,{cardNo:no,name:card.cardName,applied:0,requestedEnrollment:0,actualEnrollment:0,lostEnrollment:0,games:new Set(),gamesWithLoss:new Set()});
     const c=byCard.get(no);c.applied++;c.games.add(record);c.requestedEnrollment+=requested;c.actualEnrollment+=actual;c.lostEnrollment+=loss;if(loss>0)c.gamesWithLoss.add(record);
    }
    for(const turn of affected)byTurn[turn].gamesWithLoss++;
   }
   return {n:records.length,byTurn:byTurn.map(r=>({...r,meanRequested:r.requestedEnrollment/r.games,meanActual:r.actualEnrollment/r.games,meanLoss:r.lostEnrollment/r.games})),byCard:[...byCard.values()].map(r=>({...r,games:r.games.size,gamesWithLoss:r.gamesWithLoss.size,minimum250:r.games.size>=250})),interpretation:'実際に解決した入塾の要求増分と増加量の差。体験上限による切り捨てを観測する。配置順や取得を変えれば全量回収できるという因果評価ではない。カード別の有効ゲーム数250未満は傾向の根拠にしない。'};
  },payload);
  await mkdir(outDir,{recursive:true});await writeFile(path.join(outDir,'summary.json'),JSON.stringify({generatedAt:new Date().toISOString(),groupId,implementationSha256,versions:JSON.parse(versions),audit,...summary},null,2)+'\n');console.log(JSON.stringify({n:summary.n,byTurn:summary.byTurn,interpretation:summary.interpretation}));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
