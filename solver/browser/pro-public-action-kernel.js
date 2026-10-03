/** PROの仮想状態専用。公開効果の適用だけを行い、本体の記録・描画・乱数を利用しない。 */
const KEYS=['experience','enrollment','satisfaction','accounting'],TOKENS=['passion','fatigue','inspiration','organize'];
export function createPublicActionKernel(turns,parser,{cacheSize=60000}={}){
 if(!Number.isInteger(cacheSize)||cacheSize<0||cacheSize>100000)throw Error('仮想効果キャッシュは0〜100000件');
 const parse=parser.parseEffect.bind(parser),parsed=new Map(),memo=new Map();
 parser.parseEffect=effect=>{if(!parsed.has(effect))parsed.set(effect,parse(effect));return parsed.get(effect);};
 return (card,slot,state)=>{
  const key=cacheSize?JSON.stringify([state.turn,state.totalTurns,card.cardNo,card.category,card.effect,slot,...KEYS.map(k=>state.player[k]),...TOKENS.map(k=>state.tokens[k]||0)]):null;
  let result=key?memo.get(key):null;
  if(!result){
   const config=turns[state.turn],before=Object.fromEntries(KEYS.map(k=>[k,state.player[k]])),recommended=card.category===config.recommended?config.recommendedStatus:null;
   const applied=parser.simulateCardEffect(card,slot,before,recommended,state);
   result={applied:applied.applied};
   if(applied.applied){const effects=parser.getApplicableEffects(parser.parseEffect(card.effect),slot,before,state),tokens=Object.fromEntries(TOKENS.map(k=>[k,state.tokens[k]||0]));
    for(const effect of effects)if(effect.type==='token')tokens[effect.token]=(tokens[effect.token]||0)+1;
    result={applied:true,stats:applied.afterStats,tokens};
   }
   if(key){if(memo.size>=cacheSize)memo.clear();memo.set(key,result);}
  }
  if(result.applied){for(const key of KEYS)state.player[key]=result.stats[key];for(const key of TOKENS)state.tokens[key]=result.tokens[key];}
  return {applied:result.applied};
 };
}
