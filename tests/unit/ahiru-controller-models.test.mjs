import test from 'node:test';
import assert from 'node:assert/strict';
import {AhiruAdviceController} from '../../game/js/ahiruAdviceController.js?v=20261107-0063';
test('難易度を切り替えても、遅れて届いた別難易度の補正を使わない',async()=>{
    const state={difficulty:'fresh'},controller=new AhiruAdviceController({gameState:state}),saved=globalThis.fetch,requests=new Map();
    controller.scheduleRefresh=()=>{};globalThis.fetch=url=>new Promise(resolve=>requests.set(new URL(url).pathname,resolve));
    try{
        controller.loadCalibration();state.difficulty='pro';controller.loadCalibration();
        const fresh=[...requests.keys()].find(path=>path.endsWith('/fresh-projection-calibration.json')),pro=[...requests.keys()].find(path=>path.endsWith('/pro-projection-calibration.json'));
        assert.ok(fresh&&pro);requests.get(fresh)({ok:true,json:async()=>({difficulty:'fresh'})});await new Promise(resolve=>setTimeout(resolve,0));
        assert.equal(controller.modelStatus,'loading');assert.equal(controller.calibration,null);
        requests.get(pro)({ok:true,json:async()=>({difficulty:'pro'})});await new Promise(resolve=>setTimeout(resolve,0));
        assert.equal(controller.modelStatus,'ready');assert.equal(controller.calibration.difficulty,'pro');state.difficulty='fresh';assert.equal(controller.calibration.difficulty,'fresh');
    }finally{globalThis.fetch=saved;}
});
test('補正の取得に失敗した難易度でも、他の難易度の補正を代用しない',async()=>{
    const state={difficulty:'fresh'},controller=new AhiruAdviceController({gameState:state}),saved=globalThis.fetch;
    controller.scheduleRefresh=()=>{};controller.models.set('pro',{status:'ready',calibration:{difficulty:'pro'}});globalThis.fetch=async()=>({ok:false});
    try{controller.loadCalibration();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(controller.modelStatus,'failed');assert.equal(controller.calibration,null);}finally{globalThis.fetch=saved;}
});

test('補正通信が止まれば失敗へ戻し、遅れて返っても復活や他難易度の上書きをしない',async()=>{
    const state={difficulty:'fresh'},controller=new AhiruAdviceController({gameState:state},{calibrationTimeoutMs:10}),saved=globalThis.fetch;let release,signal,updates=0;
    controller.scheduleRefresh=()=>updates++;controller.models.set('pro',{status:'ready',calibration:{difficulty:'pro'}});
    globalThis.fetch=(_url,options)=>{signal=options.signal;return new Promise(resolve=>release=resolve);};
    try{controller.loadCalibration();assert.equal(controller.modelStatus,'loading');await new Promise(resolve=>setTimeout(resolve,25));assert.equal(controller.modelStatus,'failed');assert.equal(controller.calibration,null);assert.equal(signal.aborted,true);assert.equal(updates,1);
        release({ok:true,json:async()=>({difficulty:'fresh'})});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(controller.modelStatus,'failed');assert.equal(updates,1);state.difficulty='pro';assert.equal(controller.modelStatus,'ready');assert.equal(controller.calibration.difficulty,'pro');
    }finally{globalThis.fetch=saved;}
});
