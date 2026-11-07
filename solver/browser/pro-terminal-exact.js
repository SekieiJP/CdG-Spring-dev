/** 研究用の最終ターン全探索。現在の公開手札・状態のみを使い、未来を生成しない。 */
const KEYS=['experience','enrollment','satisfaction','accounting'];
const TOKENS=['passion','fatigue','inspiration','organize'];
export function createTerminalExact({rules,placementError,resolve,score,maxStates=1000000}){
 if(!Number.isInteger(maxStates)||maxStates<1||maxStates>5000000)throw Error('全探索の状態上限は1〜5000000');
 const slots=rules.slots.map(s=>s.id);
 if(slots.join(',')!=='leader,teacher,staff'||rules.turns.length!==8||rules.cardZones.length)throw Error('既存PROの最終ターン専用');
 function initial(o){
  if(o.difficulty!=='pro'||o.mode!=='normal'||o.turn!==7||o.totalTurns!==8||KEYS.some(k=>!Number.isFinite(o.stats[k]))||TOKENS.some(k=>!Number.isFinite(o.tokens[k]??0)))throw Error('PRO最終ターンの公開状態が必要');
  return {difficulty:'pro',turn:7,totalTurns:8,slots:rules.slots,config:rules,player:{...Object.fromEntries(KEYS.map(k=>[k,o.stats[k]])),placed:Object.fromEntries(slots.map(s=>[s,[]]))},tokens:Object.fromEntries(TOKENS.map(k=>[k,o.tokens[k]||0])),updateStatus(k,d){const old=this.player[k];this.player[k]=Math.max(0,old+d);if(k==='enrollment')this.player[k]=Math.min(this.player[k],this.player.experience);return this.player[k]-old;}};
 }
 const clone=s=>({...s,player:{...s.player,placed:Object.fromEntries(slots.map(k=>[k,[...s.player.placed[k]]]))},tokens:{...s.tokens}});
 function replay(o,hand,seq){
  const s=initial(o),used=new Set();let last=0;
  for(const step of seq){const pos=slots.indexOf(step.slot),card=hand[step.cardIndex];
   if(pos<last||!card||used.has(step.cardIndex)||placementError(s,card,step.slot))throw Error('観測された配置が合法でない');
   if(!resolve(card,step.slot,s).applied)throw Error('観測された配置の効果が発動しない');
   s.player.placed[step.slot].push(card);used.add(step.cardIndex);last=pos;
  }
  return {score:score(s),stats:Object.fromEntries(KEYS.map(k=>[k,s.player[k]])),tokens:{...s.tokens}};
 }
 function optimize(o,hand){
  if(!Array.isArray(hand)||hand.length>20)throw Error('公開手札は20枚以内');
  const root=initial(o),seen=new Set(),scores=new Map();let visited=0,complete=true;
  const metric=s=>{const k=KEYS.map(k=>s.player[k]).join(',');if(!scores.has(k))scores.set(k,score(s));return scores.get(k);};
  let best={metric:metric(root),state:root,sequence:[]};
  function visit(s,mask,last,seq){
   if(!complete)return;
   const k=[mask.toString(16),last,...slots.map(k=>s.player.placed[k].length),...KEYS.map(k=>s.player[k]),...TOKENS.map(k=>s.tokens[k])].join(',');
   if(seen.has(k))return;seen.add(k);if(++visited>maxStates){complete=false;return;}
   const m=metric(s),b=best.metric;
   if(m.displayScore>b.displayScore||m.displayScore===b.displayScore&&(m.withdrawal<b.withdrawal||m.withdrawal===b.withdrawal&&seq.length<best.sequence.length))best={metric:m,state:s,sequence:[...seq]};
   const equivalent=new Set();
   for(let i=0;i<hand.length;i++){
    if(mask&(1n<<BigInt(i)))continue;
    const card=hand[i],identity=JSON.stringify([card.cardNo,card.category,card.effect]);if(equivalent.has(identity))continue;equivalent.add(identity);
    for(let pos=last;pos<slots.length;pos++){
     const slot=slots[pos];if(placementError(s,card,slot))continue;
     const next=clone(s);if(!resolve(card,slot,next).applied)continue;next.player.placed[slot].push(card);
     visit(next,mask|(1n<<BigInt(i)),pos,[...seq,{cardIndex:i,slot}]);
    }
   }
  }
  visit(root,0n,0,[]);
  return {complete,visited,score:best.metric,stats:Object.fromEntries(KEYS.map(k=>[k,best.state.player[k]])),sequence:best.sequence,
   purpose:complete?'exact legal terminal optimum; same points prefer less withdrawal':'lower bound only; state limit reached'};
 }
 return {optimize,replay};
}
