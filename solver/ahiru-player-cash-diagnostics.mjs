#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {readRunBytes} from './pro-strategy-metrics.mjs';import {auditAhiruBatch} from './ahiru-pro-metrics.mjs';import {runAhiruBrowser} from './ahiru-browser.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');const [manifestFile,id,output]=process.argv.slice(2);assert(manifestFile&&id&&output,'manifest id outputが必要');
const manifestBytes=await readFile(manifestFile),manifest=JSON.parse(manifestBytes),run=manifest.runs.find(r=>r.id===id);assert(run&&manifest.n===250&&run.files.length===1,'固定した全250開始が必要');
const bytes=await readRunBytes(run.files[0]),records=auditAhiruBatch(JSON.parse(bytes),{seed:manifest.seed,offset:0,config:run.config,fingerprints:manifest.fingerprints});
const publicInput={rows:[]},teachers={outcomes:[]};
for(const [index,r] of records.entries()){
 const gameId='g'+index,s=r.result.score;
 teachers.outcomes.push({gameId,score:s.displayScore,stats:{experience:s.experience,enrollment:s.enrollment,satisfaction:s.satisfaction,accounting:s.accounting}});
 for(const [i,e] of r.events.filter(e=>e.type==='research-deletion-decision').entries())publicInput.rows.push({gameId,rowId:gameId+'-'+i,observation:e.observation,deleteMax:e.deleteMax,removed:e.decisions.map(d=>d.cardNo)});
}
const files=['solver/ahiru-player-cash-diagnostics.mjs','solver/browser/ahiru-player-cash-diagnostics.js','solver/ahiru-browser.mjs','solver/browser/pro-strategy-research.js','game/js/proAcquisitionAdvisor.js','game/js/scoreManager.js'];
const hashes=async()=>Promise.all(files.map(async file=>({file,sha256:sha(await readFile(file))})));const before=await hashes();
const result=await runAhiruBrowser({difficulty:'pro',publicInput,teachers,versions:manifest.fingerprints},{port:19540,modulePath:'/solver/browser/ahiru-player-cash-diagnostics.js',exportName:'diagnosePlayerCash'});
assert.equal(result.games,250);assert.deepEqual(before,await hashes());
await writeFile(output,JSON.stringify({createdAt:new Date().toISOString(),purpose:'報告の「経理が順調」の別解釈の対象を、既存の全250開始の公開会議で診断する。新しいゲームの実行は0。',manifestFile,manifestSha256:sha(manifestBytes),id,rawFile:run.files[0],rawSha256:sha(bytes),sources:before,result},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result,null,2));
