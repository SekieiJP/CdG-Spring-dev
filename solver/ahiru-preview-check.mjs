#!/usr/bin/env node
/** 独立した表示試作の確認。本体の診断・画面統合はまだ行わない。 */
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const origin='http://127.0.0.1:19110',html=(await readFile('solver/ahiru-advice-preview.html','utf8')).replaceAll('../game/data/ahiru/',origin+'/data/ahiru/'),dir='solver/local-runs/pro-mean125/ahiru-preview';await mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true}),checks=[];
try{for(const width of [320,360,390,430]){
 const page=await browser.newPage({viewport:{width,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2});
 await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());await page.setContent(html,{waitUntil:'networkidle'});
 if(await page.locator('.face[aria-expanded=false]').count()!==3)throw Error('初期の閉状態が不正');
 for(let i=0;i<3;i++)await page.locator('.face').nth(i).tap();
 const layout=await page.evaluate(()=>[...document.querySelectorAll('.example')].map(example=>{
  const face=example.querySelector('.face'),bubble=example.querySelector('.bubble'),action=example.querySelector('.action'),stats=example.querySelector('.stats');
  const b=face.getBoundingClientRect(),s=bubble.getBoundingClientRect(),a=action.getBoundingClientRect(),p=stats.getBoundingClientRect();
  return {tone:example.dataset.tone,characters:Array.from(bubble.textContent).length,opened:face.getAttribute('aria-expanded')==='true'&&!bubble.hidden,faceMin44:b.width>=44&&b.height>=44,belowParameters:Math.min(b.top,s.top)>=p.bottom,withinWidth:s.left>=0&&s.right<=innerWidth,actionBelowSpeech:a.top>=s.bottom,inline:['static','relative'].includes(getComputedStyle(bubble).position),imageLoaded:face.querySelector('img').naturalWidth>0};
 }));
 if(layout.some(x=>x.characters>25||Object.entries(x).some(([k,v])=>typeof v==='boolean'&&!v)))throw Error('幅・文字数・画像・重なりの検査失敗: '+JSON.stringify({width,layout}));
 const screenshot=`${dir}/width-${width}.png`;await page.screenshot({path:screenshot,fullPage:true});
 const boundary25=await page.evaluate(()=>{const bubble=document.getElementById('speech-red');bubble.textContent='あ'.repeat(25);const b=bubble.getBoundingClientRect(),a=bubble.closest('.example').querySelector('.action').getBoundingClientRect();return Array.from(bubble.textContent).length===25&&bubble.scrollWidth<=bubble.clientWidth&&b.right<=innerWidth&&a.top>=b.bottom;});if(!boundary25)throw Error('25文字の折り返し境界で重なり');
 await page.locator('.face').first().tap();if(await page.locator('#speech-red').isVisible())throw Error('タップで閉じない');
 checks.push({width,height:844,browser:'Chromium with touch emulation',layout,tapToggles:true,boundary25,screenshot});await page.close();
}}finally{await browser.close();}
const sha=b=>createHash('sha256').update(b).digest('hex'),files=['solver/ahiru-advice-preview.html','solver/ahiru-preview-check.mjs','game/data/ahiru/worried.svg','game/data/ahiru/notice.svg','game/data/ahiru/happy.svg'];
await writeFile('solver/research-results/ahiru-advice-20261103/preview-layout.json',JSON.stringify({createdAt:new Date().toISOString(),purpose:'固定の仮セリフによる独立表示試作。判定精度・本体統合・Safari実機の検証ではない。',sources:await Promise.all(files.map(async file=>({file,sha256:sha(await readFile(file))}))),checks},null,2)+'\n');console.log(JSON.stringify({widths:checks.map(c=>c.width),allPassed:true,previewOnly:true}));
