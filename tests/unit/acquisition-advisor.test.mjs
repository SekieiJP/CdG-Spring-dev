import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GameState } from '../../game/js/gameState.js?v=20260815-0054';
import { CardManager } from '../../game/js/cardManager.js?v=20260815-0054';
import { createAdvisorObservation, recommendAcquisition } from '../../game/js/freshAcquisitionAdvisor.js?v=20260815-0054';
const cm = new CardManager(null);
cm.parseCSV(readFileSync(new URL('../../game/data/cards_fresh.csv',import.meta.url),'utf8'));
const card = no => cm.allCards.find(c=>Number(c.cardNo)===no);
function state() { const s=new GameState(null); cm.getBasicCards().forEach(c=>s.addToDeck({...c})); return s; }

test('推薦は既知情報だけを受け取り、隠れた並び・seed・ログを消費しない',()=>{
    const s=state(); const candidates=[card(6),card(11),card(15),card(13)];
    const before=JSON.stringify(s);
    const observation=createAdvisorObservation(s,candidates,{pickCount:2});
    const result=recommendAcquisition(observation);
    assert.equal(JSON.stringify(s),before);
    s.player.deck.reverse(); s.rng.next('hidden'); s.runId='different';
    assert.deepEqual(createAdvisorObservation(s,candidates,{pickCount:2}),observation);
    assert.deepEqual(recommendAcquisition(createAdvisorObservation(s,candidates,{pickCount:2})),result);
    assert.equal(result.evaluations.length,6);
    assert.equal(result.recommended.indices.length,2);
    assert.ok(result.evaluations.every(row=>Number.isFinite(row.score)));
});
test('最終ターンのコスト不足を高い効果値でごまかさない',()=>{
    const s=state(); s.turn=7;
    Object.assign(s.player,{experience:10,enrollment:10,satisfaction:15,accounting:1});
    const result=recommendAcquisition(createAdvisorObservation(s,[card(44),card(6)]));
    assert.deepEqual(result.recommended.indices,[1]);
    assert.ok(result.evaluations.find(row=>row.indices[0]===0).features.risk<0);
});
test('入塾の上限と満足・経理それぞれの不足を分けて評価する',()=>{
    const s=state(); s.turn=7;
    s.player.deck=[];
    Object.assign(s.player,{experience:0,enrollment:0,satisfaction:30,accounting:0});
    const result=recommendAcquisition(createAdvisorObservation(s,[card(25),card(37)]));
    assert.equal(result.evaluations.find(row=>row.indices[0]===0).forecast.enrollment,0);
    assert.deepEqual(result.recommended.indices,[1]);
});
test('発想の取得辞退を比較し、通常研修では辞退を提案しない',()=>{
    const s=state(); s.turn=7;
    Object.assign(s.player,{experience:30,enrollment:30,satisfaction:30,accounting:30});
    const observation=createAdvisorObservation(s,[card(12)],{allowSkip:true});
    const result=recommendAcquisition(observation);
    assert.ok(result.evaluations.some(row=>row.skip));
    assert.equal(recommendAcquisition({...observation,allowSkip:false}).evaluations.some(row=>row.skip),false);
});
test('PRO・イベント・計算機の推薦を混ぜず、特徴を外す実験を明示する',()=>{
    const observation=createAdvisorObservation(state(),[card(6),card(15)]);
    for(const mode of ['calculator','event']) assert.equal(recommendAcquisition({...observation,mode}),null);
    assert.equal(recommendAcquisition({...observation,difficulty:'pro'}),null);
    assert.equal(recommendAcquisition(observation,{ablation:'accounting'}).evaluations[0].contributions.accounting,0);
    assert.throws(()=>recommendAcquisition(observation,{profile:'unknown'}));
});
