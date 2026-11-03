#!/usr/bin/env node
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {runAhiruBrowser} from './ahiru-browser.mjs';
import {validateDiagnosticData} from './ahiru-advice-diagnostics.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const [directory,output]=process.argv.slice(2);
if(!directory||!output)throw Error('公開判断ディレクトリと出力JSONが必要');
const option=(key,fallback)=>{const index=process.argv.indexOf(key);return index<0?fallback:process.argv[index+1];};
const training=option('--training','solver/local-runs/pro-mean125/ahiru-decisions-baseline-dev');
const [publicBytes,teacherBytes,auditBytes,seeds,trainSeeds,trainAudit,calibrationBytes]=await Promise.all([
    readFile(directory+'/public-decisions.json'),readFile(directory+'/teachers.json'),readFile(directory+'/audit.json'),
    readFile(directory+'/source-seeds.private.json').then(JSON.parse),readFile(training+'/source-seeds.private.json').then(JSON.parse),
    readFile(training+'/audit.json').then(JSON.parse),readFile('game/data/ahiru/pro-projection-calibration.json')
]);
const publicInput=JSON.parse(publicBytes),teachers=JSON.parse(teacherBytes),audit=JSON.parse(auditBytes),calibration=JSON.parse(calibrationBytes);
const inputAudit=validateDiagnosticData({publicInput,teachers,audit,seeds,trainingSeeds:trainSeeds,calibration,publicSha:sha(publicBytes),teacherSha:sha(teacherBytes),trainingPublicSha:trainAudit.publicInputSha256});
const sourceFiles=['game/js/proAcquisitionConsistency.js','game/js/ahiruStatusPolicy.js','game/js/proAcquisitionAdvisor.js','game/js/ahiruProAdvice.js','game/js/ahiruProForecast.js','game/js/ahiruForecast.js','game/js/ahiruCardRoles.js','solver/browser/ahiru-assist-consistency.js'];
const hashes=()=>Promise.all(sourceFiles.map(async file=>({file,sha256:sha(await readFile(file))})));
const sources=await hashes();
const result=await runAhiruBrowser({difficulty:'pro',publicInput,teachers,calibration,versions:{cardVersion:audit.physical.cardVersion,rankVersion:audit.physical.rankVersion}},{port:Number(option('--port','19383')),modulePath:'/solver/browser/ahiru-assist-consistency.js',exportName:'diagnoseProAssistConsistency'});
if(JSON.stringify(sources)!==JSON.stringify(await hashes()))throw Error('診断中に方略が変化した');
await mkdir(path.dirname(output),{recursive:true});
await writeFile(output,JSON.stringify({createdAt:new Date().toISOString(),inputAudit,sourceAuditSha256:sha(auditBytes),calibrationSha256:sha(calibrationBytes),sources,...result},null,2)+'\n');
console.log(JSON.stringify({inputAudit,...result,examples:undefined},null,2));
