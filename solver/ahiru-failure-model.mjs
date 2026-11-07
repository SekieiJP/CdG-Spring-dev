#!/usr/bin/env node
/** 平均得点モデルを変えず、8点以下の頻度の固定木を付ける。 */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {attachRiskModel} from './ahiru-risk-model.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function attachFailureModel(mean,risk){return attachRiskModel(mean,risk,'pro-failure8');}
async function main(){
    const [meanFile,failureFile,output]=process.argv.slice(2);if(!meanFile||!failureFile||!output)throw Error('平均モデル・頻度モデル・出力が必要');
    if([meanFile,failureFile].some(file=>path.resolve(file)===path.resolve(output)))throw Error('元モデルを出力で上書きできない');
    const meanBytes=await readFile(meanFile),riskBytes=await readFile(failureFile),mean=JSON.parse(meanBytes),risk=JSON.parse(riskBytes),model=attachFailureModel(mean,risk);
    const {failureHead,...retained}=model.model;if(JSON.stringify(retained)!==JSON.stringify(mean.model))throw Error('平均得点モデルが変わった');
    await writeFile(output,JSON.stringify(model)+'\n');
    const audit={createdAt:new Date().toISOString(),meanFile,meanSha256:sha(meanBytes),failureFile,failureSha256:sha(riskBytes),output,outputSha256:sha(await readFile(output)),meanCoefficientsUnchanged:true,targetKind:'pro-failure8',versions:mean.provenance.versions};
    await writeFile(output+'.audit.json',JSON.stringify(audit,null,2)+'\n');console.log(JSON.stringify(audit));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(error);process.exitCode=1;});
