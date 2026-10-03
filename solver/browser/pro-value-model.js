/** 過去の実プレイを教師として学習する、分析専用の短時間状態評価。抽選・未来順序は参照しない。 */
export const VALUE_SCHEMA='pro-public-value-v1';
const KEYS=['experience','enrollment','satisfaction','accounting'],TOKENS=['passion','fatigue','inspiration','organize'];
const CATEGORIES=['動員','教務','応対','庶務'],RARITIES=['N','R','SR','SSR'];
export const VALUE_FEATURES=Object.freeze([
 'phase-acquisition','phase-after-action','phase-before-training','turn','remaining',
 ...KEYS.map(k=>'now-'+k),...TOKENS.map(k=>'token-'+k),'withdrawal','difference','now-points','now-smooth',
 'owned-count','parallel-count','normal-count',...CATEGORIES.map(k=>'category-'+k),...RARITIES.map(k=>'rarity-'+k),
 ...KEYS.map(k=>'forecast-'+k),'forecast-points','forecast-smooth','forecast-engine','forecast-risk','forecast-draw',
 'xp-to40','xp-to50','en-to32','en-to40','en-to48','sat-to15','sat-to25','sat-to35','cash-to15',
 'refresh-remaining','offered40','offered49','removed40','removed49',
 ...Array.from({length:51},(_,i)=>'count-'+(i+1))
]);
const MONOTONE=Object.fromEntries(VALUE_FEATURES.map((n,i)=>[i,n.startsWith('now-')&&!['now-points','now-smooth'].includes(n)||['token-passion','token-inspiration','token-organize'].includes(n)?1:n==='token-fatigue'?-1:0]));
function finite(n){if(!Number.isFinite(n))throw Error('状態特徴に有限数が必要');return n;}
export function publicValueObservation(o){
 const card=c=>({cardNo:c.cardNo,cardName:c.cardName,category:c.category,rarity:c.rarity,effect:c.effect,acquiredTurn:c.acquiredTurn||0});
 return {difficulty:'pro',mode:'normal',turn:o.turn,totalTurns:o.totalTurns,stats:Object.fromEntries(KEYS.map(k=>[k,o.stats[k]])),tokens:Object.fromEntries(TOKENS.map(k=>[k,o.tokens[k]||0])),
  owned:o.owned.map(card),rankTable:o.rankTable,turns:o.turns,refreshRemaining:o.refreshRemaining||0,
  offerHistory:(o.offerHistory||[]).map(e=>({type:e.type,cards:(e.cards||[]).map(c=>({cardNo:c.cardNo}))}))};
}
/** 入力を明示的な公開フィールドだけから作る。seed・ラベル・山札順などへのアクセスを避ける。 */
export function encodeValueFeatures(observation,phase,{forecast,score}){
 observation=publicValueObservation(observation);
 const stats=Object.fromEntries(KEYS.map(k=>[k,finite(observation.stats[k])])),tokens=Object.fromEntries(TOKENS.map(k=>[k,finite(observation.tokens[k]||0)]));
 const owned=observation.owned,counts=Array(51).fill(0),history={40:[0,0],49:[0,0]};
 for(const c of owned){const n=Number(c.cardNo);if(n<1||n>51||!Number.isInteger(n))throw Error('既知のPROカードNoが必要');counts[n-1]++;}
 for(const event of observation.offerHistory||[])for(const c of event.cards||[])if(history[Number(c.cardNo)])history[Number(c.cardNo)][Number(event.type==='refresh')]++;
 const withdrawal=Math.max(0,15-stats.satisfaction)+Math.max(0,15-stats.accounting),now=score(stats,observation.rankTable);
 const nextTurn=phase==='after-action'?observation.turn+1:observation.turn;
 const f=forecast({...observation,turn:nextTurn},owned,'engine'),goal=score(f.end,observation.rankTable),parallel=owned.filter(c=>(c.effect||'').includes('並行')).length;
 return [Number(phase==='acquisition'),Number(phase==='after-action'),Number(phase==='before-training'),observation.turn,Math.max(0,observation.totalTurns-nextTurn),
  ...KEYS.map(k=>stats[k]),...TOKENS.map(k=>tokens[k]),withdrawal,stats.enrollment-withdrawal,now.points,now.smoothPoints,
  owned.length,parallel,owned.length-parallel,...CATEGORIES.map(k=>owned.filter(c=>c.category===k).length),...RARITIES.map(k=>owned.filter(c=>c.rarity===k).length),
  ...KEYS.map(k=>f.end[k]),goal.points,goal.smoothPoints,f.engine,f.risk,f.draw,
  ...[[stats.experience,40],[stats.experience,50],[stats.enrollment,32],[stats.enrollment,40],[stats.enrollment,48],[stats.satisfaction,15],[stats.satisfaction,25],[stats.satisfaction,35],[stats.accounting,15]].map(([v,t])=>Math.max(0,t-v)),
  observation.refreshRemaining||0,...[40,49].map(n=>history[n][0]),...[40,49].map(n=>history[n][1]),...counts].map(finite);
}
export function unpackValueObservation(packed,context){
 const catalog=new Map(context.catalog.map(c=>[Number(c.cardNo),c]));
 return {difficulty:'pro',mode:'normal',turn:packed.turn,totalTurns:8,stats:Object.fromEntries(KEYS.map((k,i)=>[k,packed.stats[i]])),tokens:Object.fromEntries(TOKENS.map((k,i)=>[k,packed.tokens[i]])),
  owned:packed.owned.map(([n,t])=>({...catalog.get(n),acquiredTurn:t})),offerHistory:(packed.history||[]).flatMap(([n,offers,removed])=>[
   ...Array.from({length:offers},()=>({type:'offer',cards:[{cardNo:n}]})),...Array.from({length:removed},()=>({type:'refresh',cards:[{cardNo:n}]}))]),
  refreshRemaining:packed.refreshRemaining,rankTable:context.rankTable,turns:context.turns};
}
const checkedModels=new WeakSet();
export function predictValue(model,features){
 if(!checkedModels.has(model)){
  if(model.schema!==VALUE_SCHEMA||model.features.join('|')!==VALUE_FEATURES.join('|'))throw Error('評価モデルの特徴版が異なる');checkedModels.add(model);
 }
 if(features.length!==VALUE_FEATURES.length)throw Error('評価モデルの特徴版が異なる');
 let value=model.base;
 for(const tree of model.trees){let node=tree;while(node.feature!==undefined)node=features[node.feature]<=node.threshold?node.left:node.right;value+=model.learningRate*node.value;}
 return value;
}
const prng=seed=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
/** 学習もブラウザ内。ヒストグラム分割による小さな木を固定回数積み重ねる。 */
export async function trainValueModel(rows,{iterations=140,depth=3,learningRate=.07,bins=16,featureFraction=.65,rowFraction=.8,minRows=100,minWeight=3,l2=2,monotone=false,seed=904125,onProgress=()=>{}}={}){
 if(!rows.length||rows.some(r=>r.x.length!==VALUE_FEATURES.length||!Number.isFinite(r.y)||!(r.weight>0)))throw Error('学習データが不正');
 const n=rows.length,m=VALUE_FEATURES.length,random=prng(seed),weights=Float64Array.from(rows,r=>r.weight),targets=Float64Array.from(rows,r=>r.y),sumWeight=weights.reduce((s,w)=>s+w,0);
 const model={schema:VALUE_SCHEMA,features:[...VALUE_FEATURES],base:rows.reduce((s,r)=>s+r.y*r.weight,0)/sumWeight,learningRate,trees:[],settings:{iterations,depth,learningRate,bins,featureFraction,rowFraction,minRows,minWeight,l2,monotone,seed}};
 const cuts=[],encoded=[];
 for(let f=0;f<m;f++){
  const values=rows.map(r=>r.x[f]).sort((a,b)=>a-b),unique=[...new Set(values)];let edges=[];
  if(unique.length<=bins)edges=unique.slice(0,-1).map((v,i)=>(v+unique[i+1])/2);
  else for(let b=1;b<bins;b++){const i=Math.floor(b*n/bins),a=values[i-1],z=values[i];if(a!==z)edges.push((a+z)/2);else edges.push(a);}
  edges=[...new Set(edges)].filter(v=>v<unique.at(-1));cuts.push(edges);
  const data=new Uint8Array(n);for(let i=0;i<n;i++){const x=rows[i].x[f];let b=0;while(b<edges.length&&x>edges[b])b++;data[i]=b;}encoded.push(data);
 }
 const prediction=new Float64Array(n).fill(model.base),residual=new Float64Array(n);
 function leaf(indices,lo,hi){let sw=0,sr=0;for(const i of indices){sw+=weights[i];sr+=weights[i]*residual[i];}return {value:Math.max(lo,Math.min(hi,sr/(sw+l2)))};}
 function grow(indices,leftDepth,selected,lo=-3,hi=3){
  const terminal=leaf(indices,lo,hi);if(leftDepth<=0||indices.length<minRows*2)return terminal;
  let totalW=0,totalR=0;for(const i of indices){totalW+=weights[i];totalR+=weights[i]*residual[i];}if(totalW<minWeight*2)return terminal;
  let best=null;
  for(const f of selected){if(!cuts[f].length)continue;const bw=new Float64Array(cuts[f].length+1),br=new Float64Array(bw.length),bc=new Uint32Array(bw.length),data=encoded[f];
   for(const i of indices){const b=data[i];bw[b]+=weights[i];br[b]+=weights[i]*residual[i];bc[b]++;}
   let lw=0,lr=0,lc=0;for(let b=0;b<cuts[f].length;b++){
    lw+=bw[b];lr+=br[b];lc+=bc[b];const rw=totalW-lw,rr=totalR-lr;
    if(lc<minRows||indices.length-lc<minRows||lw<minWeight||rw<minWeight)continue;
    const lm=lr/(lw+l2),rm=rr/(rw+l2),direction=monotone?MONOTONE[f]:0;if(direction&&direction*(rm-lm)<0)continue;
    const gain=lr*lr/(lw+l2)+rr*rr/(rw+l2)-totalR*totalR/(totalW+l2);
    if(gain>0&&(!best||gain>best.gain))best={f,b,gain,direction,mid:Math.max(lo,Math.min(hi,(lm+rm)/2))};
   }
  }
  if(!best)return terminal;const left=[],right=[];for(const i of indices)(encoded[best.f][i]<=best.b?left:right).push(i);
  const leftLimits=best.direction>0?[lo,best.mid]:best.direction<0?[best.mid,hi]:[lo,hi],rightLimits=best.direction>0?[best.mid,hi]:best.direction<0?[lo,best.mid]:[lo,hi];
  return {feature:best.f,threshold:cuts[best.f][best.b],left:grow(left,leftDepth-1,selected,...leftLimits),right:grow(right,leftDepth-1,selected,...rightLimits)};
 }
 function treePrediction(tree,i){let node=tree;while(node.feature!==undefined)node=encoded[node.feature][i]<=cuts[node.feature].indexOf(node.threshold)?node.left:node.right;return node.value;}
 for(let t=0;t<iterations;t++){
  for(let i=0;i<n;i++)residual[i]=targets[i]-prediction[i];
  const selected=Array.from({length:m},(_,i)=>i).filter(()=>random()<featureFraction),indices=Array.from({length:n},(_,i)=>i).filter(()=>random()<rowFraction);
  const tree=grow(indices,depth,selected);model.trees.push(tree);for(let i=0;i<n;i++)prediction[i]+=learningRate*treePrediction(tree,i);
  if((t+1)%20===0||t===iterations-1){onProgress({iteration:t+1,rmse:Math.sqrt(rows.reduce((s,r,i)=>s+r.weight*(r.y-prediction[i])**2,0)/sumWeight)});await new Promise(resolve=>setTimeout(resolve,0));}
 }
 return model;
}
export function valueMetrics(model,rows){
 const w=rows.reduce((s,r)=>s+r.weight,0);let se=0,ae=0,bias=0;
 for(const r of rows){const error=predictValue(model,r.x)-r.y;se+=r.weight*error**2;ae+=r.weight*Math.abs(error);bias+=r.weight*error;}
 return {rows:rows.length,weight:w,rmse:Math.sqrt(se/w),mae:ae/w,bias:bias/w};
}
