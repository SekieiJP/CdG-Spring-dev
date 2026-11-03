/** ローカルの分析ページで公開入力の数式を実行する。私用照合情報はpayloadへ入れない。 */
import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
export async function runAhiruBrowser(payload,{port=19280,modulePath,exportName}){
    if(!['fresh','pro'].includes(payload.difficulty)||!Number.isInteger(port)||port<1024||port>65535||!/^\/solver\/browser\/ahiru-[a-z-]+\.js$/.test(modulePath)||!/^[a-zA-Z][a-zA-Z0-9]*$/.test(exportName))throw Error('分析ページの指定が不正');
    const root=path.resolve('.'),allowed=[path.join(root,'game')+path.sep,path.join(root,'solver/browser')+path.sep],bytes=Buffer.from(JSON.stringify(payload));
    const server=http.createServer(async(req,res)=>{try{
        const name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
        if(name==='/'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>あひる先生の分析</title>');return;}
        if(name==='/analysis-input.json'){res.writeHead(200,{'Content-Type':'application/json'});res.end(bytes);return;}
        const file=path.resolve(root,'.'+name);if(!allowed.some(prefix=>file.startsWith(prefix)))throw Error('path');
        const content=await readFile(file);res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':'text/plain','Cache-Control':'no-store'});res.end(content);
    }catch{res.writeHead(404);res.end();}});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
    let browser;
    try{
        browser=await chromium.launch({headless:true});const page=await browser.newPage();
        await page.route('**/*',route=>new URL(route.request().url()).origin===`http://127.0.0.1:${port}`?route.continue():route.abort());
        await page.goto(`http://127.0.0.1:${port}/`);
        return await page.evaluate(async({modulePath,exportName})=>{
            const input=await(await fetch('/analysis-input.json')).json();
            const [{ScoreManager},module]=await Promise.all([import('/game/js/scoreManager.js'),import(modulePath)]);
            const official=new ScoreManager(null,{migrateHighScore:false});await official.loadRankData('/game/data/'+(input.difficulty==='fresh'?'rankFresh.csv':'rankPro.csv'));
            if(!official.rankTable||official.dataVersion!==input.versions.rankVersion)throw Error('公式得点表が一致しない');
            for(const outcome of input.teachers.outcomes){const score=official.calculateScore({difficulty:input.difficulty,player:outcome.stats});if(score.displayScore!==outcome.score)throw Error('記録された最終値と公式得点の不一致');}
            return module[exportName]({...input,rankTable:official.rankTable});
        },{modulePath,exportName});
    }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
