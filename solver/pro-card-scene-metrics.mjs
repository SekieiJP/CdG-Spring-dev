#!/usr/bin/env node
/** 公開局面から完走した2群の記録を集計する。カード選択やゲーム操作は行わない。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {compactRecord,readRunBytes,summarizeOutcomes,pairedOutcomes} from './pro-strategy-metrics.mjs';
import {meanInterval,observedCards} from './pro-mean125-metrics.mjs';

const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const policy=m=>JSON.stringify({research:m.research,acquisitionModel:m.acquisitionModel??null,
 acquisitionAblation:m.acquisitionAblation??null,continuationPolicy:m.continuationPolicy??null,
 refreshPolicy:m.refreshPolicy??null,refreshModel:m.refreshModel??null});
const version=m=>JSON.stringify([m.provenance?.strategyVersion,m.provenance?.codeHash,m.cardVersion,m.rankVersion]);
function continuationRecord(record){
 const start=record.events.find(e=>e.type==='research-counterfactual-start');
 if(!start||createHash('sha256').update(JSON.stringify(start.observation)).digest('hex')!==record.metadata.sceneObservationSha256||JSON.stringify(start.forcedChoice)!==JSON.stringify(record.metadata.forcedChoice))throw Error('公開局面の開始記録が一致しない');
 const owned=start.observation.owned;let restored=0;
 const events=record.events.filter(e=>{if(e.type!=='acquire'||restored>=owned.length)return true;
  if(String(e.card.cardNo)!==String(owned[restored].cardNo))throw Error('復元した所持札が一致しない');restored++;return false;});
 if(restored!==owned.length)throw Error('所持札の復元記録が不足');
 if(record.metadata.sceneKind==='meeting'){
  const instruction=record.metadata.forcedMeeting,e=events.find(e=>e.type==='research-meeting-intervention');
  if(!instruction||!e||JSON.stringify(e.instruction)!==JSON.stringify(instruction)||instruction.deleteMax<1||
   Number(owned[instruction.ownedIndex]?.cardNo)!==instruction.cardNo||
   instruction.action!==(record.metadata.sceneArm==='target'?'delete':'keep'))throw Error('会議での保持・削除指定が一致しない');
  const until=events.indexOf(e),deletes=events.slice(0,until).filter(e=>e.type==='delete');
  if(instruction.action==='delete'?(deletes.length!==1||Number(deletes[0].card.cardNo)!==instruction.cardNo||Number(e.removedCardNo)!==instruction.cardNo):
   (deletes.length!==0||e.removedCardNo!==null))throw Error('指定した会議の1枚だけの削除・保持でない');
 }
 const actual=events.filter(e=>e.type==='acquire').slice(0,start.forcedChoice.length);
 if(actual.length!==start.forcedChoice.length||actual.some((e,i)=>String(e.card.cardNo)!==String(start.observation.candidates[start.forcedChoice[i]].cardNo)))throw Error('強制取得と実際の取得が一致しない');
 return {...record,events};
}
function continuationCards(records){
 const rows=observedCards(records.map(continuationRecord));
 return rows.map(row=>({...row,gamesOwnedInitially:records.filter(r=>r.events.find(e=>e.type==='research-counterfactual-start').observation.owned.some(c=>String(c.cardNo)===row.cardNo)).length,
  scope:'局面復元後の新規取得・ドロー・配置・解決。復元した所持札を新規取得に数えない。直接解決には元から保有した同Noも含む。'}));
}

function arm(records,name,minimumSeeds){
 if(records.length<minimumSeeds)throw Error(`各群で最低${minimumSeeds}局面が必要`);
 if(new Set(records.map(r=>r.metadata?.sceneId)).size!==records.length)throw Error('局面IDの欠落・重複');
 for(const r of records){const m=r.metadata;
  if(m?.source!=='counterfactual'||m.reroll||m.research?.initial||m.sceneArm!==name||!m.sceneId||
   !/^[a-f0-9]{64}$/.test(m.sceneBankSha256||'')||!/^[a-f0-9]{64}$/.test(m.sceneObservationSha256||'')||
   !Number.isInteger(m.sceneTurn)||m.sceneTurn<0||m.sceneTurn>7||!Array.isArray(m.forcedChoice))throw Error('局面対照試験の記録が不正');
 }
 if(new Set(records.map(r=>r.metadata.sceneBankSha256)).size!==1||new Set(records.map(r=>policy(r.metadata))).size!==1||
  new Set(records.map(r=>version(r.metadata))).size!==1||new Set(records.map(r=>r.metadata.sceneKind||'acquisition')).size!==1)throw Error('局面集・後続方略・版の混在');
 // 先頭の強制取得は局面ごとに異なる。同じ選択規則と後続方略であることを上で検査する。
 const outcomes=records.map(r=>({...compactRecord(continuationRecord(r)),policy:policy(r.metadata)+name}));
 return {outcomes,summary:{...summarizeOutcomes(outcomes,{minimumSeeds}),mean95:meanInterval(outcomes.map(r=>r.score))}};
}
export function compareSceneArms(reference,target,{minimumSeeds=250}={}){
 const a=arm(reference,'reference',minimumSeeds),b=arm(target,'target',minimumSeeds);
 if(reference.length!==target.length)throw Error('2群の局面数が異なる');
 const bySeed=new Map(reference.map(r=>[r.metadata.seed,r]));
 if(bySeed.size!==reference.length)throw Error('参照群のシード重複');
 const pairs=target.map(r=>{const old=bySeed.get(r.metadata.seed),m=r.metadata,n=old?.metadata;
  if(!old||m.sceneId!==n.sceneId||m.sceneTurn!==n.sceneTurn||m.sceneBankSha256!==n.sceneBankSha256||
   m.sceneObservationSha256!==n.sceneObservationSha256||policy(m)!==policy(n)||version(m)!==version(n)||
   (m.sceneKind||'acquisition')!==(n.sceneKind||'acquisition')||m.sceneKind==='meeting'&&
   (m.forcedMeeting.ownedIndex!==n.forcedMeeting.ownedIndex||m.forcedMeeting.cardNo!==n.forcedMeeting.cardNo||m.forcedMeeting.deleteMax!==n.forcedMeeting.deleteMax))throw Error('同一公開局面・同一未来シード・同一後続方略の対でない');
  return [old,r];});
 const changes=predicate=>pairs.map(([x,y])=>Number(predicate(y.result.score))-Number(predicate(x.result.score)));
 const delta=predicate=>{const values=changes(predicate);return {mean:mean(values),interval95:meanInterval(values)};};
 const byTurn={};for(const turn of [...new Set(reference.map(r=>r.metadata.sceneTurn))].sort((x,y)=>x-y)){
  const ar=a.outcomes.filter((_,i)=>reference[i].metadata.sceneTurn===turn),br=b.outcomes.filter((_,i)=>target[i].metadata.sceneTurn===turn);
  byTurn[turn+1]=ar.length>=minimumSeeds?{n:ar.length,...pairedOutcomes(ar,br,{minimumSeeds})}:{n:ar.length,trendSupported:false};
 }
 return {schema:1,n:pairs.length,reference:a.summary,target:b.summary,
  comparison:pairedOutcomes(a.outcomes,b.outcomes,{minimumSeeds}),
  score14RateDifference:delta(s=>s.displayScore>=14),below8RateDifference:delta(s=>s.displayScore<8),
  withdrawalRateDifference:delta(s=>s.withdrawal>0),byTurn,
  referenceCards:continuationCards(reference),targetCards:continuationCards(target),activityScope:'局面の復元後。元の所持札を追加した復元イベントを新規取得から除外する。',
  intervention:reference[0].metadata.sceneKind==='meeting'?'target=対象1枚を合法削除、reference=保持。この会議の他の削除は両群で固定。その後は同じ方略。':'target=対象取得、reference=同じ提示の別札取得。その後は同じ方略。',
  interpretation:'指定方略の公開局面分布に対する取得または保持/削除変更の完走対照試験。開始からの平均12.5達成の検証や全デッキでのカード優劣ではない。時期・相性の細分は250局面未満なら傾向と扱わない。'};
}
async function main(){
 const [manifestFile,outFile]=process.argv.slice(2);if(!manifestFile||!outFile)throw Error('manifest output-file が必要');
 const manifest=JSON.parse(await readFile(manifestFile,'utf8')),groups={},audit=[];
 for(const run of manifest.runs){const records=[];for(const file of run.files){const bytes=await readRunBytes(file),d=JSON.parse(bytes);
  if(d.simulations?.length!==1)throw Error('1ファイル1方略が必要');
  records.push(...d.simulations[0].playRecords);audit.push({id:run.id,file,sha256:createHash('sha256').update(bytes).digest('hex')});}
  groups[run.id]=records;}
 const result={generatedAt:new Date().toISOString(),manifest,audit,comparisons:{}};
 for(const c of manifest.comparisons)result.comparisons[c.id]=compareSceneArms(groups[c.before],groups[c.after]);
 await mkdir(path.dirname(outFile),{recursive:true});await writeFile(outFile,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(Object.fromEntries(Object.entries(result.comparisons).map(([id,r])=>[id,{n:r.n,reference:r.reference.mean,target:r.target.mean,comparison:r.comparison,byTurn:r.byTurn}]))));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e);process.exitCode=1;});
