import test from 'node:test';import assert from 'node:assert/strict';
import {countDeletionRoles} from '../../solver/browser/ahiru-deletion-role-diagnostics.js?v=20261110-0065';
const card=(n,category='庶務')=>({cardNo:n,category});
function input(rows){return {publicInput:{rows},teachers:{outcomes:Array.from({length:250},(_,i)=>({gameId:String(i),score:i===0?8:12,stats:{accounting:10,satisfaction:15}})),labels:rows.map(r=>({rowId:r.rowId,gameId:r.gameId,action:{cardNos:r.removed}}))},rankTable:[]};}
const row=(id,owned,removed,turn=2)=>({rowId:id,gameId:'0',phase:'deletion',observation:{difficulty:'pro',mode:'normal',turn,owned,stats:{accounting:17,satisfaction:15},tokens:{organize:2,inspiration:1}},removed});
const options={forecastDeck:o=>{assert.equal(o.turn,3);assert.equal(o.tokens.organize,0);assert.equal(o.tokens.inspiration,0);return {accounting:12,satisfaction:15};},canRecover:(c,a)=>a==='accounting'&&c.cardNo===5};
test('複数コピーを実削除順に追い、将来不足の対象を元開始で1件にする',()=>{
 const r=row('a',[card(5),card(5),card(40)],[5,5]);const s=countDeletionRoles(input([r]),options);
 assert.equal(s.games,250);assert.equal(s.removedCards,2);assert.deepEqual(s.counts.accounting.removedLastRecoveryAtLeast15WithFutureShortage,{games:1,endedAtMost8:1});assert.equal(s.examples.length,1);
 const second=row('b',[card(5),card(40)],[5]);const twice=countDeletionRoles(input([r,second]),options);assert.equal(twice.removedCards,3);assert.equal(twice.counts.accounting.removedLastRecovery.games,1);
});
test('庶務カテゴリだけの札は直接回復と数えない',()=>{
 const s=countDeletionRoles(input([row('a',[card(40),card(7,'動員')],[40])]),options);
 assert.equal(s.counts.accounting.removedLastCategoryWithoutRecovery.games,1);assert.equal(s.counts.accounting.removedLastRecovery.games,0);
});
test('存在しない削除・教師の重複・最終会議の削除を拒否',()=>{
 assert.throws(()=>countDeletionRoles(input([row('a',[card(5)],[40])]),options),/公開デッキ/);
 const d=input([row('a',[card(5)],[5])]);d.teachers.labels.push(d.teachers.labels[0]);assert.throws(()=>countDeletionRoles(d,options),/重複/);
 assert.throws(()=>countDeletionRoles(input([row('a',[card(5)],[5],7)]),options),/最終会議/);
});
