import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CardManager} from '../../game/js/cardManager.js?v=20261107-0061';
import {ScoreManager} from '../../game/js/scoreManager.js?v=20261107-0061';
import {DEFAULT_TURNS} from '../../game/js/defaultRules.js?v=20261107-0061';
import {recommendAcquisition} from '../../game/js/proAcquisitionAdvisor.js?v=20261107-0061';
import {alignProAcquisition} from '../../game/js/proAcquisitionConsistency.js?v=20261107-0061';
import {recommendProStatus} from '../../game/js/ahiruProAdvice.js?v=20261107-0061';
const manager=new CardManager(null);manager.parseCSV(readFileSync(new URL('../../game/data/cards_pro.csv',import.meta.url),'utf8'));
const scorer=new ScoreManager(null),originalFetch=globalThis.fetch;
globalThis.fetch=async()=>({ok:true,text:async()=>readFileSync(new URL('../../game/data/rankPro.csv',import.meta.url),'utf8')});
await scorer.loadRankData('file');globalThis.fetch=originalFetch;
const calibration=JSON.parse(readFileSync(new URL('../../game/data/ahiru/pro-projection-calibration.json',import.meta.url)));
const options={calibration,versions:{cardVersion:calibration.cardVersion,rankVersion:calibration.rankVersion}};
const card=no=>({...manager.allCards.find(c=>Number(c.cardNo)===no),acquiredTurn:0});
const observation=()=>({difficulty:'pro',mode:'normal',turn:1,totalTurns:8,stats:{experience:5,enrollment:2,satisfaction:5,accounting:5},tokens:{passion:0,fatigue:0,inspiration:0,organize:0},owned:[2,3,4,5,8,13].map(card),candidates:[25,36,39].map(card),pickCount:1,allowSkip:false,turns:DEFAULT_TURNS.map(t=>({recommended:t.recommended,recommendedStatus:t.recommendedStatus})),rankTable:scorer.rankTable});
test('経理不足を補いSへの距離を広げない候補を優先し、その中のS+順位は維持する',()=>{
    const input=observation(),base=recommendAcquisition(input),aligned=alignProAcquisition(input,base,options);
    assert.deepEqual(base.recommended.cardNos,['25']);assert.deepEqual(aligned.recommended.cardNos,['36']);
    assert.equal(recommendProStatus(input,options).axis,'accounting');assert.equal(aligned.alignment.focusAxis,'accounting');
    assert.equal(aligned.alignment.changedRecommendation,true);assert.equal(aligned.recommended.alignment.complements,true);
    assert.deepEqual(aligned.evaluations.map(e=>e.cardNos[0]),['36','39','25']);assert.equal(aligned.targetRank,'S+');
});
test('不足を補える候補がない場合は元の推薦を維持する',()=>{
    const input=observation();input.candidates=[card(25)];
    const base=recommendAcquisition(input),aligned=alignProAcquisition(input,base,options);
    assert.equal(aligned.alignment.availableComplement,false);assert.equal(aligned.alignment.changedRecommendation,false);
    assert.deepEqual(aligned.recommended.indices,base.recommended.indices);
});
test('公開入力・元の評価・補正を変更せず、seedや未来を参照しない',()=>{
    const input=observation(),base=recommendAcquisition(input),before=JSON.stringify({input,base,options});
    for(const key of ['seed','rng','deckOrder','outcome'])Object.defineProperty(input,key,{get(){throw Error('private');}});
    alignProAcquisition(input,base,options);assert.equal(JSON.stringify({input,base,options}),before);
    const incompatible={...options,versions:{cardVersion:'other',rankVersion:'other'}};
    assert.deepEqual(alignProAcquisition(input,base,incompatible),alignProAcquisition(input,base));
});
test('最初の2枚は組合せで評価し、辞退・既存S・対象外モードも壊さない',()=>{
    const input=observation();input.turn=0;input.stats={experience:0,enrollment:0,satisfaction:3,accounting:5};
    input.owned=[1,2,3,4,5].map(card);input.candidates=[6,13,15,17].map(card);input.pickCount=2;
    const aligned=alignProAcquisition(input,recommendAcquisition(input),options);
    assert.equal(aligned.evaluations.length,6);assert.ok(aligned.evaluations.every(e=>e.indices.length===2));
    input.turn=7;input.pickCount=1;input.allowSkip=true;input.stats={experience:50,enrollment:40,satisfaction:25,accounting:15};
    const base=recommendAcquisition(input),safe=alignProAcquisition(input,base,options);assert.deepEqual(safe.recommended.indices,base.recommended.indices);
    for(const change of [{difficulty:'fresh'},{mode:'calculator'},{mode:'event'}])assert.equal(alignProAcquisition({...input,...change},base,options),base);
});
