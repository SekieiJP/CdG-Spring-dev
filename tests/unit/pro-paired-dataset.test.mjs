import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {collectPairedValueRows} from '../../solver/pro-paired-value-dataset.mjs';
import {prepareChoiceSceneBatch} from '../../solver/pro-card-scene-input.mjs';
const versions=['game','cards','ranks'],config={id:'fixed',planning:{worlds:8,valueHorizon:2},valueModelSha256:'fixed-model'};
function fixture(){
 const card=n=>({cardNo:String(n),cardName:'Card'+n,rarity:n<6?'N':'R',category:'動員',effect:'体験+2。',acquiredTurn:0});
 const scenes=Array.from({length:750},(_,i)=>{const turn=[0,2,4,6][i%4];return {sceneId:'choice-'+i,observation:{difficulty:'pro',mode:'normal',turn,totalTurns:8,stats:{experience:8,enrollment:2,satisfaction:10,accounting:9},tokens:{passion:0,fatigue:0,inspiration:0,organize:0},owned:[card(1)],candidates:[card(6),card(7),card(8),card(9)],pickCount:turn===0?2:1,allowSkip:false,turns:Array(8).fill({}),offerHistory:[],refreshRemaining:2,seed:'hidden-source',futureResult:16},referenceIndices:turn===0?[0,1]:[0],targetIndices:turn===0?[0,2]:[1]};});
 const bankBytes=Buffer.from(JSON.stringify({kind:'choices',versions,scenes})),hash=createHash('sha256').update(bankBytes).digest('hex'),audit={bank:{sha256:hash,n:750},counts:{train:500,validation:250},versions:[...versions,'autoplay'],rerolls:0,allStartsAccepted:true,sourceSeedsDisjoint:true,policy:structuredClone(config),sceneAudit:scenes.map((s,i)=>({sceneId:s.sceneId,sourceTurn:s.observation.turn,sourceSeed:'source-'+i,split:i<500?'train':'validation'}))};
 const manifest={bank:{sha256:hash,n:750},fingerprints:{codeHash:versions[0],cardVersion:versions[1],rankVersion:versions[2],strategyVersion:'actor'},seed:'future-study',config:structuredClone(config)};
 const catalog=Array.from({length:51},(_,i)=>card(i+1)),runs=[];
 for(const arm of ['reference','target']){
  const input=prepareChoiceSceneBatch(bankBytes,arm,{episodes:750,versions});
  for(let b=0;b<3;b++){
   const rs=input.scenes.slice(b*250,b*250+250).map((s,i)=>({metadata:{difficulty:'pro',source:'counterfactual',seed:`future-study:${b*250+i}`,totalTurns:8,sceneKind:'choices',sceneArm:arm,sceneId:s.sceneId,sceneBankSha256:hash,sceneObservationSha256:s.observationSha256,forcedChoice:s.forcedChoice,research:structuredClone(config),provenance:{codeHash:versions[0],strategyVersion:'actor'},cardVersion:versions[1],rankVersion:versions[2],catalog,randomState:{hidden:true}},result:{score:{displayScore:arm==='reference'?12:13}},events:[{type:'research-counterfactual-start',observation:s.observation,forcedChoice:s.forcedChoice},...s.observation.owned.map(c=>({type:'acquire',card:c})),...s.forcedChoice.map(j=>({type:'acquire',card:s.observation.candidates[j]})),...Array.from({length:8-s.observation.turn},(_,j)=>({type:'research-placement-decision',turn:s.observation.turn+j}))]}));
   runs.push({arm,file:`${arm}-${b}`,sha256:'run-sha',data:{settings:{episodes:250,episodeOffset:b*250,seed:manifest.seed,difficulty:'pro',research:structuredClone(config),provenance:{codeHash:versions[0],strategyVersion:'actor'},sceneBatch:{sha256:hash,arm}},simulations:[{playRecords:rs}]}});
  }
 }
 return {bankBytes,audit,manifest,runs};
}
test('全750元局面・1500継続を監査し、公開状態と公式得点を分離してコピーする',()=>{
 const f=fixture(),d=collectPairedValueRows(f);assert.equal(d.train.length,500);assert.equal(d.validation.length,250);assert.equal(d.catalog.length,51);assert.equal(d.sources.length,6);
 const r=d.train[0];assert.equal(r.referenceScore,12);assert.equal(r.targetScore,13);assert.equal('seed' in r.observation,false);assert.equal('futureResult' in r.observation,false);assert.equal('randomState' in r,false);assert.equal('sourceSeed' in r,false);assert.equal('target' in r.observation,false);assert.equal('gain' in r,false);
 // 点数による元局面の選別はしない。差の計算はブラウザに残す。
 f.runs[0].data.simulations[0].playRecords[0].result.score.displayScore=-4;
 assert.equal(collectPairedValueRows(f).train[0].referenceScore,-4);
});
test('全開始の欠落、重複、分離の漏洩、対照シード変更、途中打切りを拒否する',()=>{
 for(const change of [f=>f.runs.pop(),f=>f.runs[1]=f.runs[0],f=>f.audit.sceneAudit[500].sourceSeed=f.audit.sceneAudit[0].sourceSeed,
  f=>f.runs[0].data.simulations[0].playRecords.pop(),f=>f.runs[3].data.simulations[0].playRecords[0].metadata.seed='changed',
  f=>f.runs[0].data.simulations[0].playRecords[0].truncated=true,f=>f.runs[0].data.simulations[0].playRecords[0].metadata.reroll={attempts:2}]){
  const f=fixture();change(f);assert.throws(()=>collectPairedValueRows(f));
 }
});
test('公開局面、強制取得、全残りターン、物理版、固定設定の不一致を拒否する',()=>{
 for(const change of [r=>r.metadata.provenance.strategyVersion='other',r=>r.metadata.cardVersion='other',r=>r.metadata.forcedChoice=[2,3],
  r=>r.events[0].observation={...r.events[0].observation,refreshRemaining:99},r=>r.events.splice(3,1),r=>r.events.pop(),
  r=>r.metadata.research.valueModelSha256='other',r=>r.result.score.displayScore=NaN]){
  const f=fixture();change(f.runs[0].data.simulations[0].playRecords[0]);assert.throws(()=>collectPairedValueRows(f));
 }
});
