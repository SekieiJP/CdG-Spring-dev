import {createHash} from 'node:crypto';
import {OPENING_TABLE_SCHEMA} from './browser/pro-opening-table.js';
/** 配布前の版検査と公開値の取り出しのみ。取得判断はブラウザで行う。 */
export function prepareOpeningTableInput(bytes,{expectedSha256,versions,modelSha256}){
 const hash=createHash('sha256').update(bytes).digest('hex');
 if(!expectedSha256||hash!==expectedSha256)throw Error('初回評価表のSHAが異なる');
 const table=JSON.parse(bytes),fp=table.provenance?.fingerprints;
 if(table.schema!==OPENING_TABLE_SCHEMA||table.estimated!==true||table.complete!==true||!fp||
  fp.codeHash!==versions[0]||fp.cardVersion!==versions[1]||fp.rankVersion!==versions[2]||fp.modelSha256!==modelSha256)throw Error('初回評価表・本体・カード・得点表・モデルの版が異なる');
 return {schema:table.schema,estimated:true,initial:{totalTurns:table.initial.totalTurns,stats:Object.fromEntries(['experience','enrollment','satisfaction','accounting'].map(k=>[k,table.initial.stats[k]])),basicNos:[...table.initial.basicNos]},
  cardNos:[...table.cardNos],rows:table.rows.map(r=>({pair:[...r.pair],remaining:r.remaining,score:r.score}))};
}
