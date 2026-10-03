/** 保存された公開場面だけをブラウザで計算する。スマホの寸法と実機性能を区別する。 */
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,devices} from 'playwright';
import {recordsFrom} from './card-evaluation.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2);let output='solver/local-evaluation/advisor-benchmark.json',port=18156,limit=160;const files=[];
for(let i=0;i<args.length;i++){if(args[i]==='--output')output=args[++i];else if(args[i]==='--port')port=Number(args[++i]);else if(args[i]==='--limit')limit=Number(args[++i]);else files.push(args[i]);}
if(!files.length)throw new Error('場面を含む記録JSONを指定してください');
const observations=[];for(const file of files){const records=recordsFrom(JSON.parse(await readFile(resolve(root,file),'utf8')));for(const r of records)for(const e of r.events||[])if(e.type==='acquisition-decision')observations.push(e.observation);}
if(!observations.length)throw new Error('取得判断の記録がありません');
// 前半の同じターンだけに偏らないよう、記録全体から等間隔に場面を選ぶ。
const sample=Array.from({length:Math.min(limit,observations.length)},(_,i)=>observations[Math.floor(i*observations.length/Math.min(limit,observations.length))]);
const server=spawn(process.execPath,['scripts/test-server.mjs'],{cwd:root,env:{...process.env,CDG_TEST_PORT:String(port)},stdio:['ignore','pipe','pipe']});
let browser;
try{
    await new Promise((ok,fail)=>{const timer=setTimeout(()=>fail(new Error('分析サーバーの起動がタイムアウトしました')),10000);server.once('error',fail);server.once('exit',code=>fail(new Error(`分析サーバー停止: ${code}`)));server.stdout.on('data',data=>{if(String(data).includes('Test server:')){clearTimeout(timer);ok();}});});
    browser=await chromium.launch();const results=[];
    for(const [name,options] of [['desktop-chromium',devices['Desktop Chrome']],['iphone12-layout',devices['iPhone 12']],['android-chrome',devices['Pixel 5']]]){
        const context=await browser.newContext({...options,browserName:undefined,serviceWorkers:'block'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
        const origin=`http://127.0.0.1:${port}`;await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
        await page.goto(origin);await page.waitForFunction(()=>!!window.game?.uiController?.acquisitionAssist?.observer);
        const timing=await page.evaluate(async observations=>{const m=await import('/js/acquisitionAdvisor.js?v='+window.BUILD_VERSION.slice(1));
            m.recommendAcquisition(observations[0]);const durations=[];for(const o of observations){const start=performance.now();m.recommendAcquisition(o);durations.push(performance.now()-start);}
            durations.sort((a,b)=>a-b);return{n:durations.length,p50:durations[Math.ceil(durations.length*.5)-1],p95:durations[Math.ceil(durations.length*.95)-1],max:durations.at(-1),build:window.BUILD_VERSION};
        },sample);
        results.push({name,...timing,pageErrors:errors});await context.close();
    }
    const report={generatedAt:new Date().toISOString(),note:'同じMac上のChromiumによる画面寸法別測定。iPhone Safari・Android実機のCPU測定ではない。単位ms。',results};
    await mkdir(dirname(resolve(root,output)),{recursive:true});await writeFile(resolve(root,output),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser?.close();server.kill('SIGTERM');}
