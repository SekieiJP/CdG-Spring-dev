import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CardManager} from '../../game/js/cardManager.js?v=20261107-0064';
import {DEFAULT_TURNS} from '../../game/js/defaultRules.js?v=20261107-0064';
import {explainAcquisitionCandidates} from '../../game/js/acquisitionExplanation.js?v=20261107-0064';
const managers=Object.fromEntries(['fresh','pro'].map(difficulty=>{const m=new CardManager(null);m.parseCSV(readFileSync(new URL(`../../game/data/cards_${difficulty}.csv`,import.meta.url),'utf8'));return[difficulty,m];}));
function scene({difficulty='pro',turn=1,owned=[1,2,3,4,5],candidates=[14,31,32],recommended=[0],stats={experience:5,enrollment:0,satisfaction:6,accounting:7},status={},features={points:1},forecast=stats}={}){
    const card=no=>({...managers[difficulty].allCards.find(c=>Number(c.cardNo)===no),acquiredTurn:0});
    return {observation:{difficulty,mode:'normal',turn,totalTurns:8,stats:{...stats},tokens:{passion:0,fatigue:0,inspiration:0,organize:0},owned:owned.map(card),candidates:candidates.map(card),pickCount:recommended.length||1,allowSkip:false,turns:DEFAULT_TURNS.map(t=>({...t,deletion:t.delete}))},
        advice:{recommended:{indices:recommended,score:10,features,forecast:{...forecast}}},status:{outlookReason:'on-track-grow',forecast:{rawEnd:{...forecast}},...status}};
}
const explain=input=>explainAcquisitionCandidates(input);
test('写真2の教室清掃は、非推奨でも注意点がなければ何も表示しない',()=>{
    const input=scene({candidates:[41,20,31],recommended:[1]});
    const messages=explain(input);assert.equal(messages[2].text,'');
    assert.ok(messages.every(m=>!/(?:比較評価|推奨理由|寄与|ドロー・並行配置・圧縮|を評価しています)/.test(m.text)));
});
test('非推奨は経理コストと発動準備だけを短く伝え、取得を否定しない',()=>{
    const input=scene({candidates:[14,32,43],recommended:[0]});
    let messages=explain(input);assert.match(messages[1].text,/^🐤経理を消費するので注意$/);
    input.observation.stats.accounting=0;messages=explain(input);assert.match(messages[2].text,/使う前に経理を増やして/);
    assert.ok(messages.every(m=>!/(?:取らない|取得しない|選ばない|弱いカード)/.test(m.text)));
});
test('体験の空きに応じて入塾カードの準備を案内し、自分で体験を増やせるカードは誤判定しない',()=>{
    const input=scene({candidates:[14,25,18],recommended:[0],stats:{experience:5,enrollment:5,satisfaction:15,accounting:15}});
    let messages=explain(input);assert.match(messages[1].text,/他のカードで体験を増やして/);assert.equal(messages[2].text,'');
    input.observation.stats.enrollment=0;messages=explain(input);assert.equal(messages[1].text,'');
});
test('同じ条件でも、推薦には所持カードとの組み合わせを説明する',()=>{
    const input=scene({candidates:[25,14,31],recommended:[0],stats:{experience:5,enrollment:5,satisfaction:15,accounting:15},forecast:{experience:20,enrollment:20,satisfaction:20,accounting:20}});
    const message=explain(input)[0];assert.equal(message.reason,'owned-experience');assert.match(message.text,/所持カードと組み合わせ/);
});
test('満足を増やして所持カードの条件を満たせる時だけ、相性を説明する',()=>{
    const input=scene({owned:[20],candidates:[12,6,15],recommended:[0],stats:{experience:10,enrollment:0,satisfaction:9,accounting:5}});
    let message=explain(input)[0];assert.equal(message.reason,'owned-condition');assert.match(message.text,/満足が条件の所持カードと相性/);
    input.observation.owned=[];message=explain(input)[0];assert.notEqual(message.reason,'owned-condition');
    input.observation.owned=[managers.pro.allCards.find(c=>Number(c.cardNo)===20)];input.observation.stats.satisfaction=2;
    assert.notEqual(explain(input)[0].reason,'owned-condition');
});
test('条件未達でも、所有済みの供給で準備できる見込みがある推薦は、その前提を示す',()=>{
    const input=scene({owned:[4,12],candidates:[20,31,25],recommended:[0],stats:{experience:5,enrollment:0,satisfaction:6,accounting:5},forecast:{experience:10,enrollment:5,satisfaction:15,accounting:10}});
    const message=explain(input)[0];assert.equal(message.reason,'owned-preparation');assert.match(message.text,/所持カードで満足を増やすと/);
});
test('初回の組み合わせの理由を他のカードへ転用せず、一緒に取るカードとの関係を示す',()=>{
    const input=scene({turn:0,owned:[3,4,5],candidates:[14,25,16,6],recommended:[0,1],stats:{experience:0,enrollment:0,satisfaction:3,accounting:5},forecast:{experience:15,enrollment:15,satisfaction:15,accounting:15},status:{focusAxis:'experience',outlookReason:'initial-experience-foundation'}});
    const messages=explain(input);assert.equal(messages[0].reason,'opening-foundation');assert.equal(messages[1].reason,'pair-experience');
    assert.doesNotMatch(messages[1].text,/経理|序盤の体験づくり/);
});
test('残りターンと手持ち枚数で、長期利用・手数・最終得点の説明を切り替える',()=>{
    const long=scene({turn:0,owned:[1,2,4,5],candidates:[8,31,25],recommended:[0],stats:{experience:20,enrollment:0,satisfaction:10,accounting:10}});
    assert.equal(explain(long)[0].reason,'long-use');long.observation.turn=7;assert.equal(explain(long)[0].reason,'remaining-score');
    const large=scene({owned:[1,2,3,4,5,6,7,8],candidates:[31,14,25],recommended:[0]});
    assert.equal(explain(large)[0].reason,'hand-pressure');large.observation.turn=7;assert.notEqual(explain(large)[0].reason,'hand-pressure');
    const parallel=scene({candidates:[15,14,25],recommended:[0]});assert.equal(explain(parallel)[0].reason,'placement-pressure');
});
test('不足する効果が候補になく、別の数値で補う選択の場合だけ、代案として説明する',()=>{
    const input=scene({candidates:[16,10,9],recommended:[0],status:{focusAxis:'satisfaction',actionAxis:'accounting',outlookReason:'shortage'}});
    assert.equal(explain(input)[0].reason,'missing-role'); // 備品注文は満足も伸ばすため代案扱いにしない。
    input.observation.candidates[0]=managers.pro.allCards.find(c=>Number(c.cardNo)===37);
    assert.equal(explain(input)[0].reason,'alternative-role');assert.match(explain(input)[0].text,/今回は経理を補う選び方もアリ/);
});
test('疲労・条件未達の注意は現在の発動と残り日程に合わせる',()=>{
    const input=scene({candidates:[14,26,20],recommended:[0],stats:{experience:20,enrollment:0,satisfaction:6,accounting:7}});
    assert.equal(explain(input)[1].reason,'fatigue');assert.match(explain(input)[2].text,/満足10以上/);
    input.observation.stats.accounting=0;assert.match(explain(input)[2].text,/いまは.*条件を満たしていない/);assert.doesNotMatch(explain(input)[2].text,/使える/);
    input.observation.stats.accounting=7;
    input.observation.turn=7;assert.equal(explain(input)[1].text,'');
    input.observation.candidates[2]=managers.pro.allCards.find(c=>Number(c.cardNo)===51);assert.equal(explain(input)[2].reason,'late-condition');
});
test('説明は公開スナップショットを変更せず、乱数・将来順・実結果を参照しない',()=>{
    for(const difficulty of ['fresh','pro']){
        const input=scene({difficulty}),before=JSON.stringify(input);
        for(const key of ['seed','rng','deckOrder','outcome','trainingDecks'])Object.defineProperty(input.observation,key,{get(){throw Error('private');}});
        const messages=explain(input);assert.equal(JSON.stringify(input),before);
        for(const message of messages){assert.ok(message.text===''||message.text.startsWith('🐤'));assert.ok(Array.from(message.text).length<=45);}
    }
});
