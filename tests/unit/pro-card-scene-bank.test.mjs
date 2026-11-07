import test from 'node:test';
import assert from 'node:assert/strict';
import {publicScene} from '../../solver/pro-card-scene-bank.mjs';

const hidden=object=>Object.defineProperty(object,'privateFuture',{get(){throw Error('非公開情報を読んだ');},enumerable:true});
test('公開局面の複製に隠れた未来・シード・結果を混入させない',()=>{
 const card=hidden({cardNo:'43',cardName:'カード',rarity:'SSR',category:'動員',effect:'経験値+1',acquiredTurn:0});
 const turn=hidden({recommended:'動員',recommendedStatus:'experience',training:'SSR',deletion:1});
 const source=hidden({schema:1,difficulty:'pro',mode:'training',turn:2,totalTurns:8,
  stats:hidden({experience:10,enrollment:5,satisfaction:12,accounting:10}),
  tokens:hidden({passion:1,fatigue:0,inspiration:2,organize:0}),
  owned:[card],candidates:[card],pickCount:1,allowSkip:false,turns:[turn],
  offerHistory:[hidden({type:'offer',turn:2,rarity:'SSR',cards:[card]})],refreshRemaining:1,
  seed:'元の開始シード',result:{score:16},deckOrder:[1,2,3]});
 const scene=publicScene(source);
 assert.equal(scene.stats.experience,10);
 assert.equal(scene.owned[0].acquiredTurn,0);
 assert.equal(scene.turns[0].deletion,1);
 assert.equal(scene.offerHistory[0].cards[0].cardNo,'43');
 assert.equal(JSON.stringify(scene).includes('privateFuture'),false);
 for(const key of ['seed','result','deckOrder'])assert.equal(key in scene,false);
 source.stats.experience=99;source.turns[0].training='R';source.owned[0].cardName='変更';
 assert.equal(scene.stats.experience,10);assert.equal(scene.turns[0].training,'SSR');assert.equal(scene.owned[0].cardName,'カード');
});
