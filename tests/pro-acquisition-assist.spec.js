import {test,expect} from './fixtures.js';
const glow=page=>page.locator('#training-cards .acquisition-recommended');
async function proTraining(page){
    await page.clock.pauseAt(new Date('2026-08-20T03:00:01Z'));await page.goto('/');
    await page.click('.difficulty-btn[data-difficulty="pro"]');await page.click('#start-game');
    await page.waitForSelector('#training-cards .card');
    await expect.poll(()=>page.evaluate(()=>window.game.uiController.acquisitionAssist.context?.advice?.targetRank)).toBe('S+');
}
test('PROの5秒表示・設定はFRESHと共通で、初期2枚・通常1枚を推薦する',async({page})=>{
    await proTraining(page);const before=await page.evaluate(()=>JSON.stringify(window.game.gameState));
    await page.clock.runFor(4999);await expect(glow(page)).toHaveCount(0);
    await page.clock.runFor(1);await expect(glow(page)).toHaveCount(2);
    expect(await page.evaluate(()=>JSON.stringify(window.game.gameState))).toBe(before);
    await page.click('#btn-settings-full');await expect(page.locator('.settings-section').filter({hasText:'取得アシスト'})).toContainText('FRESH・PRO');
    await page.click('[data-acquisition-assist=off]');await page.click('.info-overlay-close');await expect(glow(page)).toHaveCount(0);
    await page.click('#btn-settings-full');await page.click('[data-acquisition-assist=on]');await page.click('.info-overlay-close');await page.clock.runFor(1);await expect(glow(page)).toHaveCount(2);
    await page.evaluate(()=>{const g=window.game;g.gameState.turn=1;g.gameState.currentTrainingCards=g.cardManager.drawTrainingCards('SR',3);g.uiController.renderTrainingCards(g.gameState.currentTrainingCards);});
    await page.clock.runFor(4999);await expect(glow(page)).toHaveCount(0);await page.clock.runFor(1);await expect(glow(page)).toHaveCount(1);
});
test('PROリフレッシュは推薦を再計算し、候補の除外履歴を保存する',async({page})=>{
    await proTraining(page);await page.clock.runFor(5000);await expect(glow(page)).toHaveCount(2);
    await page.click('#btn-training-refresh');await expect(glow(page)).toHaveCount(0);
    await page.clock.runFor(4999);await expect(glow(page)).toHaveCount(0);await page.clock.runFor(1);await expect(glow(page)).toHaveCount(2);
    const before=await page.evaluate(()=>window.game.uiController.acquisitionAssist.context.observation);
    expect(before.refreshRemaining).toBe(1);expect(before.offerHistory.filter(e=>e.type==='refresh')).toHaveLength(1);
    await page.reload();await page.waitForSelector('#training-cards .card');await expect(glow(page)).toHaveCount(0);
    await page.clock.runFor(5000);await expect(glow(page)).toHaveCount(2);
    expect(await page.evaluate(()=>window.game.uiController.acquisitionAssist.context.observation)).toEqual(before);
});
test('PRO発想の辞退を推薦し、計算機・イベントでは表示しない',async({page})=>{
    await proTraining(page);
    await page.evaluate(()=>{const g=window.game;g.gameState.turn=7;Object.assign(g.gameState.player,{experience:0,enrollment:0,satisfaction:0,accounting:0});g.gameState.tokens.inspiration=1;
        g.uiController.drawInspirationCandidates=()=>[43,44,49].map(no=>g.cardManager.allCards.find(c=>Number(c.cardNo)===no));g.uiController.startInspirationTrainingFlow();});
    await page.clock.runFor(5000);await expect(glow(page)).toHaveCount(1);await expect(glow(page)).toHaveClass(/skip-option/);
    for(const mode of ['calculator','event']){
        await page.evaluate(mode=>{const g=window.game;g.gameState.calcMode=mode==='calculator';g.gameState.event=mode==='event'?{enabled:true}:null;g.uiController.acquisitionAssist.present();},mode);
        await page.clock.runFor(6000);await expect(glow(page)).toHaveCount(0);
    }
});
test.describe('PROの実時間計算',()=>{test.use({testDate:null});test('複数の所有・不足・候補を高速評価し、状態・乱数を消費しない',async({page})=>{
    await page.goto('/');await page.click('.difficulty-btn[data-difficulty="pro"]');await page.click('#start-game');await page.waitForSelector('#training-cards .card');
    const timing=await page.evaluate(async()=>{const m=await import('/js/acquisitionAdvisor.js?v='+window.BUILD_VERSION.slice(1)),g=window.game,values=[];
        const before=JSON.stringify(g.gameState);for(const turn of [0,2,5,7])for(let i=0;i<10;i++){
            const a=m.createAdvisorObservation(g.gameState,g.cardManager.allCards.filter(c=>c.rarity=== (turn===0?'R':'SSR')).slice(i%5,i%5+3),{rankTable:g.scoreManager.rankTable});
            a.turn=turn;a.stats={experience:turn*6,enrollment:turn*5,satisfaction:turn*4+3,accounting:turn*2+5};
            a.owned=g.cardManager.allCards.slice(0,Math.min(25,7+turn*2));
            const start=performance.now();m.recommendAcquisition(a);values.push(performance.now()-start);
        }values.sort((a,b)=>a-b);return{p95:values[Math.ceil(values.length*.95)-1],max:values.at(-1),unchanged:before===JSON.stringify(g.gameState)};
    });expect(timing.unchanged).toBe(true);expect(timing.p95).toBeLessThan(100);expect(timing.max).toBeLessThan(500);
});});
