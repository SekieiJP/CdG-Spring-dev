#!/usr/bin/env node
/** 実際の表示部品を、判定用の固定データで独立検査する。本体未接続。 */
import {chromium} from 'playwright';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const origin='http://127.0.0.1:19110',root='solver/local-runs/pro-mean125/ahiru-view',html=(await readFile('solver/ahiru-advice-preview.html','utf8')).replaceAll('../game/data/ahiru/',origin+'/data/ahiru/'),moduleSource=await readFile('solver/ui/ahiru-advice-view.js','utf8'),css=await readFile('solver/ui/ahiru-advice.css','utf8');
await mkdir(root,{recursive:true});const browser=await chromium.launch({headless:true}),checks=[];
try{for(const width of [320,360,390,430]){
 const page=await browser.newPage({viewport:{width,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2});
 await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());await page.setContent(html,{waitUntil:'networkidle'});await page.addStyleTag({content:css});
 const setup=await page.evaluate(async({moduleSource,assetBase})=>{
  const url=URL.createObjectURL(new Blob([moduleSource],{type:'text/javascript'})),{AhiruAdviceView}=await import(url);URL.revokeObjectURL(url);
  document.querySelectorAll('.advice').forEach(node=>node.remove());
  const fixtures=[{tone:'red',text:'体験が不足気味。動員を補強しよう'},{tone:'yellow',text:'経理は十分。庶務を減らせそうだよ'},{tone:'green',text:'順調だよ。入塾をさらに伸ばそう'}];
  const views=[...document.querySelectorAll('.example')].map((example,i)=>{const v=new AhiruAdviceView(example.querySelector('.stats'),{assetBase});if(!v.host.hidden||v.open)throw Error('初期状態');v.show(fixtures[i]);if(v.host.previousElementSibling!==example.querySelector('.stats'))throw Error('パラメータ直後に配置されていない');return v;});
  window.ahiruViewCheck={views,fixtures};return {initiallyCollapsed:views.every(v=>!v.open&&v.speech.hidden),uniqueSpeechIds:new Set(views.map(v=>v.speech.id)).size===3};
 },{moduleSource,assetBase:origin+'/data/ahiru/'});
 for(let i=0;i<3;i++)await page.locator('.ahiru-advice__face').nth(i).tap();
 const layout=await page.evaluate(()=>window.ahiruViewCheck.views.map(v=>{const b=v.button.getBoundingClientRect(),s=v.speech.getBoundingClientRect(),a=v.host.nextElementSibling.getBoundingClientRect(),p=v.host.previousElementSibling.getBoundingClientRect();return {tone:v.tone,characters:Array.from(v.speech.textContent).length,opened:v.open&&!v.speech.hidden,faceMin44:b.width>=44&&b.height>=44,belowParameters:Math.min(b.top,s.top)>=p.bottom,withinWidth:s.left>=0&&s.right<=innerWidth,actionBelowSpeech:a.top>=s.bottom,inline:['static','relative'].includes(getComputedStyle(v.speech).position),imageLoaded:v.image.complete&&v.image.naturalWidth>0};}));
 if(!setup.initiallyCollapsed||!setup.uniqueSpeechIds||layout.some(x=>x.characters>25||Object.values(x).some(v=>typeof v==='boolean'&&!v)))throw Error('表示部品の配置・タップ・画像の検査失敗');
 const screenshot=`${root}/width-${width}.png`;await page.screenshot({path:screenshot,fullPage:true});
 const lifecycle=await page.evaluate(()=>{
  const {views,fixtures}=window.ahiruViewCheck,v=views[0];v.show({tone:'green',text:'あ'.repeat(25)});
  const b=v.speech.getBoundingClientRect(),a=v.host.nextElementSibling.getBoundingClientRect();if(b.right>innerWidth||v.speech.scrollWidth>v.speech.clientWidth||a.top<b.bottom)throw Error('25文字の折り返し');
  let rejected=0;for(const data of [{tone:'red',text:'あ'.repeat(26)},{tone:'blue',text:'短い文'},{tone:'red',text:''},{tone:'red',text:'改行\nあり'}])try{v.show(data);}catch{rejected++;}if(rejected!==4||v.tone!=='green')throw Error('不正入力の拒否');
  v.hide();if(!v.host.hidden)throw Error('非表示');v.show(fixtures[0]);if(!v.open||v.speech.hidden)throw Error('開状態を保持しない');
  v.reset();if(v.open||!v.host.hidden||!v.speech.hidden)throw Error('新ゲームのリセット');v.show(fixtures[0]);
  v.show({tone:'green',text:'Keep going'});
  const button=v.button,expanded=button.getAttribute('aria-expanded');v.destroy();button.click();if(button.isConnected||button.getAttribute('aria-expanded')!==expanded)throw Error('破棄後のリスナー残存');
  return {boundary25:true,invalidInputsRejected:true,hideAndRestore:true,resetClosed:true,destroyRemovesListener:true};
 });
 checks.push({width,browser:'Chromium with touch emulation',setup,layout,lifecycle,screenshot});await page.close();
}}finally{await browser.close();}
const sha=b=>createHash('sha256').update(b).digest('hex'),files=['solver/ui/ahiru-advice-view.js','solver/ui/ahiru-advice.css','solver/ahiru-view-check.mjs'];
await writeFile('solver/research-results/ahiru-advice-20261103/view-component.json',JSON.stringify({createdAt:new Date().toISOString(),purpose:'表示部品のみの固定データ検査。実際の不足/余剰判定・本体統合・Safari実機は未検証。',sources:await Promise.all(files.map(async file=>({file,sha256:sha(await readFile(file))}))),checks},null,2)+'\n');console.log(JSON.stringify({widths:checks.map(c=>c.width),allPassed:true,viewOnly:true}));
