import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GameState } from '../../game/js/gameState.js?v=20260815-0055';
import { CardManager } from '../../game/js/cardManager.js?v=20260815-0055';
import { ScoreManager } from '../../game/js/scoreManager.js?v=20260815-0055';
import * as fresh from '../../game/js/freshAcquisitionAdvisor.js?v=20260815-0055';
import { createAdvisorObservation,recommendAcquisition } from '../../game/js/acquisitionAdvisor.js?v=20260815-0055';
import { proGoal,projectProDeck,PROFILES } from '../../game/js/proAcquisitionAdvisor.js?v=20260815-0055';
const cm=new CardManager(null);cm.parseCSV(readFileSync(new URL('../../game/data/cards_pro.csv',import.meta.url),'utf8'));
const sm=new ScoreManager(null),originalFetch=globalThis.fetch;
globalThis.fetch=async()=>({ok:true,text:async()=>readFileSync(new URL('../../game/data/rankPro.csv',import.meta.url),'utf8')});
await sm.loadRankData('test');globalThis.fetch=originalFetch;
const card=no=>cm.allCards.find(c=>Number(c.cardNo)===no);
function state(){const s=new GameState(null);s.reset('pro',{seed:'public'});cm.getBasicCards().forEach(c=>s.addToDeck({...c}));return s;}
const observe=(s,cs,options={})=>createAdvisorObservation(s,cs,{rankTable:sm.rankTable,...options});
test('PROの公式得点とS+の経路はCSV・ScoreManagerに一致する',()=>{
    const s=state();
    for(const experience of [15,25,29,30,40,45,48,50])for(const enrollment of [7,8,11,12,16,32,40,48])for(const satisfaction of [14,15,25,35]){
        Object.assign(s.player,{experience,enrollment:Math.min(experience,enrollment),satisfaction,accounting:15});
        assert.equal(proGoal(s.player,sm.rankTable).points,sm.calculateScore(s).points);
    }
    for(const route of proGoal(s.player,sm.rankTable).routes){assert.ok(route.experience>=route.enrollment);assert.ok(proGoal(route,sm.rankTable).points>=14);}
    for(const row of [[50,40,25],[50,48,15],[48,48,25],[40,40,35]])assert.equal(proGoal({experience:row[0],enrollment:row[1],satisfaction:row[2],accounting:15},sm.rankTable).points,14);
});
test('PRO推薦は並び・seed・個体IDに依存せず、状態・乱数を変更しない',()=>{
    const s=state(),cards=[card(13),card(16),card(6),card(10)],before=JSON.stringify(s);
    const observation=observe(s,cards,{pickCount:2}),result=recommendAcquisition(observation);
    assert.equal(JSON.stringify(s),before);s.player.deck.reverse();s.rng.next('hidden');s.player.deck.forEach(c=>{c.instanceId='private';});
    assert.deepEqual(observe(s,cards,{pickCount:2}),observation);assert.deepEqual(recommendAcquisition(observe(s,cards,{pickCount:2})),result);
    assert.equal(result.evaluations.length,6);assert.equal(result.targetRank,'S+');
});
test('最終ターンの情熱・発想・整理・疲労の将来価値は0、コスト不足を除外する',()=>{
    const s=state();s.turn=7;Object.assign(s.player,{experience:30,enrollment:20,satisfaction:15,accounting:0});
    const a=observe(s,[card(43),card(9)]),result=recommendAcquisition(a);
    assert.deepEqual(result.recommended.indices,[1]);
    const projection=projectProDeck(a,{cards:[card(49)]});
    assert.equal(projection.engine,0);
});
test('設定値を使用回数倍せず、入塾は体験までに制限する',()=>{
    const s=state();s.player.deck=[];Object.assign(s.player,{experience:0,enrollment:0,satisfaction:30,accounting:0});
    const a=observe(s,[]);
    assert.equal(projectProDeck(a,{cards:[card(50)]}).end.accounting,14);
    assert.equal(projectProDeck(a,{cards:[card(25)]}).end.enrollment,0);
});
test('全PROカードを複数ターン・不足・トークン状況で有限値評価できる',()=>{
    const s=state();
    for(const turn of [0,2,5,7])for(const stats of [[0,0,3,5],[25,15,10,2],[45,40,26,17]]){
        s.turn=turn;Object.assign(s.player,Object.fromEntries(['experience','enrollment','satisfaction','accounting'].map((k,i)=>[k,stats[i]])));
        s.tokens.passion=2;s.tokens.fatigue=1;
        for(const profile of Object.keys(PROFILES)){
            const r=recommendAcquisition(observe(s,cm.allCards,{allowSkip:true}),{profile});
            assert.equal(r.evaluations.length,52);assert.ok(r.evaluations.every(e=>Number.isFinite(e.score)&&Object.values(e.forecast).every(Number.isFinite)));
        }
    }
});
test('FRESHの推薦は共通入口でも同一で、未対応難易度・モードを除外する',()=>{
    const s=new GameState(null),fcm=new CardManager(null);fcm.parseCSV(readFileSync(new URL('../../game/data/cards_fresh.csv',import.meta.url),'utf8'));
    fcm.getBasicCards().forEach(c=>s.addToDeck({...c}));const cs=fcm.allCards.filter(c=>c.rarity==='R').slice(0,4);
    assert.deepEqual(recommendAcquisition(createAdvisorObservation(s,cs,{pickCount:2})),fresh.recommendAcquisition(fresh.createAdvisorObservation(s,cs,{pickCount:2})));
    for(const difficulty of ['master','unknown'])assert.equal(recommendAcquisition({...observe(state(),[card(9)]),difficulty}),null);
    for(const mode of ['event','calculator'])assert.equal(recommendAcquisition({...observe(state(),[card(9)]),mode}),null);
    assert.throws(()=>recommendAcquisition(observe(state(),[card(9)]),{profile:'reach'}));
    assert.throws(()=>recommendAcquisition(observe(state(),[card(9)]),{ablation:'hidden'}));
});
