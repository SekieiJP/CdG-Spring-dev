import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CardManager} from '../../game/js/cardManager.js?v=20260815-0059';
import {createIntrinsicRecoveryCheck} from '../../solver/browser/pro-intrinsic-recovery.js?v=20260815-0059';
const parser=new CardManager(null);parser.parseCSV(readFileSync(new URL('../../game/data/cards_pro.csv',import.meta.url),'utf8'));
const card=n=>parser.allCards.find(c=>Number(c.cardNo)===n),check=createIntrinsicRecoveryCheck(parser);
const ob=(turn=2,satisfaction=12,accounting=10)=>({turn,totalTurns:8,stats:{experience:25,enrollment:10,satisfaction,accounting}});
test('庶務のNo40と応対のNo49を、直接の経理・満足の回復役に誤認しない',()=>{
 assert.equal(card(35).category,'応対');assert.equal(card(40).category,'庶務');assert.equal(card(49).category,'応対');
 for(const n of [35,40])assert.equal(check(card(n),'accounting',ob(),15),false);
 assert.equal(check(card(49),'satisfaction',ob(),15),false);
 assert.equal(check(card(35),'satisfaction',ob(),15),true);assert.equal(check(card(23),'experience',ob(),40),false);
 assert.equal(check(card(5),'accounting',ob(),15),true);assert.equal(check(card(13),'satisfaction',ob(),15),true);
 assert.equal(check(card(50),'accounting',ob(),15),false);
});
test('条件・残りターン・コストを判定し、観測の非公開情報と未来順序を読まない',()=>{
 assert.equal(check(card(39),'satisfaction',ob(2,12),15),true);assert.equal(check(card(39),'satisfaction',ob(2,14),15),false);
 assert.equal(check(card(51),'satisfaction',ob(6),15),true);assert.equal(check(card(51),'satisfaction',ob(7),15),false);
 const noCash=ob(6,12,0);for(const key of ['seed','rng','deckOrder'])Object.defineProperty(noCash,key,{get(){throw Error('private');}});
 assert.equal(check(card(51),'satisfaction',noCash,15),false);assert.equal(check(card(51),'satisfaction',noCash,15,{...noCash.stats,accounting:5}),true);
 assert.equal(noCash.stats.accounting,0);
});
