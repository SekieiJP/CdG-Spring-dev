import test from 'node:test';
import assert from 'node:assert/strict';
import {summarize,pairedComparison,reachesTarget} from '../../solver/acquisition-analysis.mjs';
function record(seed,model,grade,points,extra={}){return{metadata:{seed,difficulty:'pro',source:'autoplay',strategy:'pro_goal',continuationPolicy:'pro_goal',acquisitionModel:model,cardVersion:'cards1',rankVersion:'rank1',rulesVersion:'rules1',codeVersion:'v1',refreshPolicy:'public',refreshModel:'pro_balanced',...extra},events:[],result:{score:{points,displayScore:points,rank:{grade}}}};}
test('PROの主目標はS+以上であり、SSを含めてSを除く',()=>{
    const records=[record('dev:0','pro_balanced','S',12),record('dev:1','pro_balanced','S+',14),record('dev:2','pro_balanced','SS',15)];
    const data=summarize(records,{difficulty:'pro'});assert.equal(data.targetRank,'S+');assert.equal(data.groups[0].sRate,2/3);assert.equal(data.groups[0].median,14);
    assert.equal(reachesTarget(records[0],'S+'),false);assert.equal(reachesTarget(records[2],'S+'),true);
    assert.equal(summarize(records).groups.length,0);
});
test('同じ配置方略の取得変更と配置を含む変更を別に示す',()=>{
    const baseline=record('dev:0',null,'S',12),other=record('dev:0',null,'S+',14,{continuationPolicy:'pro_compress'}),model=record('dev:0','pro_balanced','SS',15);
    const data=summarize([baseline,other,model],{difficulty:'pro'});const c=data.comparisons.find(r=>r.after===2);
    assert.equal(c.before,0);assert.equal(c.scope,'acquisition-only');assert.equal(c.sRateDifference,1);
    assert.equal(pairedComparison([baseline],[model],100,{targetRank:'S+'}).improvedToS,1);
});

test('リフレッシュも変更した比較を取得だけの効果として表示しない',()=>{
    const before=record('dev:0',null,'S',12,{refreshPolicy:'legacy',refreshModel:null}),after=record('dev:0','pro_balanced','S+',14);
    const data=summarize([before,after],{difficulty:'pro'});assert.equal(data.comparisons[0].scope,'full-strategy');
});
