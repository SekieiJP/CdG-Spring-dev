import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GameState} from '../../game/js/gameState.js';
import {CardManager} from '../../game/js/cardManager.js';
import {TurnManager} from '../../game/js/turnManager.js';
import {createPublicActionKernel} from '../../solver/browser/pro-public-action-kernel.js';
const cm=new CardManager(null);cm.parseCSV(readFileSync(new URL('../../game/data/cards_pro.csv',import.meta.url),'utf8'));
const real=new GameState(null);real.reset('pro',{seed:'kernel-test'});const tm=new TurnManager(real,cm,null),kernel=createPublicActionKernel(real.config.turns,new CardManager(null));
const clone=s=>({difficulty:'pro',turn:s.turn,totalTurns:8,player:{...s.player},tokens:{...s.tokens},updateStatus(k,d){const before=this.player[k];this.player[k]=Math.max(0,before+d);if(k==='enrollment')this.player[k]=Math.min(this.player[k],this.player.experience);return this.player[k]-before;}});
test('仮想専用の軽量適用は全51カード・全配置先・全ターン・条件境界で本体と一致する',()=>{
 const states=[[0,0,3,0],[4,4,6,1],[10,10,9,2],[15,15,10,4],[25,25,12,13],[40,32,14,14],[48,40,15,15],[50,48,35,20]];
 for(let turn=0;turn<8;turn++)for(const stats of states)for(const card of cm.allCards)for(const slot of ['leader','teacher','staff']){
  const a=clone({turn,player:Object.fromEntries(['experience','enrollment','satisfaction','accounting'].map((k,i)=>[k,stats[i]])),tokens:{passion:1,fatigue:1,inspiration:1,organize:1}}),b=clone(a);
  const original=tm.resolveCardAction(card,slot,a),light=kernel(card,slot,b);
  assert.equal(light.applied,original.applied,`${card.cardNo}/${slot}/${turn}`);assert.deepEqual(b.player,a.player);assert.deepEqual(b.tokens,a.tokens);
 }
});

test('同じ公開状態の再利用は、元の手札・乱数を読まず、条件とコストも正確に適用する',()=>{
 const state={turn:2,totalTurns:8,player:{experience:20,enrollment:10,satisfaction:14,accounting:1},tokens:{passion:0,fatigue:0,inspiration:0,organize:0}};
 for(const key of ['seed','rng','deckOrder','trainingDecks'])Object.defineProperty(state,key,{get(){throw Error('private');}});
 Object.defineProperty(state.player,'deck',{enumerable:true,get(){throw Error('private deck');}});
 const make=()=>({turn:state.turn,totalTurns:state.totalTurns,player:Object.fromEntries(['experience','enrollment','satisfaction','accounting'].map(k=>[k,state.player[k]])),tokens:{...state.tokens}}),card=cm.allCards.find(c=>Number(c.cardNo)===49);
 const a=make(),b=make();kernel(card,'staff',a);kernel(card,'staff',b);assert.deepEqual(a,b);assert.equal(a.player.satisfaction,14);assert.equal(a.tokens.inspiration,0);
 kernel(card,'staff',state);assert.equal(state.tokens.inspiration,0);
 const cost=cm.allCards.find(c=>Number(c.cardNo)===43),before=make();assert.equal(kernel(cost,'leader',state).applied,false);assert.deepEqual(make(),before);
});

test('満足を先に上げてから並行の手紙を重ねると発動し、逆順では発動しない',()=>{
 const talk=cm.allCards.find(c=>Number(c.cardNo)===13),letter=cm.allCards.find(c=>Number(c.cardNo)===49),make=()=>({turn:3,totalTurns:8,player:{experience:20,enrollment:10,satisfaction:12,accounting:15},tokens:{passion:0,fatigue:0,inspiration:0,organize:0}});
 const a=make(),b=make();kernel(talk,'staff',a);kernel(letter,'staff',a);kernel(letter,'staff',b);kernel(talk,'staff',b);
 assert.equal(a.player.satisfaction,15);assert.equal(a.tokens.passion,2);assert.equal(a.tokens.inspiration,1);assert.equal(b.player.satisfaction,15);assert.equal(b.tokens.passion,0);assert.equal(b.tokens.inspiration,0);
});
