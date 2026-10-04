/** 公開された合法配置の終状態から、異なる伸ばし方を候補に残す研究用の整理器。 */
const AXES=['experience','enrollment','satisfaction','accounting'];
const CAPS={experience:50,enrollment:48,satisfaction:35,accounting:19};
const stable=(a,b)=>b.value-a.value||a.seq.length-b.seq.length;
export function selectActionCandidates(nodes,limit,observation){
 if(!Number.isInteger(limit)||limit<1||limit>64)throw Error('候補数は1〜64');
 const ranked=[...nodes].sort(stable),chosen=[],seen=new Set();
 const add=node=>{if(!node||chosen.length>=limit)return;const s=node.state,key=JSON.stringify([AXES.map(k=>s.player[k]),['passion','fatigue','inspiration','organize'].map(k=>s.tokens[k])]);if(!seen.has(key)){seen.add(key);chosen.push(node);}};
 // 元の評価の上位を保ち、成長・回復・回転の極端な手も比較へ残す。
 ranked.slice(0,Math.min(2,limit)).forEach(add);
 const room=Math.max(0,observation.owned.length-4);
 const profiles=[...AXES.map(k=>n=>Math.min(CAPS[k],n.state.player[k])),
  n=>Math.min(room,Math.max(-4,n.state.tokens.passion-n.state.tokens.fatigue)),
  n=>n.state.tokens.inspiration+n.state.tokens.organize*.5];
 for(const profile of profiles){const best=[...ranked].sort((a,b)=>profile(b)-profile(a)||stable(a,b))[0];add(best);}
 ranked.forEach(add);return chosen;
}
