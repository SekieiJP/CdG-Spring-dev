/** 研究専用。公開情報から独立した仮想将来をブラウザ内で生成する。実ゲームのseed・山札を読まない。 */
export const RISK_VERSION='pro-public-rollout-v3';
const KEYS=['experience','enrollment','satisfaction','accounting'],SLOTS=['leader','teacher','staff'];
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
function rng(text){let n=2166136261;for(const c of text)n=Math.imul(n^c.charCodeAt(0),16777619);return()=>{n^=n<<13;n^=n>>>17;n^=n<<5;return(n>>>0)/4294967296;};}
export function publicDraw(cards,count,world,turn,salt='pro-risk-v1',method='legacy'){
 const random=rng(`${salt}:hand:${world}:${turn}`),ordered=[...cards].sort((a,b)=>Number(a.cardNo)-Number(b.cardNo));
 const copies=new Map();
 return ordered.map((card,i)=>{const no=String(card.cardNo),copy=copies.get(no)||0;copies.set(no,copy+1);let order=random();if(method==='keyed'){const keyed=rng(`${salt}:hand:${world}:${turn}:${no}:${copy}`);keyed();keyed();order=keyed();}return {card,order,i};}).sort((a,b)=>a.order-b.order||a.i-b.i).slice(0,Math.max(0,count)).map(x=>x.card);
}
export function createRiskPolicy({baseline,score:sourceScore,cloneState,resolve,enumerateOptions,catalog=[],config={},refreshAdvice=null}){
 const cfg={worlds:16,realBeam:96,rolloutBeam:8,actionCandidates:8,tailPenalty:0,smooth:.12,salt:'pro-risk-v1',...config.planning};
 if(cfg.valueHorizon!==undefined&&(!Number.isInteger(cfg.valueHorizon)||cfg.valueHorizon<1||cfg.valueHorizon>8||!baseline.futureValue))throw Error('固定評価までの先読みは1〜8ターン');
 const scoreCache=new Map(),tableKeys=new WeakMap();
 function score(stats,table){if(!tableKeys.has(table))tableKeys.set(table,JSON.stringify(table));const key=tableKeys.get(table)+'|'+KEYS.map(k=>stats[k]).join(',');
  if(!scoreCache.has(key)){if(scoreCache.size>60000)scoreCache.clear();scoreCache.set(key,sourceScore(stats,table));}return scoreCache.get(key);}
 const cleanCard=c=>({cardNo:c.cardNo,cardName:c.cardName,rarity:c.rarity,category:c.category,effect:c.effect||''});
 if(!Number.isInteger(cfg.worlds)||cfg.worlds<1||cfg.worlds>256)throw Error('仮想将来の数は1〜256');
 const publicCatalog=catalog.map(cleanCard),transitionCache=new Map(),contextSalts=new WeakMap();
 function publicSalt(root){if(!cfg.contextSalt)return cfg.salt;if(!contextSalts.has(root)){const text=JSON.stringify([root.turn,KEYS.map(k=>root.stats[k]),root.tokens,root.owned.map(c=>c.cardNo).sort((a,b)=>a-b),root.candidates.map(c=>c.cardNo).sort((a,b)=>a-b),root.pickCount,root.allowSkip,root.refreshRemaining,root.offerHistory.map(e=>[e.type,e.cards.map(c=>c.cardNo)])]);const random=rng(text);random();random();contextSalts.set(root,cfg.salt+':context:'+Math.floor(random()*4294967296));}return contextSalts.get(root);}

 function onlyPublic(root){return {turn:root.turn,totalTurns:root.totalTurns,difficulty:'pro',mode:'normal',stats:Object.fromEntries(KEYS.map(k=>[k,root.stats[k]])),tokens:{passion:root.tokens.passion,fatigue:root.tokens.fatigue,inspiration:root.tokens.inspiration,organize:root.tokens.organize},owned:root.owned.map(cleanCard),candidates:root.candidates.map(cleanCard),pickCount:root.pickCount,allowSkip:root.allowSkip,rankTable:root.rankTable,turns:root.turns,offerHistory:root.offerHistory||[],refreshRemaining:root.refreshRemaining||0};}
 const makeState=observation=>cloneState({difficulty:'pro',turn:observation.turn,totalTurns:observation.totalTurns,player:observation.stats,tokens:observation.tokens});
 const observe=(root,state,owned,history=root.offerHistory||[])=>({...root,turn:state.turn,stats:{...state.player},tokens:{...state.tokens},owned,candidates:[],offerHistory:history});
 function transition(state,card,slot){
  const key=JSON.stringify([state.turn,card.cardNo,slot,KEYS.map(k=>state.player[k]),state.tokens]);
  let saved=transitionCache.get(key);
  if(!saved){const next=cloneState(state),out=resolve(card,slot,next);saved={applied:out.applied,stats:next.player,tokens:next.tokens};
   if(transitionCache.size>60000)transitionCache.clear();transitionCache.set(key,saved);}
  if(!saved.applied)return null;const next=cloneState(state);next.player={...saved.stats};next.tokens={...saved.tokens};return next;
 }
 function endpointUtility(stats,table){const g=score(stats,table);return g.points+cfg.smooth*g.smoothPoints-cfg.tailPenalty*Math.max(0,8-g.points);}
 function plan(observation,hand,state,width=cfg.rolloutBeam,count=1){
  const remaining=observation.totalTurns-state.turn;
  const forecast=remaining>1?baseline.forecast({...observation,turn:state.turn+1},observation.owned,'engine').end:state.player;
  const growth=Object.fromEntries(KEYS.map(k=>[k,forecast[k]-observation.stats[k]]));
  const drawRoom=Math.max(0,observation.owned.length-4);
  function evaluate(next){
   if(remaining<=1)return score(next.player,observation.rankTable).points*10000+score(next.player,observation.rankTable).smoothPoints;
   const end=Object.fromEntries(KEYS.map(k=>[k,Math.max(0,next.player[k]+growth[k])]));end.enrollment=Math.min(end.enrollment,end.experience);
   const g=score(end,observation.rankTable);
   return g.smoothPoints*20+g.points*2+Math.min(end.experience,50)*.5+Math.min(end.enrollment,48)*.8+
    Math.min(end.satisfaction,35)*.3+Math.min(end.accounting,19)*.35+
    Math.min(drawRoom,Math.max(-4,next.tokens.passion-next.tokens.fatigue))*12+
    next.tokens.inspiration*7+next.tokens.organize*Math.min(5,(remaining-1)*1.5)-Math.max(0,3-next.player.accounting)*3;
  }
  let frontier=[{state:cloneState(state),counts:{leader:0,teacher:0,staff:0},used:0n,seq:[],value:evaluate(state)}],endings=new Map();
  for(let depth=0;depth<hand.length;depth++){
   const expanded=[...frontier],seen=new Set();
   for(const node of frontier)for(const option of enumerateOptions(hand,node.counts)){
    if(node.used&(1n<<BigInt(option.cardIndex)))continue;
    if(SLOTS.slice(SLOTS.indexOf(option.slot)+1).some(s=>node.counts[s]>0))continue;
    const next=transition(node.state,option.card,option.slot);if(!next)continue;
    const used=node.used|(1n<<BigInt(option.cardIndex)),counts={...node.counts,[option.slot]:node.counts[option.slot]+1};
    const key=JSON.stringify([used.toString(),counts,next.player,next.tokens]);if(seen.has(key))continue;seen.add(key);
    expanded.push({state:next,used,counts,seq:[...node.seq,{cardIndex:option.cardIndex,slot:option.slot}],value:evaluate(next)});
   }
   expanded.sort((a,b)=>b.value-a.value||a.seq.length-b.seq.length);frontier=expanded.slice(0,width);
   for(const node of frontier){const key=JSON.stringify([node.state.player,node.state.tokens]);if(!endings.has(key)||endings.get(key).value<node.value)endings.set(key,node);}
  }
  return [...endings.values()].sort((a,b)=>b.value-a.value||a.seq.length-b.seq.length).slice(0,count);
 }
 // プールはカタログ・見た候補・恒久除外だけから再構成する。実物の研修デッキにアクセスしない。
 function makePool(root){
  const available=publicCatalog.filter(c=>c.rarity!=='N'),counts=Object.fromEntries(available.map(c=>[String(c.cardNo),2])),removed={};
  const pool={available,counts,removed,refreshRemaining:root.refreshRemaining||0,history:[...(root.offerHistory||[])],salt:publicSalt(root)};
  for(const entry of root.offerHistory||[])for(const c of entry.cards||[]){const no=String(c.cardNo);
   if(entry.type==='refresh')removed[no]=(removed[no]||0)+1;
   else {refill(pool,c.rarity||entry.rarity);counts[no]=Math.max(0,(counts[no]??2)-1);}}
  return pool;
 }
 function refill(pool,rarity){const all=pool.available.filter(c=>c.rarity===rarity);
  if(!all.some(c=>pool.counts[c.cardNo]>0))for(const c of all)pool.counts[c.cardNo]=Math.max(0,2-(pool.removed[c.cardNo]||0));}
 function offer(pool,rarity,world,turn,round){
  const all=pool.available.filter(c=>c.rarity===rarity),random=rng(`${pool.salt}:offer:${world}:${turn}:${round}:${rarity}`),candidates=[];
  for(let i=0;i<3;i++) {refill(pool,rarity);const eligible=all.filter(c=>pool.counts[c.cardNo]>0&&!candidates.includes(c));if(!eligible.length)break;
   const card=eligible[Math.floor(random()*eligible.length)];candidates.push(card);pool.counts[card.cardNo]--;}
  pool.history.push({type:'offer',turn,rarity,cards:candidates});return candidates;
 }
 function chooseFuture(root,state,owned,pool,world,round,rarity,allowSkip=false){
  const observation=()=>({...observe(root,state,owned,pool.history),refreshRemaining:pool.refreshRemaining});
  let candidates=offer(pool,rarity,world,state.turn,round);if(!candidates.length)return owned;
  if(cfg.futureRefresh&&refreshAdvice&&pool.refreshRemaining>0&&!allowSkip&&
      !(rarity!=='SSR'&&pool.refreshRemaining<2&&state.turn<4)){
   const catalog=pool.available.filter(c=>c.rarity===rarity&&(pool.removed[c.cardNo]||0)<2);
   const reference=refreshAdvice({...observation(),candidates:catalog,pickCount:1,allowSkip:false}).evaluations;
   const current=refreshAdvice({...observation(),candidates,pickCount:1,allowSkip:false}).recommended.score;
   const cutoff=reference[Math.min(reference.length-1,Math.floor(reference.length*.35))]?.score;
   const learnedAdvice=cfg.futureRefresh==='learned'?baseline.futureRefresh({...observation(),candidates,pickCount:1,allowSkip:false},rarity,3,1):null;
   if(learnedAdvice?learnedAdvice.shouldRefresh:current<cutoff){pool.history.push({type:'refresh',turn:state.turn,rarity,cards:candidates});for(const card of candidates)pool.removed[card.cardNo]=(pool.removed[card.cardNo]||0)+1;pool.refreshRemaining--;candidates=offer(pool,rarity,world,state.turn,round+100);}
  }
  const ob={...observation(),candidates,pickCount:1,allowSkip};
  const choice=baseline.acquisition(ob,cfg.futureAcquisition||'engine',true).recommended;
  return [...owned,...choice.indices.map(i=>candidates[i])];
 }
 function deleteFuture(root,state,owned,max){
  if(max<=0)return owned;
  const decisions=baseline.deletions(observe(root,state,owned),max,'aggressive','engine');const result=[...owned];
  for(const d of decisions){const i=result.findIndex(c=>String(c.cardNo)===String(d.cardNo));if(i>=0)result.splice(i,1);}return result;
 }
 function rollout(root,owned,initialState,phase,world){
  let state=cloneState(initialState),cards=[...owned];const pool=makePool(root),starting=state.turn;let played=0;
  if(phase==='after-action'){
   cards=deleteFuture(root,state,cards,(root.turns[state.turn].deletion||0)+(state.tokens.organize||0));state.tokens.organize=0;state.turn++;
  }else if(phase==='after-meeting'){state.tokens.organize=0;state.turn++;}
  for(;state.turn<root.totalTurns;state.turn++){
   let round=0;
   if(state.turn!==starting||phase!=='training')cards=chooseFuture(root,state,cards,pool,world,round++,root.turns[state.turn].training);
   while(state.tokens.inspiration>0){cards=chooseFuture(root,state,cards,pool,world,round++,'SR',true);state.tokens.inspiration--;}
   const hand=publicDraw(cards,Math.min(cards.length,Math.max(0,4+state.tokens.passion-state.tokens.fatigue)),world,state.turn,pool.salt,cfg.drawSampler||'legacy');
   state.tokens.passion=0;state.tokens.fatigue=0;
   const ob=observe(root,state,cards);
   if(cfg.futurePolicy==='baseline'){const seq=baseline.placements(ob,hand,state,'engine',cfg.futureBeam||64,true);for(const step of seq){const next=transition(state,hand[step.cardIndex],step.slot);if(next)state=next;}}
   else {const best=plan(ob,hand,state)[0];if(best)state=best.state;}
   if(++played>=cfg.valueHorizon&&state.turn<root.totalTurns-1){const ob={...observe(root,state,cards,pool.history),refreshRemaining:pool.refreshRemaining},leaf=baseline.futureValue(ob,'after-action');return {score:leaf.mean,utility:leaf.mean+(cfg.leafBlend??.002)*leaf.tie,stats:leaf.forecast,estimated:true};}
   if(state.turn<root.totalTurns-1)cards=deleteFuture(root,state,cards,(root.turns[state.turn].deletion||0)+(state.tokens.organize||0));
   state.tokens.organize=0;
  }
  return {score:score(state.player,root.rankTable).points,utility:endpointUtility(state.player,root.rankTable),stats:{...state.player}};
 }
 function evaluate(root,owned,state,phase){
  if((phase==='after-action'||phase==='after-meeting')&&state.turn===root.totalTurns-1)return {score:endpointUtility(state.player,root.rankTable),mean:score(state.player,root.rankTable).points,below8:Number(score(state.player,root.rankTable).points<8),forecast:{...state.player}};
  const outcomes=Array.from({length:cfg.worlds},(_,world)=>rollout(root,owned,state,phase,world));
  return {score:mean(outcomes.map(o=>o.utility)),mean:mean(outcomes.map(o=>o.score)),below8:outcomes.some(o=>o.estimated)?null:mean(outcomes.map(o=>Number(o.score<8))),estimated:outcomes.some(o=>o.estimated),
   forecast:Object.fromEntries(KEYS.map(k=>[k,mean(outcomes.map(o=>o.stats[k]))]))};
 }
 function acquisition(root){
  root=onlyPublic(root);
  const choices=[],n=root.candidates.length,indices=[];
  if(root.pickCount===2)for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)indices.push([i,j]);else for(let i=0;i<n;i++)indices.push([i]);
  if(root.allowSkip)indices.push([]);
  for(const choice of indices){const after=makeState(root);if(root.allowSkip)after.tokens.inspiration=Math.max(0,after.tokens.inspiration-1);choices.push({indices:choice,...evaluate(root,[...root.owned,...choice.map(i=>root.candidates[i])],after,'training')});}
  choices.sort((a,b)=>b.score-a.score||a.indices.length-b.indices.length||String(a.indices).localeCompare(String(b.indices)));
  return {version:RISK_VERSION,mode:'rollout',worlds:cfg.worlds,valueHorizon:cfg.valueHorizon??null,evaluations:choices,recommended:choices[0]};
 }
 function placements(root,hand,state){
  root=onlyPublic(root);
  let alternatives=plan(root,hand,state,cfg.realBeam,cfg.actionCandidates);
  for(const mode of ['engine','median','myopic']){const seq=baseline.placements(root,hand,state,mode,180,true),next=cloneState(state);for(const p of seq)resolve(hand[p.cardIndex],p.slot,next);alternatives.push({seq,state:next});}
  const seen=new Set();alternatives=alternatives.filter(node=>{const key=JSON.stringify([node.state.player,node.state.tokens]);if(seen.has(key))return false;seen.add(key);return true;});
  if(state.turn===root.totalTurns-1)return alternatives.sort((a,b)=>score(b.state.player,root.rankTable).points-score(a.state.player,root.rankTable).points||score(b.state.player,root.rankTable).smoothPoints-score(a.state.player,root.rankTable).smoothPoints)[0]?.seq||[];
  for(const node of alternatives)node.evaluation=evaluate(root,root.owned,node.state,'after-action');
  alternatives.sort((a,b)=>b.evaluation.score-a.evaluation.score||a.seq.length-b.seq.length);
  return alternatives[0]?.seq||[];
 }
 function deletions(root,max){
  root=onlyPublic(root);
  if(root.turn>=root.totalTurns-1)return [];
  let owned=[...root.owned],decisions=[];
  for(let k=0;k<max&&owned.length>(config.deleteFloor??4);k++){
   const current=evaluate(root,owned,makeState(root),'after-meeting'),options=[];
   for(let i=0;i<owned.length;i++){const after=[...owned];after.splice(i,1);options.push({index:i,cardNo:owned[i].cardNo,...evaluate(root,after,makeState(root),'after-meeting')});}
   options.sort((a,b)=>b.score-a.score||a.index-b.index);const best=options[0];if(!best||best.score<=current.score+.005)break;
   decisions.push({...best,gain:best.score-current.score});owned.splice(best.index,1);
  }
  return decisions;
 }
 return {acquisition,placements,deletions,evaluate,plan,settings:cfg};
}
