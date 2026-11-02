#!/usr/bin/env node
/** 公開判断と教師を照合し、実際の助言・予測・集計はブラウザで実行する。 */
import http from 'node:http';
import path from 'node:path';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

export function validateDiagnosticData({publicInput,teachers,audit,seeds,trainingSeeds,calibration,publicSha,teacherSha,trainingPublicSha,allowDevelopment=false}){
    const games=audit.counts?.games;
    if(!Number.isInteger(games)||games<250||publicInput.schema!=='ahiru-public-decisions-v1'||teachers.schema!=='ahiru-decision-teachers-v1'||audit.publicInputSha256!==publicSha||audit.teachersSha256!==teacherSha||calibration.sourcePublicSha256!==trainingPublicSha)throw Error('監査済み250開始以上と固定補正の元資料が必要');
    const unique=(rows,key)=>new Set(rows.map(row=>row[key])).size===rows.length;
    if(teachers.outcomes.length!==games||seeds.length!==games||!unique(teachers.outcomes,'gameId')||!unique(seeds,'gameId')||!unique(seeds,'sourceSeed')||!unique(publicInput.rows,'rowId')||!unique(teachers.labels,'rowId'))throw Error('元開始・教師・局面の重複または不足');
    const actualIds=new Set(teachers.outcomes.map(row=>row.gameId));
    if(seeds.some(row=>!actualIds.has(row.gameId)||typeof row.sourceSeed!=='string'||!row.sourceSeed)||publicInput.rows.some(row=>!actualIds.has(row.gameId))||teachers.labels.length!==publicInput.rows.length||teachers.labels.some(row=>!actualIds.has(row.gameId)))throw Error('元開始と公開判断・教師の対応が不正');
    const rowIds=new Map(publicInput.rows.map(row=>[row.rowId,row.gameId]));
    if(teachers.labels.some(row=>rowIds.get(row.rowId)!==row.gameId)||new Set(publicInput.rows.map(row=>row.gameId)).size!==games||publicInput.rows.length!==audit.counts.decisions||publicInput.rows.filter(row=>row.phase==='acquisition').length!==audit.counts.acquisition||publicInput.rows.filter(row=>row.phase==='deletion').length!==audit.counts.deletion||teachers.outcomes.some(row=>!Number.isFinite(row.score)||['experience','enrollment','satisfaction','accounting'].some(axis=>!Number.isFinite(row.stats?.[axis]))))throw Error('全判断・教師・有限な最終値の対応が不正');
    if(trainingSeeds.length!==calibration.sourceGames||trainingSeeds.length<250||!unique(trainingSeeds,'sourceSeed')||trainingSeeds.some(row=>typeof row.sourceSeed!=='string'||!row.sourceSeed))throw Error('補正作成の元開始が不正');
    const train=new Set(trainingSeeds.map(row=>row.sourceSeed));
    const overlap=seeds.filter(row=>train.has(row.sourceSeed)).length;
    if(overlap&&!allowDevelopment)throw Error('補正作成と検証の元開始が重複');
    if(audit.physical?.cardVersion!==calibration.cardVersion||audit.physical?.rankVersion!==calibration.rankVersion)throw Error('補正のカード・得点表と異なる');
    return {games,overlap,inSample:overlap>0,independentStarts:overlap===0};
}

async function main(){
    const [directory,output]=process.argv.slice(2);
    if(!directory||!output)throw Error('公開判断ディレクトリと出力JSONが必要');
    const option=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
    const training=option('--training','solver/local-runs/pro-mean125/ahiru-decisions-baseline-dev'),port=Number(option('--port','19280'));
    if(!Number.isInteger(port)||port<1024||port>65535)throw Error('portが不正');
    const [publicBytes,teacherBytes,auditBytes,seeds,trainSeeds,trainAudit,calibrationBytes]=await Promise.all([
        readFile(directory+'/public-decisions.json'),readFile(directory+'/teachers.json'),readFile(directory+'/audit.json'),
        readFile(directory+'/source-seeds.private.json').then(JSON.parse),readFile(training+'/source-seeds.private.json').then(JSON.parse),
        readFile(training+'/audit.json').then(JSON.parse),readFile('game/data/ahiru/pro-projection-calibration.json')
    ]);
    const publicInput=JSON.parse(publicBytes),teachers=JSON.parse(teacherBytes),audit=JSON.parse(auditBytes),calibration=JSON.parse(calibrationBytes);
    const inputAudit=validateDiagnosticData({publicInput,teachers,audit,seeds,trainingSeeds:trainSeeds,calibration,publicSha:sha(publicBytes),teacherSha:sha(teacherBytes),trainingPublicSha:trainAudit.publicInputSha256,allowDevelopment:process.argv.includes('--development')});
    const root=path.resolve('.'),payload=Buffer.from(JSON.stringify({publicInput,teachers,calibration,versions:{cardVersion:audit.physical.cardVersion,rankVersion:audit.physical.rankVersion}}));
    const server=http.createServer(async(req,res)=>{try{
        const name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
        if(name==='/'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>あひる先生・予測診断</title>');return;}
        if(name==='/diagnostic-input.json'){res.writeHead(200,{'Content-Type':'application/json'});res.end(payload);return;}
        const file=path.resolve(root,'.'+name);
        if(!file.startsWith(root+path.sep)||!['/game/','/solver/browser/'].some(prefix=>name.startsWith(prefix)))throw Error('path');
        const content=await readFile(file);res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':'text/plain','Cache-Control':'no-store'});res.end(content);
    }catch{res.writeHead(404);res.end();}});
    await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
    let browser,result;
    try{
        browser=await chromium.launch({headless:true});const page=await browser.newPage();
        await page.route('**/*',route=>new URL(route.request().url()).origin===`http://127.0.0.1:${port}`?route.continue():route.abort());
        await page.goto(`http://127.0.0.1:${port}/`);
        result=await page.evaluate(async()=>{
            const input=await(await fetch('/diagnostic-input.json')).json();
            const [{ScoreManager},{diagnoseProAdvice}]=await Promise.all([import('/game/js/scoreManager.js'),import('/solver/browser/ahiru-advice-diagnostics.js')]);
            const official=new ScoreManager(null);await official.loadRankData('/game/data/rankPro.csv');
            if(!official.rankTable||official.dataVersion!==input.versions.rankVersion)throw Error('公式得点表が一致しない');
            for(const outcome of input.teachers.outcomes){const score=official.calculateScore({difficulty:'pro',player:outcome.stats});if(score.displayScore!==outcome.score)throw Error('保存済み公式結果と公開最終値の得点が異なる');}
            return diagnoseProAdvice({...input,rankTable:official.rankTable});
        });
    }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
    const sources=['solver/ahiru-advice-diagnostics.mjs','solver/browser/ahiru-advice-diagnostics.js','game/js/ahiruProAdvice.js','game/js/ahiruProForecast.js','game/js/ahiruProGoals.js','game/js/ahiruCardRoles.js','game/js/proAcquisitionAdvisor.js','game/js/scoreManager.js','game/js/cardManager.js','game/js/difficultyConfig.js','game/js/eventManager.js'];
    const report={createdAt:new Date().toISOString(),purpose:'固定したPRO助言の観測診断。過去の固定方略での将来結果との比較であり、助言に従う因果効果・人間の成績・個別の成功保証ではない。',inputAudit,sourceAuditSha256:sha(auditBytes),sourceConfig:audit.config,calibrationSha256:sha(calibrationBytes),sources:await Promise.all(sources.map(async file=>({file,sha256:sha(await readFile(file))}))),interpretation:'同じゲーム内の判断を独立した開始として数えない。250元開始未満の群は件数のみ。分位値の被覆は軸別であり共同の予測区間ではない。赤い助言後のS達成は、その不足を後で補えた場合も含む。',...result};
    await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({inputAudit,games:result.games,calls:result.calls,finalAgreements:result.finalAgreements,groups:Object.keys(result.groups).length}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(error);process.exitCode=1;});
