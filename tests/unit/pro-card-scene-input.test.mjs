import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSceneBatch} from '../../solver/pro-card-scene-input.mjs';
const versions=['game','cards','ranks'];
function bank(){return {cardNo:43,versions,scenes:Array.from({length:250},(_,i)=>({sceneId:`43-${i}`,targetIndices:[0],referenceIndices:[1],
 observation:{schema:1,difficulty:'pro',mode:'normal',turn:2,totalTurns:8,stats:{experience:20,enrollment:10,satisfaction:12,accounting:15},tokens:{passion:0,fatigue:0,inspiration:0,organize:0},
 owned:[],candidates:[{cardNo:'43'},{cardNo:'49'}],pickCount:1,allowSkip:false,turns:Array(8).fill({}),offerHistory:[],refreshRemaining:2,seed:'元ゲームのシード',futureResult:16}}))};}
test('局面番号は保ち、2群の取得指定以外の公開観測は一致する',()=>{
 const bytes=JSON.stringify(bank()),args={episodes:250,versions},a=prepareSceneBatch(bytes,'reference',args),b=prepareSceneBatch(bytes,'target',args);
 assert.equal(a.sha256,b.sha256);assert.deepEqual(a.scenes.map(s=>s.observationSha256),b.scenes.map(s=>s.observationSha256));
 assert.deepEqual(a.scenes[0].forcedChoice,[1]);assert.deepEqual(b.scenes[0].forcedChoice,[0]);assert.equal('seed' in b.scenes[0].observation,false);
});
test('異なる版・未確保の局面・対象カード以外の強制取得を拒否する',()=>{
 const args={episodes:250,versions};assert.throws(()=>prepareSceneBatch(JSON.stringify(bank()),'target',{...args,versions:['other','cards','ranks']}));
 assert.throws(()=>prepareSceneBatch(JSON.stringify(bank()),'target',{...args,offset:1}));
 const bad=bank();bad.scenes[0].targetIndices=[1];assert.throws(()=>prepareSceneBatch(JSON.stringify(bad),'target',args));
});
