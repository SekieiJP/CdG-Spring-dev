import {trainValueModel,createValueForecaster} from './pro-value-model.js';
import {PAIRED_SCHEMA,PAIRED_FEATURES,encodePairedFeatures,reversePairedFeatures,predictPairedGain} from './pro-paired-value.js';
// 2026-10-04、実得点差を見る前に固定。検証の成績で条件を変えない。
export const PAIRED_SETTINGS=Object.freeze({depth:2,iterations:120,learningRate:.05,bins:8,featureFraction:.75,rowFraction:.8,minRows:25,minWeight:10,l2:5,seed:904125});
export function encodePairedTeachers(data,formula){
 if(data.schema!=='pro-paired-teachers-v1'||data.train.length!==500||data.validation.length!==250||data.counts.trainRoots!==500||data.counts.validationRoots!==250)throw Error('固定した500学習・250検証局面が必要');
 const ids=new Set(),context={forecast:createValueForecaster(formula.projectProDeck),score:formula.proGoal};
 const encode=rows=>rows.map(r=>{if(ids.has(r.sceneId)||!Number.isFinite(r.referenceScore)||!Number.isFinite(r.targetScore))throw Error('局面重複または公式得点不正');ids.add(r.sceneId);
  const x=encodePairedFeatures({...r.observation,rankTable:data.rankTable},r.referenceIndices,r.targetIndices,context);
  return {sceneId:r.sceneId,x,y:r.targetScore-r.referenceScore,weight:1};
 });
 const train=encode(data.train),validation=encode(data.validation);
 // 元局面は各1重み。逆向きの教師は元局面の複製で独立例ではない。
 const augmented=train.flatMap(r=>[{...r,weight:.5},{...r,x:reversePairedFeatures(r.x),y:-r.y,weight:.5}]);
 return {train,validation,augmented};
}
function rng(seed){let x=seed>>>0;return()=>{x=(Math.imul(1664525,x)+1013904223)>>>0;return x/4294967296;};}
function mean95(values){const random=rng(904126),means=[];for(let b=0;b<2000;b++){let sum=0;for(let i=0;i<values.length;i++)sum+=values[Math.floor(random()*values.length)];means.push(sum/values.length);}means.sort((a,b)=>a-b);return [means[50],means[1950]];}
export function pairedMetrics(model,rows){
 if(rows.length<250)throw Error('全250局面以上で確認する');
 const predictions=rows.map(r=>predictPairedGain(model,r.x)),avg=a=>a.reduce((s,v)=>s+v,0)/a.length;
 const errors=predictions.map((p,i)=>p-rows[i].y),zero=rows.map(r=>-r.y);
 const errorMetrics=e=>({mae:avg(e.map(Math.abs)),rmse:Math.sqrt(avg(e.map(x=>x*x))),bias:avg(e)});
 const gates={};for(const threshold of [0,.15]){const selected=rows.map((r,i)=>predictions[i]>threshold?r.y:0),changes=predictions.filter(p=>p>threshold).length;
  gates[String(threshold)]={n:rows.length,changes,keptReference:rows.length-changes,meanGainPerRoot:avg(selected),meanGain95:mean95(selected),sumGained:selected.filter(v=>v>0).reduce((s,v)=>s+v,0),sumLost:-selected.filter(v=>v<0).reduce((s,v)=>s+v,0),interpretation:'全局面を含む固定2択・固定後続方略の対照。変更例だけの率や独立全ゲーム成績ではない。'};
 }
 const antisymmetryError=Math.max(...rows.map((r,i)=>Math.abs(predictions[i]+predictPairedGain(model,reversePairedFeatures(r.x)))));
 return {n:rows.length,learned:errorMetrics(errors),zero:errorMetrics(zero),actualAlternativeMean:avg(rows.map(r=>r.y)),actualAlternativeMean95:mean95(rows.map(r=>r.y)),gates,antisymmetryError};
}
export async function fitPairedDataset(data,formula,onProgress){
 const rows=encodePairedTeachers(data,formula),model=await trainValueModel(rows.augmented,{...PAIRED_SETTINGS,schema:PAIRED_SCHEMA,featureNames:PAIRED_FEATURES,onProgress});
 return {model,metrics:{train:pairedMetrics(model,rows.train),validation:pairedMetrics(model,rows.validation)},audit:{trainRoots:rows.train.length,validationRoots:rows.validation.length,augmentedRows:rows.augmented.length,trainTotalWeight:rows.augmented.reduce((s,r)=>s+r.weight,0),features:PAIRED_FEATURES.length,labelsAndTrainingInBrowser:true}};
}
