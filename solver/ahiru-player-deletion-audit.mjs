#!/usr/bin/env node
/** 過去ログの実取得/実削除と報告方針を照合する。ゲームの判断・投影は実行しない。 */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {auditAhiruBatch} from './ahiru-pro-metrics.mjs';
import {readRunBytes} from './pro-strategy-metrics.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const no=c=>{const n=Number(c?.cardNo);assert(Number.isInteger(n)&&n>=1&&n<=51,'実カード番号が必要');return n;};
const basic=c=>c.rarity==='N'&&no(c)<=5;
const counts=cards=>[...cards.reduce((m,c)=>m.set(no(c),(m.get(no(c))||0)+1),new Map())].sort((a,b)=>a[0]-b[0]);

export function auditPlayerDeletionRecord(record){
 const owned=new Map(),before=new Map(),actual=new Map(),decisions=new Map(),initial=[];
 let removedBasics=0,removedOthers=0,accountingDeleted=false;
 for(const event of record.events){
  if(event.type==='acquire'){
   const c=event.card;no(c);assert(c.instanceId&&!owned.has(c.instanceId),'実取得の個体が必要');owned.set(c.instanceId,c);
   if(event.phase==='start'&&basic(c))initial.push(no(c));
  }else if(event.type==='delete'){
   const c=event.card,saved=owned.get(c?.instanceId);assert(saved&&no(saved)===no(c),'実削除の所有個体が不一致');
   if(!before.has(event.turn))before.set(event.turn,[...owned.values()]);
   if(!actual.has(event.turn))actual.set(event.turn,[]);actual.get(event.turn).push(no(c));
   assert(event.turn<7,'最終会議では削除しない');
   if([...owned.values()].some(basic))assert(basic(c),'基本が残る間に基本以外を実削除した');
   if(event.turn===0)assert(![4,5].includes(no(c)),'初回に面談/経理基本を削除した');
   if(event.turn===1)assert(no(c)!==5,'2ターン目までに経理基本を削除した');
   if(basic(c))removedBasics++;else removedOthers++;
   if(no(c)===5)accountingDeleted=true;
   owned.delete(c.instanceId);
  }else if(event.type==='research-deletion-decision'){
   assert(!decisions.has(event.turn),'同じ会議の削除判断が重複');decisions.set(event.turn,event);
   const actualNos=actual.get(event.turn)||[];
   assert.deepEqual(event.decisions.map(d=>no(d)),actualNos,'宣言した削除と実削除が不一致');
   assert(actualNos.length<=event.deleteMax,'削除枠を超過');
   assert.deepEqual(counts(before.get(event.turn)||[...owned.values()]),counts(event.observation.owned),'削除前の公開デッキと実所有札が不一致');
   for(const d of event.decisions.filter(d=>no(d)===5))assert(event.turn>=2&&event.observation.stats.accounting>=15&&Number.isFinite(d.after?.accounting)&&d.after.accounting>=15,'経理基本を消した時の現在値/記録された公開投影が不足');
  }
 }
 assert.deepEqual(initial.sort((a,b)=>a-b),[1,2,3,4,5],'初期基本5枚が不一致');
 assert.equal(actual.get(0)?.[0],3,'初回の実削除は質問対応');assert.equal(actual.get(1)?.[0],4,'2ターン目の実削除は生徒面談');
 assert([...actual.keys()].every(t=>decisions.has(t)),'実削除と判断の対応がない');
 assert.deepEqual(counts([...owned.values()]),counts(record.result.finalDeck),'実取得/削除の追跡と最終デッキが不一致');
 return {removedBasics,removedOthers,accountingDeleted,allBasicsRemoved:![...owned.values()].some(basic),firstQuestion:true,secondMeeting:true};
}

async function main(){
 const [manifestFile,output]=process.argv.slice(2);if(!manifestFile||!output)throw Error('全開始のmanifestと出力先が必要');
 const manifestBytes=await readFile(manifestFile),manifest=JSON.parse(manifestBytes),groups={},audit=[];
 for(const run of manifest.runs){
  assert([250,1000].includes(manifest.n)&&run.files.length===manifest.n/250,'各条件の全バッチが必要');
  let records=[];
  for(let b=0;b<run.files.length;b++){
   const bytes=await readRunBytes(run.files[b]),rs=auditAhiruBatch(JSON.parse(bytes),{seed:manifest.seed,offset:b*250,config:run.config,fingerprints:manifest.fingerprints});
   records.push(...rs);audit.push({id:run.id,file:run.files[b],sha256:sha(bytes),n:rs.length});
  }
  if(run.config.deletion!=='player-basic'){groups[run.id]={games:records.length,reportedPolicy:false};continue;}
  const checks=records.map(auditPlayerDeletionRecord);
  groups[run.id]={games:checks.length,reportedPolicy:true,allRealDeletionsChecked:true,firstQuestionGames:checks.filter(c=>c.firstQuestion).length,secondMeetingGames:checks.filter(c=>c.secondMeeting).length,allBasicsRemovedGames:checks.filter(c=>c.allBasicsRemoved).length,accountingDeletedGames:checks.filter(c=>c.accountingDeleted).length,gamesWithNonbasicDeletionAfterAllBasics:checks.filter(c=>c.removedOthers>0).length,deletedBasicCards:checks.reduce((s,c)=>s+c.removedBasics,0),deletedOtherCards:checks.reduce((s,c)=>s+c.removedOthers,0)};
 }
 await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify({createdAt:new Date().toISOString(),purpose:'宣言した方針が全開始の実削除で動作したかの照合。新しい判断・ゲーム反復・投影は実行しない。',manifestFile,manifestSha256:sha(manifestBytes),auditorSha256:sha(await readFile('solver/ahiru-player-deletion-audit.mjs')),groups,audit},null,2)+'\n');
 console.log(JSON.stringify(groups,null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e);process.exitCode=1;});
