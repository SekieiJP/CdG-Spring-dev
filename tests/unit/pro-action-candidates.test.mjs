import test from 'node:test';
import assert from 'node:assert/strict';
import {selectActionCandidates} from '../../solver/browser/pro-action-candidates.js?v=20261107-0060';
const node=(id,value,stats={},tokens={})=>({id,value,seq:[{cardIndex:0,slot:'staff'}],state:{player:{experience:20,enrollment:16,satisfaction:14,accounting:12,...stats},tokens:{passion:0,fatigue:0,inspiration:0,organize:0,...tokens}}});
test('似た評価上位に偏らず、成長・回復・回転の合法候補を残す',()=>{
 const values=[node('balanced',100),node('similar',99,{experience:21}),node('xp',80,{experience:40}),node('enroll',79,{enrollment:32}),node('safety-s',78,{satisfaction:25}),node('safety-c',77,{accounting:18}),node('draw',76,{}, {passion:3}),node('inspiration',75,{}, {inspiration:2})];
 const input=[...values],ob={owned:Array(10).fill({cardNo:1})};
 assert.deepEqual(new Set(selectActionCandidates(values,8,ob).map(n=>n.id)),new Set(values.map(n=>n.id)));
 assert.deepEqual(values,input);assert.equal(selectActionCandidates(values,1,ob)[0].id,'balanced');
 assert.deepEqual(selectActionCandidates(values,2,ob).map(n=>n.id),['balanced','similar']);
});
test('上限を越す無駄な伸びに偏らず、同じ終状態の重複と非公開項目を避ける',()=>{
 const a=node('cap',50,{experience:50}),b=node('overcap',49,{experience:70}),copy={...a,id:'duplicate',value:51};
 const ob={owned:Array(6).fill({cardNo:1})};Object.defineProperties(ob,{seed:{get(){throw Error('seed');}},deckOrder:{get(){throw Error('order');}},result:{get(){throw Error('future');}}});
 const selected=selectActionCandidates([a,b,copy,node('base',60)],8,ob);
 assert.equal(selected.filter(n=>n.state.player.experience===50).length,1);
 assert.equal(selected[0].id,'base');assert(selected.some(n=>n.id==='duplicate'));
 assert.throws(()=>selectActionCandidates([],0,ob),/候補数/);
});
