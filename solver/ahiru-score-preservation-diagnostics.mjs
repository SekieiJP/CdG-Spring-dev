#!/usr/bin/env node
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {runAhiruBrowser} from './ahiru-browser.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const [dir,output]=process.argv.slice(2);if(!dir||!output)throw Error('監査済み公開判断ディレクトリと出力先が必要');
const [publicBytes,teacherBytes,auditBytes]=await Promise.all(['public-decisions.json','teachers.json','audit.json'].map(f=>readFile(path.join(dir,f))));
const publicInput=JSON.parse(publicBytes),teachers=JSON.parse(teacherBytes),audit=JSON.parse(auditBytes);
if(sha(publicBytes)!==audit.publicInputSha256||sha(teacherBytes)!==audit.teachersSha256||audit.counts.games<250||audit.counts.games!==teachers.outcomes.length||audit.counts.decisions!==publicInput.rows.length||!audit.allStartsAccepted||audit.rerolls!==0||!audit.sourceSeedsUnique)throw Error('全開始・リセマラなしの監査とハッシュの一致が必要');
const result=await runAhiruBrowser({difficulty:'pro',publicInput,teachers,versions:{rankVersion:audit.physical.rankVersion}},{port:19420,modulePath:'/solver/browser/ahiru-score-preservation-diagnostics.js',exportName:'diagnoseScorePreservation'});
if(result.games!==audit.counts.games)throw Error('全開始の集計が必要');
const sources=Object.fromEntries(await Promise.all(['solver/ahiru-score-preservation-diagnostics.mjs','solver/browser/ahiru-score-preservation-diagnostics.js','game/js/scoreManager.js'].map(async f=>[f,sha(await readFile(f))])));
await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify({createdAt:new Date().toISOString(),purpose:'配置による下振れを防ぐ次の仮説のための過去全開始診断。進行中の方略を変更しない。',source:{dir,publicSha256:sha(publicBytes),teachersSha256:sha(teacherBytes),auditSha256:sha(auditBytes),actor:audit.sourceActor,versions:audit.physical},sources,result},null,2)+'\n');
console.log(JSON.stringify(result,null,2));
