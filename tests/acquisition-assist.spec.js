import { test, expect } from './fixtures.js';
async function training(page) {
    await page.clock.pauseAt(new Date('2026-08-20T03:00:01Z'));
    await page.goto('/'); await page.click('#start-game');
    await page.waitForSelector('#training-cards .card');
    await expect.poll(()=>page.evaluate(()=>!!window.game.uiController.acquisitionAssist.context)).toBe(true);
}
const glow=page=>page.locator('#training-cards .acquisition-recommended');
test('初期オン、5秒後に2枚を強調し、通常の選択・状態を変更しない',async({page})=>{
    await training(page);
    const before=await page.evaluate(()=>JSON.stringify(window.game.gameState));
    await page.clock.runFor(4999); await expect(glow(page)).toHaveCount(0);
    await page.clock.runFor(1); await expect(glow(page)).toHaveCount(2);
    expect(await page.evaluate(()=>JSON.stringify(window.game.gameState))).toBe(before);
    await expect(page.locator('#training-cards .selected')).toHaveCount(0);
    await expect(page.locator('#confirm-training')).toBeDisabled();
    await expect(glow(page).first()).toHaveAttribute('aria-label',/^おすすめ。/);
    await glow(page).first().click();
    await expect(page.locator('#training-cards .selected')).toHaveCount(1);
    await expect(glow(page)).toHaveCount(2);
    await expect.poll(()=>glow(page).first().evaluate(card=>getComputedStyle(card).boxShadow)).toContain('123, 198, 246');
});
test('設定オフを保持し、提示から5秒経過後にオンへ戻すとすぐ強調する',async({page})=>{
    await training(page); await page.click('#btn-settings-full');
    await page.click('[data-acquisition-assist=off]'); await page.click('.info-overlay-close');
    await page.clock.runFor(6000); await expect(glow(page)).toHaveCount(0);
    await page.reload(); await page.waitForSelector('#training-cards .card');
    await page.clock.runFor(6000); await expect(glow(page)).toHaveCount(0);
    await page.click('#btn-settings-full'); await page.click('[data-acquisition-assist=on]'); await page.click('.info-overlay-close');
    await page.clock.runFor(1); await expect(glow(page)).toHaveCount(2);
});
test('候補の再提示・中断復帰は5秒を数え直し、確定後はタイマーを解除する',async({page})=>{
    await training(page); await page.clock.runFor(5000); await expect(glow(page)).toHaveCount(2);
    await page.reload(); await page.waitForSelector('#training-cards .card');
    await expect(glow(page)).toHaveCount(0); await page.clock.runFor(5000); await expect(glow(page)).toHaveCount(2);
    await page.evaluate(()=>{const g=window.game;g.uiController.renderTrainingCards(g.gameState.currentTrainingCards)});
    await expect(glow(page)).toHaveCount(0); await page.clock.runFor(4999); await expect(glow(page)).toHaveCount(0);
    await page.locator('#training-cards .card').nth(0).click(); await page.locator('#training-cards .card').nth(1).click();
    await page.click('#confirm-training'); await page.clock.runFor(6000);
    await expect(glow(page)).toHaveCount(0);
    const decision=await page.evaluate(()=>window.game.gameState.playRecord.events.filter(e=>e.type==='acquisition-decision'));
    expect(decision).toHaveLength(1); expect(decision[0].chosenIndices).toEqual([0,1]);
    expect(decision[0].observation).not.toHaveProperty('seed');
});
test('推薦理由を長押し詳細で確認しても選択されない',async({page})=>{
    await training(page); await page.clock.runFor(5000);
    await glow(page).first().locator('.card-detail-hint').click();
    await expect(page.locator('.tooltip-assist')).toContainText('取得アシスト');
    await expect(page.locator('#training-cards .selected')).toHaveCount(0);
});
test('発想追加取得を再提示するたびに比較し、PROでは表示しない',async({page})=>{
    await training(page);
    await page.evaluate(()=>{ const g=window.game;g.gameState.turn=2;g.gameState.tokens.inspiration=2;g.uiController.startInspirationTrainingFlow(); });
    await page.clock.runFor(5000); await expect(glow(page)).toHaveCount(1);
    await page.locator('#training-cards .card').first().click(); await page.click('#confirm-training');
    await expect(glow(page)).toHaveCount(0); await page.clock.runFor(5000); await expect(glow(page)).toHaveCount(1);
    await page.evaluate(async()=>{const g=window.game;await g.setDifficulty('pro');g.gameState.reset('pro');g.gameState.phase='training';g.uiController.showInitialTraining();});
    await page.clock.runFor(6000); await expect(glow(page)).toHaveCount(0);
});
test('コストを払えない発想候補では辞退を強調し、取得せずに確定できる',async({page})=>{
    await training(page);
    const owned=await page.evaluate(()=>{
        const g=window.game;g.gameState.turn=7;
        Object.assign(g.gameState.player,{experience:0,enrollment:0,satisfaction:0,accounting:0});
        g.gameState.tokens.inspiration=1;
        g.uiController.drawInspirationCandidates=()=>[22,26,32].map(no=>g.cardManager.allCards.find(c=>Number(c.cardNo)===no));
        g.uiController.startInspirationTrainingFlow();
        return g.gameState.getOwnedCards().length;
    });
    await page.clock.runFor(4999);await expect(glow(page)).toHaveCount(0);
    await page.clock.runFor(1);await expect(glow(page)).toHaveCount(1);
    await expect(glow(page)).toHaveClass(/skip-option/);
    await expect(page.locator('#confirm-training')).toBeDisabled();
    await glow(page).click();await page.click('#confirm-training');
    const result=await page.evaluate(()=>({count:window.game.gameState.getOwnedCards().length,
        decision:window.game.gameState.playRecord.events.filter(e=>e.type==='acquisition-decision').at(-1)}));
    expect(result.count).toBe(owned);expect(result.decision.chosenIndices).toEqual([]);
    expect(result.decision.advice.recommended.skip).toBe(true);
});
test.describe('実時間での数式計算',()=>{
    test.use({testDate:null});
    test('公開済み状態だけで候補全体を500ms未満で計算する',async({page})=>{
        await page.goto('/'); await page.click('#start-game'); await page.waitForSelector('#training-cards .card');
        const timing=await page.evaluate(async()=>{
            const module=await import('/js/freshAcquisitionAdvisor.js?v='+window.BUILD_VERSION.slice(1));
            const g=window.game;const observation=module.createAdvisorObservation(g.gameState,g.gameState.currentTrainingCards,{pickCount:2});
            const values=[];
            for(let i=0;i<30;i++){const start=performance.now();module.recommendAcquisition(observation);values.push(performance.now()-start);}
            values.sort((a,b)=>a-b); return {p95:values[28],max:values.at(-1)};
        });
        expect(timing.p95).toBeLessThan(100); expect(timing.max).toBeLessThan(500);
    });
});
