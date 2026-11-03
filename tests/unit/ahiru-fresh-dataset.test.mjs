import test from 'node:test';
import assert from 'node:assert/strict';
import {extractFreshAhiruRows} from '../../solver/ahiru-fresh-dataset.mjs';
function fixture(){
    const catalog=Array.from({length:9},(_,i)=>({cardNo:String(i+1),cardName:'Card'+(i+1),category:'動員',rarity:i<5?'N':'R',effect:i===6?'[発想💡]':i===7?'[整理🗑️]':'体験+1。'}));
    const events=[],owned=new Map(),turns=Array.from({length:8},(_,i)=>({deletion:i<4?1:0}));
    let stats={experience:0,enrollment:0,satisfaction:3,accounting:3},tokens={passion:0,fatigue:0,inspiration:0,organize:0},nextId=0;
    const add=(turn,type,data)=>events.push({sequence:events.length,turn,type,...structuredClone(data)});
    function acquire(turn,no){const c={...catalog[no-1],instanceId:'fixture-id-'+nextId++,acquiredTurn:turn};owned.set(c.instanceId,c);add(turn,'acquire',{card:c});}
    function choose(turn,indices,allowSkip=false){
        const observation={difficulty:'fresh',mode:'normal',turn,totalTurns:8,stats,tokens,owned:[...owned.values()],candidates:catalog.slice(5,9),pickCount:turn===0?2:1,allowSkip,turns};add(turn,'acquisition-decision',{observation,chosenIndices:indices});
        for(const i of indices)acquire(turn,i+6);if(allowSkip)tokens.inspiration--;
    }
    function resolve(turn,delta,newTokens={}){
        const beforeStats={...stats},beforeTokens={...tokens};stats={...stats,experience:stats.experience+delta};tokens={...tokens,...newTokens};add(turn,'resolve',{beforeStats,afterStats:stats,beforeTokens,afterTokens:tokens});
    }
    for(let turn=0;turn<8;turn++){
        if(turn===0)for(let no=1;no<=5;no++)acquire(turn,no);
        choose(turn,turn===0?[0,1]:turn===1?[2]:[0]);
        if(turn===1)choose(turn,[],true);
        add(turn,'draw',{requested:4,cards:[]});
        if(turn===0){resolve(turn,1);resolve(turn,0,{inspiration:1});}
        if(turn===1){resolve(turn,1);resolve(turn,0,{organize:1});}
        if(turn===0||turn===1){const [id,c]=[...owned].find(([,c])=>c.cardNo===(turn===0?'1':'6'));add(turn,'delete',{card:c});owned.delete(id);}
        tokens.organize=0;
    }
    return {metadata:{difficulty:'fresh',source:'autoplay',catalog,seed:'private-value',randomState:{private:'private-value'}},events,result:{score:{displayScore:-3,points:-3,...stats,withdrawal:24,enrollmentDiff:-24,rank:{grade:'E'}},finalDeck:[...owned.values()]}};
}
test('全8ターンの取得・発想辞退・削除を記録から照合し、行動と結果を分離する',()=>{
    const r=fixture(),d=extractFreshAhiruRows(r,{gameId:'game-0'});assert.equal(d.publicRows.filter(row=>row.phase==='acquisition').length,9);assert.equal(d.publicRows.filter(row=>row.phase==='deletion').length,4);
    const meeting=d.publicRows.find(row=>row.phase==='deletion'&&row.observation.turn===1);assert.equal(meeting.deleteMax,2);assert.ok(meeting.observation.owned.some(card=>card.cardNo==='6'));assert.deepEqual(d.labels.find(label=>label.rowId===meeting.rowId).action.cardNos,['6']);
    assert.ok(d.labels.some(label=>label.action.skipped));assert.equal(d.outcome.score,-3);assert.equal(JSON.stringify(d.publicRows).includes('private-value'),false);assert.equal(JSON.stringify(d.publicRows).includes('fixture-id'),false);
    assert.equal(d.publicRows.some(row=>'action' in row||'score' in row),false);
});
test('私用seed・乱数を読まず、最終得点のラベルを変えても公開判断を変えない',()=>{
    const r=fixture();for(const key of ['seed','randomState'])Object.defineProperty(r.metadata,key,{get(){throw Error('private');}});
    for(const e of r.events.filter(e=>e.observation))Object.defineProperty(e.observation,'outcome',{get(){throw Error('future');}});
    const before=extractFreshAhiruRows(r,{gameId:'game-0'});r.result.score.displayScore=7;const after=extractFreshAhiruRows(r,{gameId:'game-0'});assert.deepEqual(after.publicRows,before.publicRows);assert.deepEqual(after.labels,before.labels);assert.equal(after.outcome.score,7);
});
test('解決前の数値・所有札・消費トークン・実削除・最終値の不一致を拒否する',()=>{
    for(const change of [r=>r.events.find(e=>e.type==='resolve').beforeStats.accounting++,r=>r.events.find(e=>e.type==='acquisition-decision').observation.owned.pop(),r=>r.events.find(e=>e.type==='draw').requested++,r=>r.events.find(e=>e.type==='delete').card.instanceId='missing',r=>r.events.find(e=>e.type==='acquisition-decision').chosenIndices=[0,0],r=>r.result.score.satisfaction++,r=>r.result.finalDeck.pop(),r=>r.events[0].sequence=9,r=>r.truncated=true,r=>r.metadata.reroll={attempts:2}]){const r=fixture();change(r);assert.throws(()=>extractFreshAhiruRows(r,{gameId:'game-0'}));}
});
