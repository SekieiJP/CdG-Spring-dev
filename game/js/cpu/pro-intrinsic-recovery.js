/** 分析専用。カテゴリ名と、条件・コストを満たす直接の回復効果を区別する。 */
const KEYS=['experience','enrollment','satisfaction','accounting'],SLOTS=['leader','teacher','staff'];
export function createIntrinsicRecoveryCheck(parser){
 const parsed=new Map();
 return (card,status,observation,target,forecast=observation.stats)=>{
  if(!KEYS.includes(status)||!Number.isFinite(target))throw Error('回復対象が不正');
  if(!parsed.has(card.effect))parsed.set(card.effect,parser.parseEffect(card.effect));
  const effect=parsed.get(card.effect),slots=effect.staffRestrictions.length?effect.staffRestrictions:SLOTS;
  const contexts=[observation.stats,forecast].map(s=>Object.fromEntries(KEYS.map(k=>[k,s[k]])));
  for(let turn=observation.turn;turn<observation.totalTurns;turn++)for(const stats of contexts)for(const slot of slots){
   const state={turn,totalTurns:observation.totalTurns,player:stats};
   // おすすめボーナスだけでカテゴリを回復役とは判定しない。
   const out=parser.simulateCardEffect(card,slot,stats,null,state);
   if(!out.applied||out.afterStats[status]<=stats[status])continue;
   const relevant=parser.getApplicableEffects(effect,slot,stats,state).filter(e=>e.status===status&&['change','set'].includes(e.type));
   const last=relevant.at(-1);
   // 経理14など、必要な値未満に固定する効果は、その値を越す回復役に数えない。
   if(last?.type==='set'&&last.value<target)continue;
   if(relevant.some(e=>e.type==='change'&&e.value>0||e.type==='set'&&e.value>=target))return true;
  }
  return false;
 };
}
