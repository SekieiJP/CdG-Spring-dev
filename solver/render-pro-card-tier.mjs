#!/usr/bin/env node
// Render and audit the standalone card-tier artifact; does not execute game trials.
import assert from 'node:assert/strict';
import {readFile, writeFile, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out=path.join(root,'docs/pro-card-tier');
const auditDir=path.join(root,'solver/research-results/pro-card-tier-20261006');
const playwrightModule=await import(process.env.CDG_PLAYWRIGHT_MODULE || '@playwright/test');
const {chromium,webkit}=playwrightModule.chromium ? playwrightModule : playwrightModule.default;
const bytes=await readFile(path.join(out,'card-tiers.json'));
const report=JSON.parse(bytes), sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(report.cards.length,51);
assert.deepEqual(report.cards.map(c=>c.cardNo).sort((a,b)=>a-b),Array.from({length:51},(_,i)=>i+1));
assert.deepEqual(report.criteria.tierSizes,{S:13,A:13,B:13,C:12});
assert.equal(report.criteria.rarityBonus,0);
assert.ok(report.cards.every(c=>c.commentLength>=20 && c.commentLength<=50 && c.commentLength===Array.from(c.comment).length));
assert.ok(report.cards.every(c=>c.adjustment && c.reason && c.effect && c.topText));
assert.ok(report.cards.every(c=>c.total===Number((11*c.universality+9*c.power).toFixed(1))));
assert.equal(sha(await readFile(path.join(root,'game/data/cards_pro.csv'))), report.provenance.cardsSha256);
for(const c of report.cards) assert.equal(sha(await readFile(path.resolve(out,c.image))),c.imageSha256);
const engines=[],unavailable=[];
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]) {
 let browser;
 try { browser=await engine.launch({headless:true}); }
 catch(error) { if(name==='chromium')throw error; unavailable.push({engine:name,reason:String(error).split('\n')[0]}); continue; }
 const errors=[];
 try {
 const context=await browser.newContext({viewport:{width:1840,height:1200},deviceScaleFactor:2});
 const page=await context.newPage();
 page.on('pageerror',error=>errors.push(String(error)));
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.goto(pathToFileURL(path.join(out,'index.html')).href);
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.querySelectorAll('.tile img')].map(i=>i.decode()));});
 const snapshot=await page.evaluate(()=>({
  ids:[...document.querySelectorAll('.tile')].map(e=>Number(e.dataset.card)).sort((a,b)=>a-b),
  counts:[...document.querySelectorAll('.tier-row')].map(e=>({tier:e.querySelector('.rank b').textContent,count:e.querySelectorAll('.tile').length})),
  images:[...document.querySelectorAll('.tile img')].every(i=>i.complete&&i.naturalWidth>0&&i.naturalHeight===i.naturalWidth),
  overflowingNames:[...document.querySelectorAll('.card-name')].filter(e=>e.scrollWidth>e.clientWidth+1 || e.scrollHeight>e.clientHeight+1).map(e=>e.textContent),
  shortTextCount:document.querySelectorAll('.card-toptext').length,
  shortTextMatches:[...document.querySelectorAll('.tile')].every(e=>e.querySelector('.card-toptext').textContent===JSON.parse(document.getElementById('tier-data').textContent).cards.find(c=>c.cardNo===Number(e.dataset.card)).topText),
  overflowingShortText:[...document.querySelectorAll('.card-toptext')].filter(e=>e.scrollWidth>e.clientWidth+1 || e.scrollHeight>e.clientHeight+1).map(e=>e.textContent),
  horizontalOverflow:document.documentElement.scrollWidth>innerWidth,
  chart:{width:document.getElementById('tier-chart').getBoundingClientRect().width,height:document.getElementById('tier-chart').getBoundingClientRect().height}
 }));
 assert.deepEqual(snapshot.ids,Array.from({length:51},(_,i)=>i+1));
 assert.deepEqual(snapshot.counts,[{tier:'S',count:13},{tier:'A',count:13},{tier:'B',count:13},{tier:'C',count:12}]);
 assert.ok(snapshot.images);
 assert.deepEqual(snapshot.overflowingNames,[]);
 assert.equal(snapshot.horizontalOverflow,false);
 assert.equal(snapshot.shortTextCount,51);
 assert.equal(snapshot.shortTextMatches,true);
 assert.deepEqual(snapshot.overflowingShortText,[]);
 let dialogs=0;
 for(const c of report.cards) {
  await page.locator('.tile[data-card="'+c.cardNo+'"]').click();
  assert.equal(await page.locator('#detail-comment').textContent(),c.comment);
  assert.ok((await page.locator('#detail-name').textContent()).includes(c.name));
  assert.ok((await page.locator('#detail-reason').textContent()).includes(c.adjustment));
  assert.ok((await page.locator('#detail-effect').textContent()).includes(c.effect));
  assert.equal(await page.locator('#sample-grid tr').count(),7);
  assert.equal(await page.locator('dialog[open]').count(),1);
  await page.locator('.close').click();
  dialogs++;
 }
 if(name==='chromium') await page.locator('#tier-chart').screenshot({path:path.join(out,'tier-list.png')});
 const mobile=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
 const mp=await mobile.newPage();
 mp.on('pageerror',error=>errors.push(String(error)));
 await mp.goto(pathToFileURL(path.join(out,'index.html')).href);
 await mp.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.querySelectorAll('.tile img')].map(i=>i.decode()));});
 const mobileLayout=await mp.evaluate(()=>({
  width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,
  shortTextCount:document.querySelectorAll('.card-toptext').length,
  overflowingShortText:[...document.querySelectorAll('.card-toptext')].filter(e=>e.scrollWidth>e.clientWidth+1 || e.scrollHeight>e.clientHeight+1).map(e=>e.textContent),
  overflowingNames:[...document.querySelectorAll('.card-name')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.textContent),
  images:[...document.querySelectorAll('.tile img')].every(i=>i.complete&&i.naturalWidth>0)
 }));
 assert.ok(mobileLayout.documentWidth<=mobileLayout.width);
 assert.deepEqual(mobileLayout.overflowingNames,[]);
 assert.ok(mobileLayout.images);
 assert.equal(mobileLayout.shortTextCount,51);
 assert.deepEqual(mobileLayout.overflowingShortText,[]);
 for(const number of [45,49,51]) {
  await mp.locator('.tile[data-card="'+number+'"]').tap();
  assert.equal(await mp.locator('dialog[open]').count(),1);
  const dialogBounds=await mp.locator('dialog').evaluate(e=>({width:e.clientWidth,scrollWidth:e.scrollWidth}));
  assert.ok(dialogBounds.scrollWidth<=dialogBounds.width+1);
  if(number===51)await mp.screenshot({path:path.join(auditDir,'mobile-detail-'+name+'.png')});
  await mp.locator('.close').tap();
 }
 await mp.evaluate(()=>scrollTo(0,0));
 await mp.screenshot({path:path.join(auditDir,'mobile-board-'+name+'.png')});
 assert.deepEqual(errors,[]);
 engines.push({engine:name,version:browser.version(),desktop:snapshot,dialogs,mobile:mobileLayout,mobileDialogs:[45,49,51],pageErrors:errors});
 } finally { await browser.close(); }
}
const mdPath=path.join(root,'docs/CdG-PRO-Card-Tier.md'),md=await readFile(mdPath,'utf8');
const localLinks=[];
for(const match of md.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){
 const ref=match[1]; if(/^[a-z]+:|^#/i.test(ref))continue;
 await stat(path.resolve(path.dirname(mdPath),ref));localLinks.push(ref);
}
assert.equal([...md.matchAll(/^\| \d{2} \|/gm)].length,51);
const png=await readFile(path.join(out,'tier-list.png'));
const audit={createdAt:new Date().toISOString(),scope:'PRO全51枚のティア資料の表示・完全性検証。新規ゲーム試行なし。',passed:true,
 coverage:{cards:51,shortTexts:51,rarities:[...new Set(report.cards.map(c=>c.rarity))],tiers:report.criteria.tierSizes,comments:{min:Math.min(...report.cards.map(c=>c.commentLength)),max:Math.max(...report.cards.map(c=>c.commentLength))},balanceAdvice:51},
 hashes:{data:sha(bytes),png:sha(png),markdown:sha(await readFile(mdPath))},engines,unavailable,localReportLinks:localLinks};
await writeFile(path.join(auditDir,'artifact-audit.json'),JSON.stringify(audit,null,2)+'\n');
console.log(JSON.stringify({passed:audit.passed,cards:51,tiers:audit.coverage.tiers,engines:engines.map(e=>e.engine),unavailable,pngBytes:png.length},null,2));
