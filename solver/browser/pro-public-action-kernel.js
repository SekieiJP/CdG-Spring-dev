/** PROの仮想状態専用。公開効果の適用だけを行い、本体の記録・描画・乱数を利用しない。 */
const KEYS=['experience','enrollment','satisfaction','accounting'];
export function createPublicActionKernel(turns,parser){
 const parse=parser.parseEffect.bind(parser),parsed=new Map();
 parser.parseEffect=effect=>{if(!parsed.has(effect))parsed.set(effect,parse(effect));return parsed.get(effect);};
 return (card,slot,state)=>{
  const config=turns[state.turn],before={...state.player},recommended=card.category===config.recommended?config.recommendedStatus:null;
  const result=parser.simulateCardEffect(card,slot,before,recommended,state);
  if(!result.applied)return {applied:false};
  const effects=parser.getApplicableEffects(parser.parseEffect(card.effect),slot,before,state);
  for(const key of KEYS)state.player[key]=result.afterStats[key];
  for(const effect of effects)if(effect.type==='token')state.tokens[effect.token]=(state.tokens[effect.token]||0)+1;
  return {applied:true};
 };
}
