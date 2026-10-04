import {remainingTrainingNames} from './pro-learned-research.js';
/** 研究用。初回の公開状態に限り、ブラウザで作った推定値表を参照する。 */
export const OPENING_TABLE_SCHEMA='pro-initial-pair-value-v1';
const KEYS=['experience','enrollment','satisfaction','accounting'];
const TOKENS=['passion','fatigue','inspiration','organize'];
const key=(pair,remaining)=>`${remaining}:${[...pair].sort((a,b)=>a-b).join(',')}`;
const pairs=names=>names.flatMap((a,i)=>names.slice(i+1).map(b=>[a,b]));
export function validateOpeningTable(table,catalog){
 if(table.schema!==OPENING_TABLE_SCHEMA||table.estimated!==true)throw Error('初回推定表の形式が不正');
 const names=catalog.filter(c=>c.rarity==='R').map(c=>Number(c.cardNo)).sort((a,b)=>a-b);
 if(names.length<4||new Set(names).size!==names.length||JSON.stringify(names)!==JSON.stringify(table.cardNos))throw Error('初回推定表と公開Rカタログが異なる');
 if(!table.initial||table.initial.totalTurns!==8||KEYS.some(k=>!Number.isFinite(table.initial.stats[k]))||JSON.stringify(table.initial.basicNos)!=='[1,2,3,4,5]')throw Error('初回状態が不正');
 if(!Array.isArray(table.rows)||table.rows.length!==pairs(names).length*3)throw Error('各ペアと残り0〜2回の推定値が必要');
 const lookup=new Map();
 for(const r of table.rows){
  if(!Array.isArray(r.pair)||r.pair.length!==2||r.pair[0]>=r.pair[1]||r.pair.some(n=>!names.includes(n))||![0,1,2].includes(r.remaining)||!Number.isFinite(r.score))throw Error('初回推定表の行が不正');
  const k=key(r.pair,r.remaining);if(lookup.has(k))throw Error('初回推定表の重複');lookup.set(k,r.score);
 }
 return lookup;
}
export function createOpeningTablePolicy({table,catalog,refreshCost=0}){
 const lookup=validateOpeningTable(table,catalog),known=new Set(table.cardNos);
 if(!Number.isFinite(refreshCost)||refreshCost<0)throw Error('初回リフレッシュ費用は非負');
 function supports(o){
  return o.difficulty==='pro'&&o.mode==='normal'&&o.turn===0&&o.totalTurns===table.initial.totalTurns&&o.pickCount===2&&!o.allowSkip&&
   [0,1,2].includes(o.refreshRemaining)&&KEYS.every(k=>o.stats[k]===table.initial.stats[k])&&TOKENS.every(k=>(o.tokens[k]||0)===0)&&
   o.owned.length===5&&JSON.stringify(o.owned.map(c=>Number(c.cardNo)).sort((a,b)=>a-b))===JSON.stringify(table.initial.basicNos)&&
   o.candidates.length===4&&new Set(o.candidates.map(c=>Number(c.cardNo))).size===4&&o.candidates.every(c=>c.rarity==='R'&&known.has(Number(c.cardNo)))&&
   (o.offerHistory||[]).every(e=>['offer','refresh'].includes(e.type)&&(e.cards||[]).every(c=>known.has(Number(c.cardNo))));
 }
 function acquisition(o){
  if(!supports(o))return null;
  const evaluations=pairs(o.candidates.map((_,i)=>i)).map(indices=>({indices,score:lookup.get(key(indices.map(i=>Number(o.candidates[i].cardNo)),o.refreshRemaining)),estimated:true}));
  evaluations.sort((a,b)=>b.score-a.score||a.indices[0]-b.indices[0]||a.indices[1]-b.indices[1]);
  return {version:OPENING_TABLE_SCHEMA,mode:'opening-table',estimated:true,evaluations,recommended:evaluations[0]};
 }
 function refresh(o){
  const current=acquisition(o);if(!current)return null;
  if(o.refreshRemaining===0)return {shouldRefresh:false,reason:'no-remaining',currentScore:current.recommended.score,estimated:true};
  const history=[...(o.offerHistory||[]),{type:'refresh',cards:o.candidates.map(c=>({cardNo:c.cardNo}))}];
  const pool=remainingTrainingNames(catalog,history,'R').map(c=>Number(c.cardNo));
  // 初回は異なる4種類。途中再充填が必要な状態は既存方式へ委ねる。
  if(pool.length<4)return null;
  let total=0,combinations=0;
  function visit(chosen,next){
   if(chosen.length===4){total+=Math.max(...pairs(chosen).map(p=>lookup.get(key(p,o.refreshRemaining-1))));combinations++;return;}
   for(let i=next;i<=pool.length-(4-chosen.length);i++)visit([...chosen,pool[i]],i+1);
  }
  visit([],0);
  const expectedScore=total/combinations,currentScore=current.recommended.score;
  return {shouldRefresh:expectedScore-currentScore>refreshCost,currentScore,expectedScore,gain:expectedScore-currentScore,opportunityCost:refreshCost,poolCount:pool.length,combinations,estimated:true,
   method:'公開された残りR種類から異なる4候補を列挙。残り回数を1減らした同じ推定表で評価。'};
 }
 return {supports,acquisition,refresh};
}
/** evaluateは公開情報だけのブラウザ内先読み。仮想世界数を実ゲーム数と数えない。 */
export function openingPairJobs(cardNos){return [0,1,2].flatMap(remaining=>pairs([...cardNos].sort((a,b)=>a-b)).map(pair=>({pair,remaining})));}
