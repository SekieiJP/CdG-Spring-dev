#!/usr/bin/env node
/** 変更された観測目標を、既存の最初の全1,000開始で再判定する。新しいプレイはしない。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {auditAhiruBatch,assessStability} from './ahiru-pro-metrics.mjs';
import {readRunBytes,compactRecord,summarizeOutcomes} from './pro-strategy-metrics.mjs';
import {meanInterval} from './pro-mean125-metrics.mjs';
const [manifestPath,output]=process.argv.slice(2);
if(!manifestPath||!output)throw Error('元計画と出力JSONが必要');
const manifestBytes=await readFile(manifestPath),manifest=JSON.parse(manifestBytes);
if(manifest.phase!=='validation'||manifest.n<1000||manifest.runs.length!==1)throw Error('全開始の固定確認計画が必要');
const run=manifest.runs[0],all=[],audit=[],sha=bytes=>createHash('sha256').update(bytes).digest('hex');
for(let batch=0;batch<4;batch++){
    const bytes=await readRunBytes(run.files[batch]),data=JSON.parse(bytes);
    const records=auditAhiruBatch(data,{seed:manifest.seed,offset:batch*250,config:run.config,fingerprints:manifest.fingerprints});
    audit.push({batch,offset:batch*250,n:records.length,uncompressedSha256:sha(bytes),sourceCommit:data.settings.provenance.gitCommit});
    all.push(...records.map(compactRecord));
}
if(new Set(all.map(record=>record.seed)).size!==1000)throw Error('1,000種類の開始が必要');
const scores=all.map(record=>record.score),assessment=assessStability(scores,{lowRateStrictlyBelow:.03});
const {retries,...stats}=summarizeOutcomes(all);
const report={createdAt:new Date().toISOString(),purpose:'ユーザーによる3%未満への目標変更を反映。旧判定は書き換えない。',selection:'保存済みの同じ固定方略の先頭0..999を全採用。結果による選別・新しい実行・リセマラは0。',sourceManifestSha256:sha(manifestBytes),seedPrefix:manifest.seed,config:run.config,fingerprints:manifest.fingerprints,audit,stats,assessment,mean95:meanInterval(scores),newGames:0,strategyGoalPassed:assessment.passed,interpretation:'観測1,000開始での達成。母集団の低得点率や人間の成績、軽い取得推薦の効果を保証する検定ではない。'};
await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({assessment,mean95:report.mean95,sourceCommits:[...new Set(audit.map(row=>row.sourceCommit))]},null,2));
