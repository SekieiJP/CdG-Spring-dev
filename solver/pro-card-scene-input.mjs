import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
/** 判断時に公開される項目だけを取り出す。元記録のシードや結果は渡さない。 */
export function publicScene(ob){
 const card=c=>({cardNo:c.cardNo,cardName:c.cardName,rarity:c.rarity,category:c.category,effect:c.effect});
 return {
  schema:ob.schema,difficulty:ob.difficulty,mode:ob.mode,turn:ob.turn,totalTurns:ob.totalTurns,
  stats:Object.fromEntries(['experience','enrollment','satisfaction','accounting'].map(k=>[k,ob.stats[k]])),
  tokens:Object.fromEntries(['passion','fatigue','inspiration','organize'].map(k=>[k,ob.tokens[k]])),
  owned:ob.owned.map(c=>({...card(c),acquiredTurn:c.acquiredTurn})),
  candidates:ob.candidates.map(card),pickCount:ob.pickCount,allowSkip:ob.allowSkip,
  turns:ob.turns.map(t=>({recommended:t.recommended,recommendedStatus:t.recommendedStatus,training:t.training,deletion:t.deletion})),
  offerHistory:ob.offerHistory.map(e=>({type:e.type,turn:e.turn,rarity:e.rarity,cards:e.cards.map(card)})),
  refreshRemaining:ob.refreshRemaining
 };
}

/** 局面・強制選択の実験入力を検査し、公開項目だけをブラウザへ渡す。 */
export function prepareSceneBatch(bytes,arm,{episodes,offset=0,versions}){
 const bank=JSON.parse(bytes);
 if(bank.kind==='meeting')return prepareMeetingSceneBatch(bytes,arm,{episodes,offset,versions});
 if(!['target','reference'].includes(arm)||!Number.isInteger(episodes)||episodes<1||!Number.isInteger(offset)||offset<0||
  !Array.isArray(bank.scenes)||bank.scenes.length<250||episodes+offset>bank.scenes.length||
  new Set(bank.scenes.map(s=>s.sceneId)).size!==bank.scenes.length||JSON.stringify(bank.versions)!==JSON.stringify(versions)||
  !Number.isInteger(bank.cardNo)||bank.cardNo<6||bank.cardNo>51)throw Error('局面集・版・実行範囲が不正');
 const scenes=bank.scenes.map(s=>{
  const o=publicScene(s.observation),target=s.targetIndices,reference=s.referenceIndices;
  const valid=indices=>Array.isArray(indices)&&indices.length===o.pickCount&&new Set(indices).size===indices.length&&indices.every(i=>Number.isInteger(i)&&i>=0&&o.candidates[i]);
  if(typeof s.sceneId!=='string'||!s.sceneId||o.difficulty!=='pro'||o.mode!=='normal'||o.totalTurns!==8||
   !Number.isInteger(o.turn)||o.turn<0||o.turn>7||o.pickCount!==1||o.allowSkip||o.turns.length!==8||
   !Object.values(o.stats).every(Number.isFinite)||!Object.values(o.tokens).every(v=>Number.isInteger(v)&&v>=0)||
   !Number.isInteger(o.refreshRemaining)||o.refreshRemaining<0||!valid(target)||!valid(reference)||
   !target.some(i=>Number(o.candidates[i].cardNo)===bank.cardNo)||reference.some(i=>Number(o.candidates[i].cardNo)===bank.cardNo))throw Error('公開局面と2群の取得指定が不正');
  return {sceneId:s.sceneId,observation:o,observationSha256:sha(JSON.stringify(o)),forcedChoice:[...(arm==='target'?target:reference)]};
 });
 return {cardNo:bank.cardNo,sha256:sha(bytes),arm,scenes};
}


/** 会議で対象の1枚だけを残す/削除する。残りの削除枠は両群で使わない。 */
export function prepareMeetingSceneBatch(bytes,arm,{episodes,offset=0,versions}){
 const bank=JSON.parse(bytes);
 if(bank.kind!=='meeting'||!['target','reference'].includes(arm)||!Number.isInteger(episodes)||episodes<1||
  !Number.isInteger(offset)||offset<0||!Array.isArray(bank.scenes)||bank.scenes.length<250||
  episodes+offset>bank.scenes.length||new Set(bank.scenes.map(s=>s.sceneId)).size!==bank.scenes.length||
  JSON.stringify(bank.versions)!==JSON.stringify(versions)||!Number.isInteger(bank.cardNo)||bank.cardNo<1||bank.cardNo>51)
  throw Error('会議局面集・版・実行範囲が不正');
 const scenes=bank.scenes.map(s=>{
  const o=publicScene(s.observation),index=s.targetOwnedIndex;
  if(typeof s.sceneId!=='string'||!s.sceneId||o.difficulty!=='pro'||o.mode!=='normal'||o.totalTurns!==8||
   !Number.isInteger(o.turn)||o.turn<0||o.turn>6||o.pickCount!==0||o.allowSkip||o.candidates.length||o.turns.length!==8||
   !Object.values(o.stats).every(Number.isFinite)||!Object.values(o.tokens).every(v=>Number.isInteger(v)&&v>=0)||
   !Number.isInteger(o.refreshRemaining)||o.refreshRemaining<0||!Number.isInteger(index)||index<0||
   Number(o.owned[index]?.cardNo)!==bank.cardNo||!Number.isInteger(s.deleteMax)||s.deleteMax<1||
   s.deleteMax!==o.turns[o.turn].deletion+o.tokens.organize)
   throw Error('会議の公開状態・対象札・合法削除枠が不正');
  return {kind:'meeting',sceneId:s.sceneId,observation:o,observationSha256:sha(JSON.stringify(o)),forcedChoice:[],
   forcedMeeting:{ownedIndex:index,cardNo:bank.cardNo,deleteMax:s.deleteMax,action:arm==='target'?'delete':'keep'}};
 });
 return {kind:'meeting',cardNo:bank.cardNo,sha256:sha(bytes),arm,scenes};
}
