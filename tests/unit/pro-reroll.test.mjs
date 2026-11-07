import test from 'node:test';
import assert from 'node:assert/strict';
import {initialPairIndices,validateInitialRule} from '../../solver/browser/pro-strategy-research.js?v=20260815-0060';
const cards=nos=>nos.map(cardNo=>({cardNo:String(cardNo)}));
test('見えている2枚組だけで開始を判定し、同名2枚を要求する',()=>{
 assert.deepEqual(initialPairIndices(cards([13,15,7,13]),[[13,13]]),[[0,3]]);
 assert.deepEqual(initialPairIndices(cards([13,15,7,11]),[[13,13]]),[]);
 assert.deepEqual(initialPairIndices(cards([13,15,7,11]),[[15,13],[7,11]]),[[0,1],[2,3]]);
 assert.equal(initialPairIndices(cards([6,7,8,9]),null).length,6);
});
test('R以外・空の開始条件を拒否する',()=>{
 for(const pairs of [null,[[13,15]],[[7,15],[11,15]]])assert.doesNotThrow(()=>validateInitialRule({pairs}));
 for(const pairs of [[[13,13]],[],[[5,13]],[[13,18]],[[13]],[[13,'15']],undefined])assert.throws(()=>validateInitialRule({pairs}));
});

import {startProbability,effortEstimate} from '../../solver/pro-reroll-metrics.mjs';
test('初回は12種から異なる4種を提示する確率で計算する',()=>{
 const one=startProbability([[7,13]]);assert.deepEqual(one,{accepted:45,total:495,probability:1/11,expectedResets:10});
 assert.equal(startProbability(null).probability,1);
 assert.equal(startProbability([[7,13],[13,7]]).accepted,45);
 const relaxed=startProbability([[13,15],[13,16],[13,17]]);assert.equal(relaxed.accepted,109);
});
test('リセットと完走を別に数え、成功0件で所要時間を断定しない',()=>{
 const effort=effortEstimate(.05,1/11,[0,.01,.05]);assert.equal(effort.expectedCompletedGames,20);assert.equal(effort.expectedResets,200);
 assert.deepEqual(effort.equivalentFullGameDurations.map(x=>x.value),[20,22,30]);assert.equal(effortEstimate(0,1).expectedCompletedGames,null);
});
import {auditRerolls} from '../../solver/pro-reroll-metrics.mjs';
test('破棄した候補・受け入れた候補・実シードと回数を全て照合する',()=>{
 const row={seed:'test:0',actualSeed:'test-reset1:0',initialPicks:['13','17'],initialRefreshUsed:0,reroll:{sessionSeed:'test:0',attempts:2,initialRefreshUsed:0,
  rejectedStarts:[{seed:'test:0',cards:[6,7,8,9]}],initialCards:[13,17,10,11],chosenIndices:[0,1]}};
 const config={initial:{pairs:[[13,17]]}};
 assert.equal(auditRerolls([row],config).allRejectedFailCondition,true);
 assert.throws(()=>auditRerolls([{...row,reroll:{...row.reroll,attempts:1}}],config),/回数/);
 assert.throws(()=>auditRerolls([{...row,reroll:{...row.reroll,rejectedStarts:[{seed:'test:0',cards:[13,17,6,7]}]}}],config),/リセット/);
 assert.throws(()=>auditRerolls([{...row,initialPicks:['13','15']}],config),/取得/);
 assert.throws(()=>auditRerolls([{...row,actualSeed:'test:0'}],config),/シード/);
 assert.throws(()=>auditRerolls([row,{...row,seed:'test:1'}],config),/重複/);
});

import {mkdtemp,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {compressRun} from '../../solver/compress-research-runs.mjs';
import {readRunBytes} from '../../solver/pro-strategy-metrics.mjs';
test('可逆圧縮した詳細記録を同じパスで内容を変えずに読み戻せる',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'cdg-research-zip-')),file=path.join(dir,'run.json');
 try{const source=Buffer.from(JSON.stringify({events:Array.from({length:100},(_,i)=>({i,choice:[13,17]}))}));
  await writeFile(file,source);await compressRun(file);assert.deepEqual(await readRunBytes(file),source);assert.deepEqual(await readRunBytes(file+'.gz'),source);
  await assert.rejects(access(file));await access(file+'.gz');
 }finally{await rm(dir,{recursive:true,force:true});}
});

import {compareEffortRates} from '../../solver/pro-reroll-metrics.mjs';
test('両方がリセマラをする場合も時間の交差点を正しく比較する',()=>{
 const strictToRelaxed=compareEffortRates(.026,1/11,.017,109/495);
 assert.ok(Math.abs(strictToRelaxed.breakEvenResetRatioPointEstimate-4905/42470)<1e-12);
 assert.equal(strictToRelaxed.afterBetterFor,'above_break_even');
 const equalQ=compareEffortRates(.006,1/11,.026,1/11);assert.equal(equalQ.breakEvenResetRatioPointEstimate,null);assert.equal(equalQ.afterBetterFor,'all_nonnegative');
 assert.equal(compareEffortRates(0,1,.01,.1).afterBetterFor,null);
});

import {reusableRun} from '../../solver/pro-reroll-study.mjs';
test('再開は分析版だけでなく本体・カード・ランクの更新を検出する',()=>{
 const config={id:'any',initial:{pairs:null}},expected={seed:'test',offset:0,config,strategyVersion:'analysis',codeHash:'game',cardVersion:'cards',rankVersion:'ranks'};
 const d={settings:{seed:'test',episodeOffset:0,episodes:250,research:config,provenance:{strategyVersion:'analysis',codeHash:'game'}},simulations:[{playRecords:Array.from({length:250},()=>({metadata:{cardVersion:'cards',rankVersion:'ranks'}}))}]};
 assert.equal(reusableRun(d,expected),true);
 for(const key of ['seed','offset','strategyVersion','codeHash','cardVersion','rankVersion'])assert.equal(reusableRun(d,{...expected,[key]:'changed'}),false);
});
