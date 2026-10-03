import {encodeValueFeatures,predictValue,publicValueObservation} from './pro-value-model.js';
/** 学習済みの固定木を計算する研究用の判断。未来ゲームの反復は行わない。 */
const KEYS=['experience','enrollment','satisfaction','accounting'],SLOTS=['leader','teacher','staff'];
export function createLearnedPolicy({baseline,score,cloneState,resolve,enumerateOptions,model,config={}}){
 const settings={blend:.005,beam:72,minDeleteGain:.01,...config.learned},cache=new Map();
 function estimate(observation,phase){
  const key=JSON.stringify([phase,observation.turn,KEYS.map(k=>observation.stats[k]),observation.tokens,observation.owned.map(c=>c.cardNo).sort((a,b)=>a-b),observation.refreshRemaining,observation.offerHistory]);
  if(!cache.has(key)){if(cache.size>40000)cache.clear();cache.set(key,predictValue(model,encodeValueFeatures(observation,phase,{forecast:baseline.forecast,score})));}return cache.get(key);
 }
 function acquisition(observation){
  const root=publicValueObservation(observation),candidates=observation.candidates,n=candidates.length,indices=[];
  if(observation.pickCount===2)for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)indices.push([i,j]);else for(let i=0;i<n;i++)indices.push([i]);if(observation.allowSkip)indices.push([]);
  const formula=baseline.acquisition(observation,'engine'),lookup=new Map(formula.evaluations.map(e=>[e.indices.join(','),e]));
  const choices=indices.map(chosen=>{const next={...root,owned:[...root.owned,...chosen.map(i=>candidates[i])],tokens:{...root.tokens,inspiration:Math.max(0,root.tokens.inspiration-Number(observation.allowSkip))}},value=estimate(next,'acquisition'),reference=lookup.get(chosen.join(','));
   return {indices:chosen,score:value+settings.blend*reference.score,predictedScore:value,formulaGain:reference.score,forecast:reference.forecast};});
  choices.sort((a,b)=>b.score-a.score||a.indices.length-b.indices.length||String(a.indices).localeCompare(String(b.indices)));
  return {version:'pro-learned-value-v1',mode:'learned',evaluations:choices,recommended:choices[0]};
 }
 function placements(observation,hand,state){
  const root=publicValueObservation(observation),remaining=root.totalTurns-root.turn;
  if(remaining<=1)return baseline.placements(root,hand,state,'engine',180,true);
  const future=baseline.forecast({...root,turn:root.turn+1},root.owned,'engine').end,growth=Object.fromEntries(KEYS.map(k=>[k,Math.max(0,future[k]-root.stats[k])]));
  function evaluate(next){
   const after={...root,stats:Object.fromEntries(KEYS.map(k=>[k,next.player[k]])),tokens:{...next.tokens}},end=Object.fromEntries(KEYS.map(k=>[k,Math.max(0,next.player[k]+growth[k])]));end.enrollment=Math.min(end.enrollment,end.experience);
   const tie=baseline.value(end,root,'engine')+12*(Math.min(root.owned.length,Math.max(0,4+next.tokens.passion-next.tokens.fatigue))-4)+8*next.tokens.inspiration+Math.min(4,(remaining-1)*1.3)*next.tokens.organize;
   return estimate(after,'after-action')+(settings.placementBlend??settings.blend)*tie+tie*.000001;
  }
  let frontier=[{state:cloneState(state),counts:{leader:0,teacher:0,staff:0},used:0n,seq:[]}];frontier[0].value=evaluate(frontier[0].state);
  for(let depth=0;depth<Math.min(hand.length,16);depth++){
   const expanded=[...frontier],seen=new Set();
   for(const node of frontier)for(const opt of enumerateOptions(hand,node.counts)){
    if(node.used&(1n<<BigInt(opt.cardIndex))||SLOTS.slice(SLOTS.indexOf(opt.slot)+1).some(s=>node.counts[s]>0))continue;
    const next=cloneState(node.state);if(!resolve(opt.card,opt.slot,next).applied)continue;
    const used=node.used|(1n<<BigInt(opt.cardIndex)),counts={...node.counts,[opt.slot]:node.counts[opt.slot]+1},key=JSON.stringify([used.toString(),counts,next.player,next.tokens]);
    if(seen.has(key))continue;seen.add(key);expanded.push({state:next,used,counts,seq:[...node.seq,{cardIndex:opt.cardIndex,slot:opt.slot}],value:evaluate(next)});
   }
   expanded.sort((a,b)=>b.value-a.value||a.seq.length-b.seq.length);frontier=expanded.slice(0,settings.beam);
  }
  const alternatives=[frontier[0]];
  for(const mode of ['engine','median','myopic']){const seq=baseline.placements(root,hand,state,mode,180,true),next=cloneState(state);for(const p of seq)resolve(hand[p.cardIndex],p.slot,next);alternatives.push({seq,value:evaluate(next)});}
  alternatives.sort((a,b)=>b.value-a.value||a.seq.length-b.seq.length);return alternatives[0]?.seq||[];
 }
 function deletions(observation,max){
  const root=publicValueObservation(observation);if(root.turn>=root.totalTurns-1)return [];
  const next={...root,turn:root.turn+1,tokens:{...root.tokens,organize:0}},decisions=[];let owned=[...root.owned];
  const utility=cards=>{const o={...next,owned:cards},f=baseline.forecast(o,cards,'engine');return estimate(o,'before-training')+settings.blend*(baseline.value(f.end,o,'engine')+f.engine*8-f.risk*.8);};
  for(let k=0;k<max&&owned.length>5;k++){
   const current=utility(owned),options=owned.map((c,i)=>{const after=[...owned];after.splice(i,1);return {index:i,cardNo:c.cardNo,score:utility(after)};}).sort((a,b)=>b.score-a.score||a.index-b.index),best=options[0];
   if(!best||best.score-current<=settings.minDeleteGain)break;decisions.push({...best,gain:best.score-current});owned.splice(best.index,1);
  }
  return decisions;
 }
 return {acquisition,placements,deletions,estimate,settings};
}
