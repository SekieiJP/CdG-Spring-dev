#!/usr/bin/env node
/** ブラウザ内の固定式投影を、既存250開始の公式結果と比較する。方略の操作は変更しない。 */
import http from 'node:http';
import path from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const sha=b=>createHash('sha256').update(b).digest('hex'),dir='solver/local-runs/pro-mean125/ahiru-decisions-baseline-dev';
const publicBytes=await readFile(dir+'/public-decisions.json'),teacherBytes=await readFile(dir+'/teachers.json'),audit=JSON.parse(await readFile(dir+'/audit.json'));
if(audit.publicInputSha256!==sha(publicBytes)||audit.teachersSha256!==sha(teacherBytes)||audit.counts.games!==250||audit.diagnostic!==true)throw Error('固定した開発250開始の公開材料が必要');
const inputBytes=Buffer.from(JSON.stringify({public:JSON.parse(publicBytes),teachers:JSON.parse(teacherBytes)})),root=path.resolve('game'),port=19210;
const server=http.createServer(async(req,res)=>{try{
 const p=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
 if(p==='/diagnostic-input.json'){res.writeHead(200,{'Content-Type':'application/json'});res.end(inputBytes);return;}
 const research=p==='/research/pro-value-model.js',f=research?path.resolve('solver/browser/pro-value-model.js'):path.resolve(root,'.'+(p==='/'?'/index.html':p));
 if(!research&&!f.startsWith(root+path.sep))throw Error('path');res.writeHead(200,{'Content-Type':f.endsWith('.js')?'application/javascript':f.endsWith('.html')?'text/html':'text/plain','Cache-Control':'no-store'});res.end(await readFile(f));
}catch{res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});let result;
try{
 const page=await browser.newPage();await page.route('**/*',r=>new URL(r.request().url()).origin===`http://127.0.0.1:${port}`?r.continue():r.abort());await page.goto(`http://127.0.0.1:${port}/`);await page.waitForFunction(()=>window.game?.cardManager?.allCards.length>0);
 result=await page.evaluate(async()=>{
  await window.game.setDifficulty('pro');const input=await(await fetch('/diagnostic-input.json')).json(),vm=await import('/research/pro-value-model.js'),formula=await import('/js/proAcquisitionAdvisor.js');
  const forecast=vm.createValueForecaster(formula.projectProDeck),rankTable=window.game.scoreManager.rankTable,axes=['experience','enrollment','satisfaction','accounting'],labels=new Map(input.teachers.labels.map(r=>[r.rowId,r])),outcomes=new Map(input.teachers.outcomes.map(r=>[r.gameId,r]));
  if(outcomes.size!==250)throw Error('全250の元ゲームが必要');
  const groups=new Map(),seen=new Set();
  for(const row of input.public.rows){
   if(row.phase==='acquisition'&&row.observation.allowSkip)continue;
   const unique=row.gameId+':'+row.phase+':'+row.observation.turn;if(seen.has(unique))throw Error('同じ元ゲームと時期の重複');seen.add(unique);
   const original=row.observation,phaseTurn=original.turn,root={...original,rankTable,turn:phaseTurn+(row.phase==='deletion'?1:0),tokens:{...original.tokens,organize:row.phase==='deletion'?0:original.tokens.organize}},label=labels.get(row.rowId),actual=outcomes.get(row.gameId);
   if(!label||!actual)throw Error('公開入力と教師の対応が不足');
   const after=[...root.owned];
   if(row.phase==='acquisition')for(const i of label.action.indices)after.push({...root.candidates[i],acquiredTurn:phaseTurn});
   else for(const no of label.action.cardNos){const index=after.findIndex(c=>String(c.cardNo)===no);if(index<0)throw Error('実削除と所有カードの不一致');after.splice(index,1);}
   for(const [position,cards] of [['before-choice',root.owned],['after-choice',after]]){
    const end=root.turn>=root.totalTurns?{...root.stats}:forecast(root,cards).end,points=formula.proGoal(end,rankTable).points,key=`${row.phase}-turn-${phaseTurn}-${position}`;
    const value={gameId:row.gameId,end,points,actual,ownedCount:cards.length};if(!Object.values(end).every(Number.isFinite))throw Error('投影が有限でない');
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(value);
   }
  }
  const mean=a=>a.reduce((s,v)=>s+v,0)/a.length,q=(a,p)=>[...a].sort((x,y)=>x-y)[Math.max(0,Math.ceil(a.length*p)-1)];
  const report={};for(const [key,rows]of groups){const games=new Set(rows.map(r=>r.gameId)).size;
   if(games<250){report[key]={games,states:rows.length,support250:false,interpretation:'250元開始未満なので傾向や校正値を出さない。'};continue;}
   const actualS=rows.filter(r=>r.actual.score>=12).length,predictedS=rows.filter(r=>r.points>=12).length;
   report[key]={games,states:rows.length,support250:true,ownedMin:Math.min(...rows.map(r=>r.ownedCount)),ownedMax:Math.max(...rows.map(r=>r.ownedCount)),actualS,predictedS,projectedSButActualBelow:rows.filter(r=>r.points>=12&&r.actual.score<12).length,projectedBelowButActualS:rows.filter(r=>r.points<12&&r.actual.score>=12).length,
    projectedMeanPoints:mean(rows.map(r=>r.points)),actualMeanPoints:mean(rows.map(r=>r.actual.score)),axes:Object.fromEntries(axes.map(axis=>{const residuals=rows.map(r=>r.actual.stats[axis]-r.end[axis]);return [axis,{meanPredicted:mean(rows.map(r=>r.end[axis])),meanActual:mean(rows.map(r=>r.actual.stats[axis])),biasPredictedMinusActual:-mean(residuals),mae:mean(residuals.map(Math.abs)),actualMinusProjectionQuantiles:{p10:q(residuals,.1),median:q(residuals,.5),p90:q(residuals,.9)}}];}))};
  }
  return {groups:report,allSourceGames:outcomes.size,featuresAndStatisticsInBrowser:true,forecaster:'固定2回の代数補正。今のデッキだけ。未来の取得・実seed・山札順は入力しない。',interpretation:'未取得の将来カードを含む実際の最終値との比較。早い時期の差を、現在デッキの投影が間違った証明とは扱わない。before/afterは実選択を追加・削除した公開状態で、個別選択の因果効果ではない。'};
 });
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
const files=['solver/ahiru-forecast-diagnostics.mjs','solver/browser/pro-value-model.js','game/js/proAcquisitionAdvisor.js'];
const report={createdAt:new Date().toISOString(),purpose:'アドバイスの設計のための開発250開始の観測診断。2,000開始の方略検証やセリフの精度検証ではない。',sourceAuditSha256:sha(await readFile(dir+'/audit.json')),publicInputSha256:sha(publicBytes),teachersSha256:sha(teacherBytes),sources:await Promise.all(files.map(async file=>({file,sha256:sha(await readFile(file))}))),...result};
await writeFile('solver/research-results/ahiru-advice-20261103/forecast-diagnostics.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(Object.fromEntries(Object.entries(result.groups).filter(([key])=>key.startsWith('acquisition-')&&key.endsWith('after-choice')).map(([key,g])=>[key,{games:g.games,predictedS:g.predictedS,actualS:g.actualS,projectedMeanPoints:g.projectedMeanPoints,actualMeanPoints:g.actualMeanPoints}]))));
