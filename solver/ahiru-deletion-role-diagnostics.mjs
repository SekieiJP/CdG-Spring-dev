#!/usr/bin/env node
/** 読出し・対応照合・保存のみ。効果判定・投影・集計はブラウザ。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {runAhiruBrowser} from './ahiru-browser.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const [dir,output]=process.argv.slice(2);if(!dir||!output)throw Error('監査済み公開判断ディレクトリと出力先が必要');
const [publicBytes,teacherBytes,auditBytes,seedBytes]=await Promise.all(['public-decisions.json','teachers.json','audit.json','source-seeds.private.json'].map(f=>readFile(path.join(dir,f))));
const publicInput=JSON.parse(publicBytes),teachers=JSON.parse(teacherBytes),audit=JSON.parse(auditBytes),seeds=JSON.parse(seedBytes);
const unique=(rows,key)=>new Set(rows.map(r=>r[key])).size===rows.length;
const ids=new Set(teachers.outcomes.map(o=>o.gameId)),rowIds=new Map(publicInput.rows.map(r=>[r.rowId,r.gameId]));
if(sha(publicBytes)!==audit.publicInputSha256||sha(teacherBytes)!==audit.teachersSha256||audit.counts.games<250||audit.counts.games!==teachers.outcomes.length||audit.counts.decisions!==publicInput.rows.length||audit.counts.deletion!==publicInput.rows.filter(r=>r.phase==='deletion').length||!audit.allStartsAccepted||audit.rerolls!==0||!audit.sourceSeedsUnique||seeds.length!==ids.size||!unique(seeds,'sourceSeed')||!unique(seeds,'gameId')||seeds.some(r=>!ids.has(r.gameId))||!unique(teachers.outcomes,'gameId')||rowIds.size!==publicInput.rows.length||!unique(teachers.labels,'rowId')||teachers.labels.length!==publicInput.rows.length||teachers.labels.some(r=>rowIds.get(r.rowId)!==r.gameId))throw Error('全開始・リセマラなしの監査と公開入力/教師の一致が必要');
// 当時の削除投影と同じ固定エンジン重み、2回投影に限定する。
if(audit.config.deletion!=='aggressive'||audit.config.objective!=='engine'||audit.config.weights||audit.config.predictiveEffects||audit.config.futureAllowance)throw Error('元方略の削除投影が診断対象と異なる');
const files=['solver/ahiru-deletion-role-diagnostics.mjs','solver/browser/ahiru-deletion-role-diagnostics.js','solver/ahiru-browser.mjs','solver/browser/pro-strategy-research.js','solver/browser/pro-intrinsic-recovery.js','game/js/proAcquisitionAdvisor.js','game/js/cardManager.js','game/js/scoreManager.js'];
const hashes=async()=>Promise.all(files.map(async file=>({file,sha256:sha(await readFile(file))})));
const before=await hashes();
const result=await runAhiruBrowser({difficulty:'pro',publicInput,teachers,versions:audit.physical},{port:19480,modulePath:'/solver/browser/ahiru-deletion-role-diagnostics.js',exportName:'diagnoseDeletionRoles'});
if(result.games!==audit.counts.games||result.decisions!==audit.counts.deletion||JSON.stringify(before)!==JSON.stringify(await hashes()))throw Error('全開始・全削除・固定ソースが必要');
await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify({createdAt:new Date().toISOString(),purpose:'将来の経理消費がある時も最後の回復札を残す仮説のための、過去全開始の記述診断。進行中の比較を変更しない。',source:{dir,publicSha256:sha(publicBytes),teachersSha256:sha(teacherBytes),auditSha256:sha(auditBytes),actor:audit.sourceActor,versions:audit.physical},sources:before,result},null,2)+'\n');
console.log(JSON.stringify(result,null,2));
