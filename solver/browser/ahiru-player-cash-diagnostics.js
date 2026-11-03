import {projectProDeck} from '../../game/js/proAcquisitionAdvisor.js';
import {RESEARCH_MODES} from './pro-strategy-research.js';

/** 既存の全開始の公開会議だけを固定投影する。将来の抽選や別のゲームは実行しない。 */
export function diagnosePlayerCash({publicInput,teachers}){
 const outcomes=new Map(teachers.outcomes.map(o=>[o.gameId,o]));
 if(outcomes.size<250||outcomes.size!==teachers.outcomes.length)throw Error('異なる全250開始以上が必要');
 const flags=new Map([...outcomes.keys()].map(id=>[id,new Set()])),seen=new Set(),examples=[];
 let meetings=0,frames=0;
 for(const row of publicInput.rows){
  if(seen.has(row.rowId)||!outcomes.has(row.gameId)||row.observation.difficulty!=='pro'||row.observation.mode!=='normal')throw Error('公開会議と元開始の対応が不正');seen.add(row.rowId);
  const o=row.observation;if(o.turn<2||o.turn>=7||row.deleteMax<=0)continue;meetings++;
  const next={...o,turn:o.turn+1,tokens:{...o.tokens,inspiration:0,organize:0}};
  let owned=[...o.owned];
  for(let i=0;i<row.deleteMax;i++){
   const index=owned.findIndex(c=>Number(c.cardNo)===5);if(index<0)break;
   const after=[...owned];after.splice(index,1);
   const first=projectProDeck(next,{weights:RESEARCH_MODES.engine,cards:after});
   const projected=projectProDeck(next,{weights:RESEARCH_MODES.engine,cards:after,forecast:first.end}).end.accounting,current=o.stats.accounting;
   if(!Number.isFinite(current)||!Number.isFinite(projected))throw Error('有限な公開経理の投影が必要');frames++;
   const set=flags.get(row.gameId),currentOnlyBlocked=current<15&&projected>=15;
   if(currentOnlyBlocked)set.add('currentBelow15ButForecastAtLeast15');
   if(current<15&&projected>=17)set.add('currentBelow15ButForecastAtLeast17');
   if(current>=15&&projected<15)set.add('currentAtLeast15ButForecastBelow15');
   if(currentOnlyBlocked&&examples.length<6)examples.push({gameId:row.gameId,turn:o.turn,currentAccounting:current,forecastWithoutBasic:projected});
   const actual=row.removed[i];if(actual===undefined)break;
   const removed=owned.findIndex(c=>Number(c.cardNo)===Number(actual));if(removed<0)throw Error('実削除と公開デッキが不一致');owned.splice(removed,1);
  }
 }
 const names=['currentBelow15ButForecastAtLeast15','currentBelow15ButForecastAtLeast17','currentAtLeast15ButForecastBelow15'];
 return {games:outcomes.size,meetings,frames,groups:Object.fromEntries(names.map(name=>{const ids=[...flags].filter(([,set])=>set.has(name)).map(([id])=>id);return [name,{games:ids.length,endedAtMost8:ids.filter(id=>outcomes.get(id).score<=8).length}];})),examples,interpretation:'同じ開始の複数会議を別の開始と数えない、全開始の記述件数。将来の実結果は件数の併記だけで、投影には渡さない。条件を緩める介入の改善数や因果効果ではない。250未満の該当群の条件付き成功率を推定しない。'};
}
