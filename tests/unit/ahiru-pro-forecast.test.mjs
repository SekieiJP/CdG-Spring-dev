import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CardManager} from '../../game/js/cardManager.js?v=20260815-0059';
import {projectProDeck} from '../../game/js/proAcquisitionAdvisor.js?v=20260815-0059';
import {createValueForecaster} from '../../solver/browser/pro-value-model.js?v=20260815-0059';
import {projectProAdviceState} from '../../game/js/ahiruProForecast.js?v=20260815-0059';
const manager=new CardManager(null);manager.parseCSV(readFileSync(new URL('../../game/data/cards_pro.csv',import.meta.url),'utf8'));
const calibration=JSON.parse(readFileSync(new URL('../../game/data/ahiru/pro-projection-calibration.json',import.meta.url),'utf8')),versions={cardVersion:calibration.cardVersion,rankVersion:calibration.rankVersion};
const card=n=>({...manager.allCards.find(c=>Number(c.cardNo)===n),acquiredTurn:0});
function observation(){return {difficulty:'pro',mode:'normal',turn:0,totalTurns:8,stats:{experience:0,enrollment:0,satisfaction:3,accounting:5},tokens:{passion:0,fatigue:0,inspiration:0,organize:0},owned:[1,2,3,4,5].map(card),candidates:[13,17,7,10].map(card),pickCount:2,allowSkip:false,turns:Array(8).fill({recommended:'動員',recommendedStatus:'experience'})};}
test('公開デッキの2回の固定投影は基準と一致し、seed・結果を参照しない',()=>{
 const o=observation(),before=JSON.stringify(o);const r=projectProAdviceState(o),f=createValueForecaster(projectProDeck);
 assert.deepEqual(r.rawEnd,f(r.observation,r.observation.owned).end);assert.equal(JSON.stringify(o),before);
 for(const name of ['seed','rng','deckOrder','outcome'])Object.defineProperty(o,name,{enumerable:true,get(){throw Error('private access');}});
 const safe=projectProAdviceState(o);assert.deepEqual(safe.rawEnd,r.rawEnd);for(const name of ['seed','rng','deckOrder','outcome'])assert.equal(name in safe.observation,false);
});
test('初回2枚の選択は完了してから反映し、元デッキを変更しない',()=>{
 const o=observation(),before=JSON.stringify(o),partial=projectProAdviceState(o,{selectedIndices:[0]}),complete=projectProAdviceState(o,{selectedIndices:[0,1]});
 assert.equal(partial.observation.owned.length,5);assert.equal(partial.position,'before');assert.equal(complete.observation.owned.length,7);assert.equal(complete.position,'after');assert.equal(JSON.stringify(o),before);
 assert.throws(()=>projectProAdviceState(o,{selectedIndices:[0,0]}));assert.throws(()=>projectProAdviceState(o,{selectedIndices:[99]}));
});
test('会議では次ターンからを数え、整理を消費し、最終会議に成長を加算しない',()=>{
 const o=observation();o.turn=7;o.tokens.organize=3;o.tokens.passion=2;o.stats={experience:40,enrollment:32,satisfaction:15,accounting:15};
 const r=projectProAdviceState(o,{phase:'deletion',deleteMax:3,selectedIndices:[0],calibration,versions});
 assert.equal(r.remaining,0);assert.equal(r.observation.turn,8);assert.equal(r.observation.tokens.organize,0);assert.equal(r.observation.tokens.passion,2);assert.equal(r.observation.owned.length,4);assert.deepEqual(r.expectedEnd,o.stats);assert.equal(r.calibrated,false);
 assert.equal(o.turn,7);assert.equal(o.tokens.organize,3);assert.equal(o.owned.length,5);
 assert.throws(()=>projectProAdviceState(o,{phase:'deletion',deleteMax:0,selectedIndices:[0]}));
});
test('物理版・正常モード・観測範囲の一致時だけ時期の補正を使う',()=>{
 const o=observation(),r=projectProAdviceState(o,{calibration,versions});assert.equal(r.calibrated,true);
 for(const option of [{versions:{...versions,cardVersion:'other'}},{versions:{...versions,rankVersion:'other'}},{calibration:{...calibration,schema:2}}]){
  const a=projectProAdviceState(o,{calibration,versions,...option});assert.equal(a.calibrated,false);assert.deepEqual(a.expectedEnd,a.rawEnd);
 }
 const short=projectProAdviceState({...o,owned:o.owned.slice(0,2)},{calibration,versions});assert.equal(short.calibrated,false);
 for(const mode of ['calculator','event'])assert.equal(projectProAdviceState({...o,mode},{calibration,versions}).calibrated,false);
 for(const k of ['experience','enrollment','satisfaction','accounting'])assert.ok(r.lowerEnd[k]<=r.expectedEnd[k]&&r.expectedEnd[k]<=r.upperEnd[k]);
 assert.equal(projectProAdviceState({...o,difficulty:'fresh'}),null);
});
