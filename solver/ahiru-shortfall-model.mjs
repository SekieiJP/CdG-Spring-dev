#!/usr/bin/env node
/** 平均得点モデルを変えず、別の低得点損失の固定木だけを付ける。 */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {VALUE_SCHEMA,VALUE_FEATURES} from './browser/pro-value-model.js';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function attachShortfallModel(mean,shortfall){
    const valid=model=>model?.schema===VALUE_SCHEMA&&Array.isArray(model.features)&&model.features.join('|')===VALUE_FEATURES.join('|')&&Number.isFinite(model.base)&&Number.isFinite(model.learningRate)&&Array.isArray(model.trees);
    const counts=shortfall?.provenance?.counts,versions=mean?.provenance?.versions;
    const compatible=Array.isArray(versions)&&versions.length===4&&JSON.stringify(versions)===JSON.stringify(shortfall?.provenance?.versions);
    const sufficient=Number.isInteger(counts?.trainSeeds)&&counts.trainSeeds>=250&&Number.isInteger(counts?.validationSeeds)&&counts.validationSeeds>=250;
    if(!valid(mean?.model)||!valid(shortfall?.model)||mean.model.shortfallHead||shortfall.model.shortfallHead||shortfall.provenance?.targetKind!=='pro-shortfall9'||mean.provenance?.targetKind&&mean.provenance.targetKind!=='official-score'||!compatible||!sufficient)throw Error('互換な平均モデルと、別250開始以上で比較した損失モデルが必要');
    return {...mean,model:{...mean.model,shortfallHead:{...shortfall.model,targetKind:'pro-shortfall9'}},shortfall:{id:shortfall.id,targetKind:'pro-shortfall9',prediction:'max(0, fixed-tree prediction)',provenance:shortfall.provenance}};
}
async function main(){
    const [meanFile,shortfallFile,output]=process.argv.slice(2);if(!meanFile||!shortfallFile||!output)throw Error('平均モデル・損失モデル・出力が必要');
    if([meanFile,shortfallFile].some(file=>path.resolve(file)===path.resolve(output)))throw Error('元モデルを出力で上書きできない');
    const meanBytes=await readFile(meanFile),tailBytes=await readFile(shortfallFile),mean=JSON.parse(meanBytes),tail=JSON.parse(tailBytes),model=attachShortfallModel(mean,tail);
    const {shortfallHead,...retained}=model.model;if(JSON.stringify(retained)!==JSON.stringify(mean.model))throw Error('平均得点モデルが変わった');
    await writeFile(output,JSON.stringify(model)+'\n');
    const audit={createdAt:new Date().toISOString(),meanFile,meanSha256:sha(meanBytes),shortfallFile,shortfallSha256:sha(tailBytes),output,outputSha256:sha(await readFile(output)),meanCoefficientsUnchanged:true,targetKind:'pro-shortfall9',versions:mean.provenance.versions};
    await writeFile(output+'.audit.json',JSON.stringify(audit,null,2)+'\n');console.log(JSON.stringify(audit));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(error);process.exitCode=1;});
