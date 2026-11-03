import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAdviceCalibration} from '../../game/js/ahiruCalibrationLoader.js';
test('補正本文を返して終了し、成功後に時間切れで通信を中断しない',async()=>{
    let signal;const data={difficulty:'pro'},result=await loadAdviceCalibration('local',{timeoutMs:10,fetchImpl:async(_url,options)=>{signal=options.signal;return {ok:true,json:async()=>data};}});
    assert.equal(result,data);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(signal.aborted,false);
});
test('通信応答またはJSON本文が停止しAbortを無視しても、期限で戻る',async()=>{
    for(const bodyStalls of [false,true]){let signal;await assert.rejects(loadAdviceCalibration('local',{timeoutMs:5,fetchImpl:async(_url,options)=>{signal=options.signal;if(!bodyStalls)return new Promise(()=>{});return {ok:true,json:()=>new Promise(()=>{})};}}),/時間切れ/);assert.equal(signal.aborted,true);}
});
test('不正な期限は通信を開始せず、HTTPエラーも本文を読み続けない',async()=>{
    let calls=0;for(const timeoutMs of [0,-1,Infinity,NaN])await assert.rejects(loadAdviceCalibration('local',{timeoutMs,fetchImpl:()=>{calls++;}}));assert.equal(calls,0);
    await assert.rejects(loadAdviceCalibration('local',{timeoutMs:20,fetchImpl:async()=>({ok:false,json:()=>new Promise(()=>{})})}),/取得できない/);
});
