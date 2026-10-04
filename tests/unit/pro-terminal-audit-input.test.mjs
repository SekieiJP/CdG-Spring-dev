import test from 'node:test';
import assert from 'node:assert/strict';
import {packTerminalFrame} from '../../solver/pro-terminal-audit.mjs';
const catalog=new Map([['7',{cardNo:'7',cardName:'ポスティング',category:'動員',rarity:'R',effect:'体験+5。',private:'hidden'}]]);
const event=()=>({observation:{difficulty:'pro',mode:'normal',turn:7,totalTurns:8,stats:{experience:40,enrollment:30,satisfaction:25,accounting:15},tokens:{passion:0,fatigue:0,inspiration:0,organize:0},seed:'private',owned:[]},hand:[{cardNo:'7',instanceId:'private'}],placements:[{cardIndex:0,slot:'leader'}],result:15});
test('整理器は公開状態と手札定義だけを配布し、操作・結果・私有情報を渡さない',()=>{
 const e=event();for(const k of ['rng','deckOrder','finalScore'])Object.defineProperty(e.observation,k,{get(){throw Error('private');}});
 const out=packTerminalFrame(e,catalog);assert.deepEqual(Object.keys(out),['observation','hand']);assert.equal(out.observation.seed,undefined);assert.equal(out.placements,undefined);assert.equal(out.result,undefined);assert.equal(out.hand[0].private,undefined);assert.equal(out.hand[0].instanceId,undefined);
});
test('PRO最終ターン以外・イベント・計算機・未知の札を拒否する',()=>{
 for(const changed of [{difficulty:'fresh'},{mode:'event'},{mode:'calculator'},{turn:6},{totalTurns:9}]){const e=event();e.observation={...e.observation,...changed};assert.throws(()=>packTerminalFrame(e,catalog));}
 assert.throws(()=>packTerminalFrame({...event(),hand:[{cardNo:'8'}]},catalog));
});
