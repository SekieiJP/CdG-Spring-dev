import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareOpeningTableInput} from '../../solver/pro-opening-table-input.mjs';
const table={schema:'pro-initial-pair-value-v1',estimated:true,complete:true,initial:{totalTurns:8,stats:{experience:0,enrollment:0,satisfaction:3,accounting:5,seed:'private'},basicNos:[1,2,3,4,5],seed:'private'},cardNos:[6,7],rows:[{pair:[6,7],remaining:2,score:12,predictedFinalScore:12,sourceSeed:'private'}],provenance:{fingerprints:{codeHash:'code',cardVersion:'cards',rankVersion:'ranks',modelSha256:'model'},labels:[15],trainSeeds:['private']}};
const bytes=JSON.stringify(table),hash=b=>createHash('sha256').update(b).digest('hex'),options={expectedSha256:hash(bytes),versions:['code','cards','ranks'],modelSha256:'model'};
test('配布データから教師情報・私有情報を除き、初回計算の公開値だけを取り出す',()=>{
 const input=prepareOpeningTableInput(bytes,options);assert.equal(input.schema,table.schema);assert.deepEqual(input.rows,[{pair:[6,7],remaining:2,score:12}]);assert.equal(input.initial.stats.seed,undefined);assert.equal(input.initial.seed,undefined);assert.equal(input.provenance,undefined);
 input.initial.basicNos[0]=99;assert.equal(table.initial.basicNos[0],1);
});
test('表の破損・未完了・本体・カード・ランク・モデルの版違いを拒否する',()=>{
 assert.throws(()=>prepareOpeningTableInput(bytes,{...options,expectedSha256:'wrong'}));
 for(let i=0;i<3;i++){const versions=[...options.versions];versions[i]='wrong';assert.throws(()=>prepareOpeningTableInput(bytes,{...options,versions}));}
 assert.throws(()=>prepareOpeningTableInput(bytes,{...options,modelSha256:'wrong'}));
 const partial=JSON.stringify({...table,complete:false});assert.throws(()=>prepareOpeningTableInput(partial,{...options,expectedSha256:hash(partial)}));
});
