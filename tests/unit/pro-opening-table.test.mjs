import test from 'node:test';
import assert from 'node:assert/strict';
import {OPENING_TABLE_SCHEMA,openingPairJobs,validateOpeningTable,createOpeningTablePolicy} from '../../solver/browser/pro-opening-table.js?v=20261107-0062';
const catalog=Array.from({length:6},(_,i)=>({cardNo:i+6,rarity:'R'}));
const initial={totalTurns:8,stats:{experience:0,enrollment:0,satisfaction:3,accounting:5},basicNos:[1,2,3,4,5]};
const table=()=>({schema:OPENING_TABLE_SCHEMA,estimated:true,initial,cardNos:catalog.map(c=>c.cardNo),rows:openingPairJobs(catalog.map(c=>c.cardNo)).map(j=>({...j,score:j.pair.reduce((s,n)=>s+n,0)+j.remaining*.1}))});
const observation=()=>({difficulty:'pro',mode:'normal',turn:0,totalTurns:8,pickCount:2,allowSkip:false,refreshRemaining:2,stats:{...initial.stats},tokens:{passion:0,fatigue:0,inspiration:0,organize:0},owned:initial.basicNos.map(cardNo=>({cardNo})),candidates:catalog.slice(0,4),offerHistory:[{type:'offer',cards:catalog.slice(0,4)}]});
test('初回4候補の6ペアから最大値を選び、順番が変わっても同じカードを選ぶ',()=>{
 const policy=createOpeningTablePolicy({table:table(),catalog}),o=observation(),snapshot=JSON.stringify(o);
 const a=policy.acquisition(o);assert.equal(a.evaluations.length,6);assert.deepEqual(a.recommended.indices,[2,3]);
 const b=policy.acquisition({...o,candidates:[...o.candidates].reverse()});assert.deepEqual(b.recommended.indices.map(i=>o.candidates[3-i].cardNo).sort(),[8,9]);
 assert.equal(JSON.stringify(o),snapshot);assert.equal(a.estimated,true);
});
test('取得・リフレッシュとも同じ表を使用し、費用と残り回数を適用する',()=>{
 const policy=createOpeningTablePolicy({table:table(),catalog}),o=observation(),a=policy.refresh(o);
 const sums=[];for(let x=0;x<3;x++)for(let y=x+1;y<4;y++)for(let z=y+1;z<5;z++)for(let w=z+1;w<6;w++)sums.push(catalog[z].cardNo+catalog[w].cardNo+.1);
 assert.equal(a.combinations,15);assert.ok(Math.abs(a.expectedScore-sums.reduce((s,n)=>s+n,0)/15)<1e-10);assert.ok(a.shouldRefresh);
 assert.equal(createOpeningTablePolicy({table:table(),catalog,refreshCost:10}).refresh(o).shouldRefresh,false);
 assert.equal(policy.refresh({...o,refreshRemaining:0}).reason,'no-remaining');
});
test('公開の永久除外を反映し、初回以外や異なる基本状態は適用しない',()=>{
 const policy=createOpeningTablePolicy({table:table(),catalog}),o=observation();
 const history=[{type:'offer',cards:[catalog[0],catalog[1]]},{type:'refresh',cards:[catalog[0],catalog[1]]},...o.offerHistory];
 const a=policy.refresh({...o,offerHistory:history});assert.equal(a.poolCount,4);assert.equal(a.combinations,1);
 for(const changed of [{turn:1},{difficulty:'fresh'},{pickCount:1},{stats:{...o.stats,accounting:6}},{tokens:{passion:1}},{candidates:[...o.candidates.slice(0,3),o.candidates[0]]},{owned:o.owned.slice(0,4)}])assert.equal(policy.acquisition({...o,...changed}),null);
});
test('未来・シードの非参照、不完全表・重複・非有限値・異なるカタログの拒否',()=>{
 const o=observation();for(const name of ['seed','rng','deckOrder','result','finalScore'])Object.defineProperty(o,name,{get(){throw Error('private '+name);}});
 const t=table(),policy=createOpeningTablePolicy({table:t,catalog});assert.ok(policy.acquisition(o));assert.ok(policy.refresh(o));
 assert.throws(()=>validateOpeningTable({...t,rows:t.rows.slice(1)},catalog));
 assert.throws(()=>validateOpeningTable({...t,rows:[t.rows[0],...t.rows.slice(0,-1)]},catalog));
 assert.throws(()=>validateOpeningTable({...t,rows:t.rows.map((r,i)=>i? r:{...r,score:NaN})},catalog));
 assert.throws(()=>validateOpeningTable(t,catalog.slice(1)));
});
