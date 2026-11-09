import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CardManager} from '../../game/js/cardManager.js?v=20261110-0065';
import {ScoreManager} from '../../game/js/scoreManager.js?v=20261110-0065';
import {DEFAULT_TURNS} from '../../game/js/defaultRules.js?v=20261110-0065';
import {recommendFreshStatus} from '../../game/js/ahiruFreshAdvice.js?v=20261110-0065';
import {recommendProStatus} from '../../game/js/ahiruProAdvice.js?v=20261110-0065';
import {expectedBest,publicRefreshPool} from '../../game/js/ahiruActionEvaluation.js?v=20261110-0065';
import {createAhiruRoleInspector} from '../../game/js/ahiruCardRoles.js?v=20261110-0065';
const read=path=>readFileSync(new URL('../../game/data/'+path,import.meta.url),'utf8');
async function setup(difficulty){
    const manager=new CardManager(null);manager.parseCSV(read(`cards_${difficulty}.csv`));
    const scorer=new ScoreManager(null,{migrateHighScore:false}),saved=globalThis.fetch;
    try{globalThis.fetch=async()=>({ok:true,text:async()=>read(difficulty==='fresh'?'rankFresh.csv':'rankPro.csv')});await scorer.loadRankData('test');}finally{globalThis.fetch=saved;}
    const card=no=>({...manager.allCards.find(c=>Number(c.cardNo)===no),acquiredTurn:0});
    const observation=(turn,owned,candidates,stats)=>({difficulty,mode:'normal',turn,totalTurns:8,stats,tokens:{passion:0,fatigue:0,inspiration:0,organize:0},
        owned:owned.map(card),candidates:candidates.map(card),pickCount:turn===0?2:1,allowSkip:false,turns:DEFAULT_TURNS.map(t=>({...t,deletion:t.delete})),rankTable:scorer.rankTable});
    return {manager,card,observation,recommend:difficulty==='fresh'?recommendFreshStatus:recommendProStatus};
}
const fresh=await setup('fresh'),pro=await setup('pro');
test('写真1: 体験0の最初の2枚は、入塾より先に実際の体験供給を案内する',()=>{
    const o=fresh.observation(0,[1,2,3,4,5],[16,14,11,17],{experience:0,enrollment:0,satisfaction:3,accounting:3});
    const advice=fresh.recommend(o);assert.equal(advice.tone,'yellow');assert.equal(advice.actionAxis,'experience');assert.match(advice.text,/まず体験/);
    assert.ok(advice.preferredIndices.includes(1));assert.equal(advice.preferredIndices.length,2);
});
test('写真5: 満足の候補がない時は、推薦に含む実行可能な別の作用だけを伝える',()=>{
    const o=fresh.observation(3,[1,2,3,4,5,14,16,20],[10,15,9],{experience:16,enrollment:3,satisfaction:7,accounting:4});
    const advice=fresh.recommend(o,{catalog:fresh.manager.allCards,refreshEnabled:true});
    assert.notEqual(advice.actionAxis,'satisfaction');assert.doesNotMatch(advice.text,/満足|リフレッシュ|応対|候補外/);
    const inspector=createAhiruRoleInspector(advice.forecast.observation,advice.forecast.expectedEnd);
    assert.ok(advice.preferredIndices.some(i=>inspector.canRecover(o.candidates[i],advice.actionAxis,15)));
});
test('写真6: 最終研修の候補外の体験と、行動で初めて生む発想を取得機会と混同しない',()=>{
    const o=pro.observation(7,[1,2,3,4,5,8,22,39],[34,25,29],{experience:40,enrollment:40,satisfaction:35,accounting:16});
    for(const inspiration of [0,1]){
        o.tokens.inspiration=inspiration;const advice=pro.recommend(o);
        assert.notEqual(advice.actionAxis,'experience');assert.doesNotMatch(advice.text,/体験.*(?:取|狙|選)|次の研修/);
        if(!inspiration)assert.notEqual(advice.reason,'available-inspiration');
    }
});
test('カード名やカテゴリを強く推さず、選択・解除で文面も比較結果も変わらない',()=>{
    for(const setup of [fresh,pro]){
        const o=setup.observation(1,[1,2,3,4,5,14,16],[25,36,39],{experience:3,enrollment:0,satisfaction:5,accounting:5});
        for(const phase of ['acquisition','deletion']){
            const before=setup.recommend(o,{phase,deleteMax:2,catalog:setup.manager.allCards});
            assert.deepEqual(setup.recommend(o,{phase,deleteMax:2,catalog:setup.manager.allCards,selectedIndices:[0]}),before);
            assert.doesNotMatch(before.text,/回復札|必要な札は残そう/);assert.ok(Array.from(before.text).length<=25);
            for(const card of [...o.owned,...o.candidates])assert.ok(!before.text.includes(card.cardName));
        }
    }
});
test('削除は無削除と残りの通常取得を比較し、最終会議は削除利益を作らない',()=>{
    const o=fresh.observation(0,[1,2,3,4,5,14,16],[],{experience:3,enrollment:0,satisfaction:5,accounting:5});
    const advice=fresh.recommend(o,{phase:'deletion',deleteMax:2,catalog:fresh.manager.allCards});
    assert.equal(advice.deletion.futureAcquisitions,7);assert.ok(advice.deletion.checked>=1+o.owned.length);assert.ok(advice.deletion.best.value>=advice.deletion.keep.value);
    const noDelete=fresh.recommend(o,{phase:'deletion',deleteMax:0,catalog:fresh.manager.allCards});assert.equal(noDelete.text,'このまま次に進もう');
    o.turn=7;const last=fresh.recommend(o,{phase:'deletion',deleteMax:4,catalog:fresh.manager.allCards});assert.equal(last.text,'このまま次に進もう');assert.equal(last.forecast.remaining,0);
});
test('異なる名前の3択の最良値の期待値を、コピー数比例にせず計算する',()=>{
    assert.equal(expectedBest([1,2,3,4],3),3.75);assert.equal(expectedBest([2,8],3),8);assert.equal(expectedBest([],3),null);
    const cards=[1,2,3,4,5].map(n=>({cardNo:String(n),cardName:'札'+n,rarity:'SR'}));
    const history=[{type:'offer',rarity:'SR',cards:cards.slice(0,3)},{type:'refresh',rarity:'SR',cards:cards.slice(0,3)},{type:'offer',rarity:'SR',cards:cards.slice(0,3)}];
    const pool=publicRefreshPool(cards,history,'SR',cards.slice(0,3));
    assert.equal(pool,null);
    // 初回の提示は1コピーしか減らないため、同名のもう1コピーも次の候補に残る。
    const once=publicRefreshPool(cards,history.slice(0,1),'SR',cards.slice(0,3));assert.equal(once.length,5);
});
test('FRESHには将来も交換を勧めず、PROも権利なし・不完全な履歴では勧めない',()=>{
    for(const setup of [fresh,pro]){
        const o=setup.observation(3,[1,2,3,4,5],[9,10,11],{experience:40,enrollment:40,satisfaction:10,accounting:2});
        o.refreshRemaining=setup===fresh?99:0;o.offerHistory=[{type:'offer',rarity:'R',cards:o.candidates}];
        const options={catalog:setup.manager.allCards,refreshEnabled:true};assert.equal(setup.recommend(o,options).refresh,null);
        if(setup===pro){o.refreshRemaining=2;o.offerHistory=[];assert.equal(setup.recommend(o,options).refresh,null);}
    }
});
test('合法なPROの交換は、全候補が低評価で他の最良3択の期待利益が高い時だけ選択肢にする',()=>{
    const o=pro.observation(7,[],[34,25,29],{experience:40,enrollment:40,satisfaction:35,accounting:16});
    o.refreshRemaining=2;o.offerHistoryComplete=true;o.offerHistory=[{type:'offer',rarity:'R',turn:0,cards:[6,7,8,12].map(pro.card)},{type:'offer',rarity:'SR',turn:7,cards:o.candidates}];
    const options={catalog:pro.manager.allCards,refreshEnabled:true},advice=pro.recommend(o,options);
    assert.equal(advice.refresh?.available,true);assert.match(advice.text,/リフレッシュ.*手もある/);
    assert.ok(advice.refresh.expectedGain-advice.refresh.currentGain>advice.refresh.reserve);
    o.refreshRemaining=0;assert.notEqual(pro.recommend(o,options).reason,'refresh-option');
    o.refreshRemaining=2;o.offerHistoryComplete=false;assert.equal(pro.recommend(o,options).refresh,null);
});
test('最終ターンに生成する発想・情熱を、今使える手数の増加とは呼ばない',()=>{
    const o=pro.observation(7,[],[29,40,25],{experience:40,enrollment:40,satisfaction:35,accounting:16});
    const inspector=createAhiruRoleInspector(o,o.stats);
    assert.equal(inspector.supportsHand(pro.card(29)),false);assert.equal(inspector.supportsHand(pro.card(40)),false);
    assert.equal(inspector.supportsHand(pro.card(9)),true);
});
