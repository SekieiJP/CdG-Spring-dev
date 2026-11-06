import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CardManager} from '../../game/js/cardManager.js?v=20260815-0058';
import {ScoreManager} from '../../game/js/scoreManager.js?v=20260815-0058';
import {getDifficultyConfig} from '../../game/js/difficultyConfig.js?v=20260815-0058';
import {getPlacementError} from '../../game/js/placementRules.js?v=20260815-0058';
import {createPublicActionKernel} from '../../solver/browser/pro-public-action-kernel.js?v=20260815-0058';
import {createTerminalExact} from '../../solver/browser/pro-terminal-exact.js?v=20260815-0058';
const cm=new CardManager(null);cm.parseCSV(readFileSync(new URL('../../game/data/cards_pro.csv',import.meta.url),'utf8'));
const sm=new ScoreManager(null),original=globalThis.fetch;globalThis.fetch=async()=>({ok:true,text:async()=>readFileSync(new URL('../../game/data/rankPro.csv',import.meta.url),'utf8')});await sm.loadRankData('test');globalThis.fetch=original;
const rules=getDifficultyConfig('pro'),card=n=>cm.allCards.find(c=>Number(c.cardNo)===n),resolve=createPublicActionKernel(rules.turns,cm);
const make=maxStates=>createTerminalExact({rules,placementError:(s,c,slot)=>getPlacementError(cm,s,c,slot),resolve,score:s=>sm.calculateScore(s),...(maxStates?{maxStates}:{})});
const observe=stats=>({difficulty:'pro',mode:'normal',turn:7,totalTurns:8,stats,tokens:{passion:0,fatigue:0,inspiration:0,organize:0}});
test('実効果・公式得点で全探索し、同点なら退塾が少ない配置を選ぶ',()=>{
 const o=observe({experience:45,enrollment:33,satisfaction:21,accounting:15}),hand=[46,42,22,4].map(card),optimizer=make();
 const before=JSON.stringify(o),out=optimizer.optimize(o,hand),old=optimizer.replay(o,hand,[{cardIndex:0,slot:'leader'},{cardIndex:3,slot:'teacher'},{cardIndex:1,slot:'staff'}]);
 assert.equal(old.score.displayScore,12);assert.equal(old.score.withdrawal,1);assert.equal(out.complete,true);assert.equal(out.score.displayScore,12);assert.equal(out.score.withdrawal,0);assert.equal(JSON.stringify(o),before);
 assert.equal(optimizer.replay(o,hand,out.sequence).score.displayScore,out.score.displayScore);
});
test('重複した並行札も全部使え、効果条件と配置制限は本体に従う',()=>{
 const o=observe({experience:40,enrollment:10,satisfaction:3,accounting:15}),hand=Array(10).fill(card(30)),out=make().optimize(o,hand);
 assert.equal(out.complete,true);assert.equal(out.stats.enrollment,40);assert.equal(out.stats.satisfaction,23);assert.equal(out.sequence.length,10);assert.ok(out.visited<10000);
 assert.throws(()=>make().replay(o,[card(30)],[{cardIndex:0,slot:'staff'}]));
 assert.throws(()=>make().replay(o,[card(30)],[{cardIndex:0,slot:'leader'},{cardIndex:0,slot:'teacher'}]));
});
test('未来・シード・実際の結果を参照せず、状態制限を達成証明としない',()=>{
 const o=observe({experience:40,enrollment:20,satisfaction:15,accounting:15});
 for(const k of ['seed','rng','deckOrder','result','finalScore'])Object.defineProperty(o,k,{get(){throw Error('private');}});
 const result=make(1).optimize(o,[card(7),card(30)]);assert.equal(result.complete,false);assert.match(result.purpose,/lower bound/);
 assert.throws(()=>make().optimize({...o,turn:6},[card(7)]));
});
