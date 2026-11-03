#!/usr/bin/env node
/** 公開局面と公式得点を対応づける。差の計算・学習・ゲーム判断はブラウザ内。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareChoiceSceneBatch} from './pro-card-scene-input.mjs';
import {collectChoiceScenes} from './pro-choice-scene-bank.mjs';
import {policyIdentity} from './pro-policy-value-preflight.mjs';
import {readRunBytes} from './pro-strategy-metrics.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function collectPairedValueRows({bankBytes,audit,manifest,runs}){
 const bank=JSON.parse(bankBytes),versions=[manifest.fingerprints.codeHash,manifest.fingerprints.cardVersion,manifest.fingerprints.rankVersion];
 if(bank.scenes?.length!==750||audit.bank?.sha256!==sha(bankBytes)||manifest.bank?.sha256!==sha(bankBytes)||audit.bank.n!==750||manifest.bank.n!==750||!same(audit.counts,{train:500,validation:250})||!same(audit.versions?.slice(0,3),versions)||audit.rerolls!==0||audit.allStartsAccepted!==true||audit.sourceSeedsDisjoint!==true||manifest.config.initial||policyIdentity(audit.policy)!==policyIdentity(manifest.config))throw Error('固定した750局面・版・継続方略・分離監査が必要');
 const prepared=Object.fromEntries(['reference','target'].map(arm=>[arm,prepareChoiceSceneBatch(bankBytes,arm,{episodes:750,versions})]));
 const splits=new Map(),sourceSeeds=new Set();
 for(let i=0;i<750;i++){
  const a=audit.sceneAudit?.[i],s=bank.scenes[i];
  if(!a||a.sceneId!==s.sceneId||a.sourceTurn!==s.observation.turn||!['train','validation'].includes(a.split)||typeof a.sourceSeed!=='string'||sourceSeeds.has(a.sourceSeed))throw Error('元開始の重複・選別・分離順序の不一致');
  sourceSeeds.add(a.sourceSeed);splits.set(a.sceneId,a.split);
 }
 if(audit.sceneAudit.length!==750||[...splits.values()].filter(s=>s==='train').length!==500||[...splits.values()].filter(s=>s==='validation').length!==250||runs.length!==6)throw Error('全500学習・250検証・6継続ファイルが必要');
 const records={reference:new Map(),target:new Map()},sourceAudits=[],usedFiles=new Set();let catalog=null;
 for(const {arm,file,sha256,data:d} of runs){
  if(!records[arm]||usedFiles.has(file))throw Error('取得群・ファイルの重複');usedFiles.add(file);
  const offset=d.settings?.episodeOffset,rs=d.simulations?.[0]?.playRecords;
  if(![0,250,500].includes(offset)||d.settings.seed!==manifest.seed||d.settings.episodes!==250||d.settings.difficulty!=='pro'||d.simulations.length!==1||rs?.length!==250||!same(d.settings.research,manifest.config)||d.settings.provenance?.strategyVersion!==manifest.fingerprints.strategyVersion||d.settings.provenance?.codeHash!==versions[0]||d.settings.sceneBatch?.sha256!==manifest.bank.sha256||d.settings.sceneBatch.arm!==arm)throw Error('全250継続の開始順・設定・版が不一致');
  for(let i=0;i<250;i++){
   const r=rs[i],m=r.metadata,s=prepared[arm].scenes[offset+i],start=r.events.find(e=>e.type==='research-counterfactual-start'),placements=r.events.filter(e=>e.type==='research-placement-decision');
   if(!m||m.source!=='counterfactual'||m.difficulty!=='pro'||m.reroll||r.truncated||m.totalTurns!==8||!Number.isFinite(r.result?.score?.displayScore)||m.seed!==`${manifest.seed}:${offset+i}`||m.sceneKind!=='choices'||m.sceneArm!==arm||m.sceneId!==s.sceneId||m.sceneBankSha256!==manifest.bank.sha256||m.sceneObservationSha256!==s.observationSha256||!same(m.forcedChoice,s.forcedChoice)||!same(m.research,manifest.config)||m.provenance?.strategyVersion!==manifest.fingerprints.strategyVersion||!same([m.provenance?.codeHash,m.cardVersion,m.rankVersion],versions)||!same(start?.observation,s.observation)||!same(start?.forcedChoice,s.forcedChoice)||placements.length!==8-s.observation.turn||placements.some((p,j)=>p.turn!==s.observation.turn+j)||records[arm].has(s.sceneId))throw Error('公開局面・取得・完走・版・開始の不一致');
   const acquired=r.events.filter(e=>e.type==='acquire'),prefix=s.observation.owned;
   if(acquired.length<prefix.length+s.forcedChoice.length||prefix.some((c,j)=>String(acquired[j]?.card?.cardNo)!==String(c.cardNo))||s.forcedChoice.some((n,j)=>String(acquired[prefix.length+j]?.card?.cardNo)!==String(s.observation.candidates[n].cardNo)))throw Error('指定した取得が実行されていない');
   if(!Array.isArray(m.catalog)||m.catalog.length!==51)throw Error('公式全51カードのカタログが必要');
   const current=m.catalog.map(({cardNo,cardName,category,rarity,effect})=>({cardNo,cardName,category,rarity,effect}));
   if(catalog&&!same(catalog,current))throw Error('カタログ混在');catalog??=current;
   records[arm].set(s.sceneId,{score:r.result.score.displayScore,seed:m.seed});
  }
  sourceAudits.push({arm,file,sha256,n:250,offset});
 }
 if(records.reference.size!==750||records.target.size!==750)throw Error('全750の対応がそろっていない');
 const result={schema:'pro-paired-teachers-v1',train:[],validation:[],catalog,versions,counts:{trainRoots:500,validationRoots:250,continuations:1500},sources:sourceAudits,bankSha256:sha(bankBytes),continuationConfig:manifest.config,continuationActor:manifest.fingerprints.strategyVersion};
 for(const s of bank.scenes){const ref=records.reference.get(s.sceneId),target=records.target.get(s.sceneId);if(ref.seed!==target.seed)throw Error('2条件で継続シードが異なる');
  const publicRoot=prepared.reference.scenes.find(p=>p.sceneId===s.sceneId).observation;
  result[splits.get(s.sceneId)].push({sceneId:s.sceneId,observation:publicRoot,referenceIndices:s.referenceIndices,targetIndices:s.targetIndices,referenceScore:ref.score,targetScore:target.score});
 }
 return result;
}
async function main(){
 const [stage='paired-value-v1-teachers',output='solver/local-runs/pro-mean125/paired-value-v1']=process.argv.slice(2);
 if(!/^[a-z0-9-]+$/.test(stage))throw Error('stage');
 const manifestFile=`solver/local-runs/pro-mean125/${stage}/manifest.json`,manifest=JSON.parse(await readFile(manifestFile)),bankBytes=await readFile(manifest.bank.file),auditFile=path.join(path.dirname(manifest.bank.file),'audit.json'),auditBytes=await readFile(auditFile),audit=JSON.parse(auditBytes),donors=[];
 for(const s of audit.sourceAudits){const bytes=await readRunBytes(s.file);if(sha(bytes)!==s.sha256)throw Error('元ゲーム記録の変更');donors.push({...s,data:JSON.parse(bytes)});}
 const rebuilt=collectChoiceScenes(donors,{expectedSourceActor:audit.sourceActor});
 if(!same(rebuilt.bank,JSON.parse(bankBytes))||!same(rebuilt.audit.sceneAudit,audit.sceneAudit))throw Error('元記録から固定局面を再現できない');
 const runs=[];for(const arm of ['reference','target'])for(const file of manifest.runs.find(r=>r.id===arm).files){const bytes=await readRunBytes(file);runs.push({arm,file,sha256:sha(bytes),data:JSON.parse(bytes)});}
 const data=collectPairedValueRows({bankBytes,audit,manifest,runs});
 const modelBytes=await readFile(manifest.config.valueModelPath);if(sha(modelBytes)!==manifest.config.valueModelSha256)throw Error('継続モデルの変更');
 const rankBytes=await readFile('game/data/rankPro.csv');if('sha256:'+sha(rankBytes)!==data.versions[2]||'sha256:'+sha(await readFile('game/data/cards_pro.csv'))!==data.versions[1])throw Error('物理版と公式表の不一致');
 const lines=rankBytes.toString('utf8').trim().split(/\r?\n/),headers=lines.shift().replace(/^\uFEFF/,'').split(','),number=s=>s===''||s===undefined?null:Number(s);
 data.rankTable=lines.map(line=>{const v=line.split(','),r=Object.fromEntries(headers.map((h,i)=>[h,v[i]]));return {grade:r['ランク'],thresholds:{experience:number(r['体験基準']),enrollment:number(r['入塾基準']),satisfaction:number(r['満足基準']),accounting:number(r['経理基準'])},scores:{mobilization:number(r['動員スコア']),enrollmentDiff:number(r['入退差スコア']),satisfaction:number(r['満足スコア']),withdrawal:number(r['退塾スコア'])},enrollmentDiffThreshold:number(r['入退差基準']),withdrawalThreshold:number(r['退塾基準']),rankThreshold:number(r['ランク基準スコア'])};});
 data.createdAt=new Date().toISOString();data.provenance={manifestFile,manifestSha256:sha(await readFile(manifestFile)),sourceAuditSha256:sha(auditBytes),generatorSha256:sha(await readFile('solver/pro-paired-value-dataset.mjs')),allRootsAccepted:true,sourceSeedsDisjoint:true,rerolls:0,choiceScope:'取得全体。初回は2枚を変える場合がある。各時期は250未満。'};
 await mkdir(output,{recursive:true});const datasetBytes=Buffer.from(JSON.stringify(data)+'\n');await writeFile(path.join(output,'dataset.json'),datasetBytes);
 const report={...data,train:undefined,validation:undefined,catalog:undefined,rankTable:undefined,datasetSha256:sha(datasetBytes),purpose:'公式得点のコピーと対応監査のみ。得点差・特徴・学習・検証計算はブラウザ内。独立1500開始の到達検証ではない。'};
 await writeFile(path.join(output,'dataset-audit.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(data.counts));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e);process.exitCode=1;});
