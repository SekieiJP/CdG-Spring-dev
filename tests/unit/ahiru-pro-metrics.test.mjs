import test from 'node:test';
import assert from 'node:assert/strict';
import {assessStability,selectPilotCandidate,auditAhiruBatch} from '../../solver/ahiru-pro-metrics.mjs';
test('1000開始で平均12以上、8点を含め19回までを許容する',()=>{
 const scores=Array(1000).fill(13);for(let i=0;i<19;i++)scores[i]=8;
 assert.ok(assessStability(scores).passed);assert.equal(assessStability(scores).atMost8.count,19);
 scores[19]=8;assert.equal(assessStability(scores).atMost8.rate,.02);assert.ok(!assessStability(scores).passed);
 assert.ok(!assessStability(Array(1000).fill(11)).passed);assert.ok(assessStability(Array(1000).fill(12)).passed);
 assert.ok(!assessStability(Array(999).fill(12)).passed);assert.ok(!assessStability(Array(1001).fill(12)).passed);
});

test('旧2000開始の再監査は明示し、現在の1000開始の達成と混同しない',()=>{
 const scores=Array(2000).fill(13);for(let i=0;i<39;i++)scores[i]=8;
 assert.equal(assessStability(scores).passed,false);assert.equal(assessStability(scores,{requiredSeeds:2000}).passed,true);
 scores[39]=8;assert.equal(assessStability(scores,{requiredSeeds:2000}).passed,false);
 assert.throws(()=>assessStability([12],{requiredSeeds:250}));
});
test('全開発条件を見て、平均条件と低得点件数、平均点の事前規則で選ぶ',()=>{
 const g=(mean,count)=>({n:250,mean,atMost8:{count}});
 assert.equal(selectPilotCandidate({baseline:g(12.3,5),downside025:g(12.1,3),downside050:g(12.2,3)}),'downside050');
 assert.equal(selectPilotCandidate({a:g(11.9,0),b:g(12.2,5)}),null);
 assert.throws(()=>selectPilotCandidate({a:{...g(12.2,0),n:249}}));
});
function fixture(){const config={id:'frozen'},fingerprints={strategyVersion:'actor',codeHash:'game',cardVersion:'cards',rankVersion:'ranks'},seed='new',offset=250;
 const rs=Array.from({length:250},(_,i)=>({metadata:{difficulty:'pro',source:'autoplay',seed:`new:${250+i}`,research:config,provenance:{strategyVersion:'actor',codeHash:'game'},cardVersion:'cards',rankVersion:'ranks'},events:Array.from({length:8},(_,turn)=>({type:'research-placement-decision',turn})),result:{score:{displayScore:12}}}));
 return {data:{settings:{seed,episodeOffset:offset,episodes:250,difficulty:'pro',research:config,provenance:{strategyVersion:'actor',codeHash:'game'}},simulations:[{playRecords:rs}]},expected:{seed,offset,config,fingerprints}};
}
test('全開始の順序と8配置を監査し、欠落・リセット・局面継続・版違いを拒否',()=>{
 const f=fixture();assert.equal(auditAhiruBatch(f.data,f.expected).length,250);
 for(const change of [d=>d.simulations[0].playRecords.pop(),d=>d.simulations[0].playRecords[0].metadata.seed='replaced',d=>d.simulations[0].playRecords[0].metadata.reroll={attempts:2},d=>d.simulations[0].playRecords[0].metadata.source='counterfactual',d=>d.simulations[0].playRecords[0].metadata.provenance.strategyVersion='other',d=>d.simulations[0].playRecords[0].events.pop(),d=>d.simulations[0].playRecords[0].truncated=true,d=>d.simulations[0].playRecords[0].metadata.calcMode=true,d=>d.simulations[0].playRecords[0].metadata.eventId='event']){
  const x=fixture();change(x.data);assert.throws(()=>auditAhiruBatch(x.data,x.expected));
 }
});

test('0番への選択固定も拒否し、通常の未指定/nullと区別する',()=>{
 const plain=fixture();plain.data.settings.forcedChoice=null;plain.data.simulations[0].playRecords[0].metadata.forcedChoice=null;assert.equal(auditAhiruBatch(plain.data,plain.expected).length,250);
 for(const change of [d=>d.settings.forcedChoice=0,d=>d.simulations[0].playRecords[0].metadata.forcedChoice=0]){const f=fixture();change(f.data);assert.throws(()=>auditAhiruBatch(f.data,f.expected));}
});
