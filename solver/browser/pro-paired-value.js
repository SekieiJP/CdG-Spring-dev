import {VALUE_FEATURES,encodeValueFeatures,publicValueObservation} from './pro-value-model.js';
/** 研修2択の公開状態差を固定特徴へ変換する。実seed、未来、結果を読まない。 */
export const PAIRED_SCHEMA='pro-public-paired-value-v1';
export const PAIRED_FEATURES=Object.freeze([...VALUE_FEATURES.map(n=>'root-'+n),...VALUE_FEATURES.map(n=>'change-'+n)]);
const choiceKey=a=>[...a].sort((a,b)=>a-b).join(',');
export function encodePairedFeatures(root,reference,target,context){
 const valid=a=>Array.isArray(a)&&a.length===root.pickCount&&new Set(a).size===a.length&&a.every(i=>Number.isInteger(i)&&i>=0&&root.candidates[i]);
 if(root.difficulty!=='pro'||root.mode!=='normal'||root.allowSkip||![1,2].includes(root.pickCount)||!valid(reference)||!valid(target)||choiceKey(reference)===choiceKey(target))
  throw Error('公開研修の異なる2取得が必要');
 const publicRoot=publicValueObservation(root),card=c=>({cardNo:c.cardNo,cardName:c.cardName,category:c.category,rarity:c.rarity,effect:c.effect,acquiredTurn:publicRoot.turn});
 const after=indices=>({...publicRoot,owned:[...publicRoot.owned,...indices.map(i=>card(root.candidates[i]))]});
 const base=encodeValueFeatures(publicRoot,'acquisition',context),a=encodeValueFeatures(after(reference),'acquisition',context),b=encodeValueFeatures(after(target),'acquisition',context);
 return [...base,...b.map((v,i)=>v-a[i])];
}
export function reversePairedFeatures(features){
 if(features.length!==PAIRED_FEATURES.length)throw Error('取得差特徴版の不一致');
 return [...features.slice(0,VALUE_FEATURES.length),...features.slice(VALUE_FEATURES.length).map(v=>-v||0)];
}
const checked=new WeakSet();
export function predictPairedGain(model,features){
 if(!checked.has(model)){if(model.schema!==PAIRED_SCHEMA||model.features.join('|')!==PAIRED_FEATURES.join('|'))throw Error('取得差モデルの版が異なる');checked.add(model);}
 if(features.length!==PAIRED_FEATURES.length||features.some(v=>!Number.isFinite(v)))throw Error('取得差特徴が不正');
 const evaluate=x=>{let y=model.base;for(const tree of model.trees){let n=tree;while(n.feature!==undefined)n=x[n.feature]<=n.threshold?n.left:n.right;y+=model.learningRate*n.value;}return y;};
 // 2択の向きを反転した時の予測も使い、gain(A→B) = -gain(B→A)を保証する。
 return (evaluate(features)-evaluate(reversePairedFeatures(features)))/2;
}
