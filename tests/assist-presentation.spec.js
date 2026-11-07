import {test,expect} from './fixtures.js';
async function start(page,difficulty='fresh'){
    await page.clock.pauseAt(new Date('2026-08-20T03:00:01Z'));await page.goto('/');
    await page.waitForFunction(()=>window.game?.uiController.acquisitionAssist.container&&window.game.scoreManager.rankTable.length);
    if(difficulty==='pro')await page.click('.difficulty-btn[data-difficulty="pro"]');
    await page.click('#start-game');await page.waitForFunction(()=>window.game.uiController.acquisitionAssist.context);
}
async function longPress(page,card){
    await card.dispatchEvent('pointerdown',{pointerType:'touch',isPrimary:true,button:0,clientX:20,clientY:20});
    await page.clock.runFor(550);
    await card.dispatchEvent('pointerup',{pointerType:'touch',isPrimary:true});
    await expect(page.locator('.effect-tooltip')).toBeVisible();
}
for(const difficulty of ['fresh','pro']){
    test(`${difficulty}: 推奨より選択の青枠を優先し、解除すると黄色の輪郭へ戻る`,async({page},info)=>{
        await start(page,difficulty);
        const first=await page.evaluate(()=>window.game.uiController.acquisitionAssist.context.advice.recommended.indices[0]);
        const card=page.locator('#training-cards .card').nth(first),before=await card.boundingBox();
        await card.click();await expect(card).toHaveCSS('border-color','rgb(59, 130, 246)');
        await page.clock.runFor(5000);await expect(card).toHaveClass(/acquisition-recommended/);
        await expect(card).toHaveCSS('outline-color','rgb(59, 130, 246)');await expect(card).toHaveCSS('outline-width','2px');
        const other=page.locator('#training-cards .acquisition-recommended:not(.selected)');
        await expect(other).toHaveCount(1);await expect(other).toHaveCSS('outline-color','rgb(253, 224, 71)');
        await expect.poll(()=>card.evaluate(el=>getComputedStyle(el).boxShadow)).toContain('253, 224, 71');
        expect((await card.boundingBox()).width).toBe(before.width);
        await page.screenshot({path:`solver/local-evaluation/assist-feedback-20261107/selection-${difficulty}-${info.project.name}.png`,animations:'disabled'});
        await card.click();await expect(card).not.toHaveClass(/selected/);await expect(card).toHaveCSS('outline-color','rgb(253, 224, 71)');
        await card.click();await expect(card).toHaveCSS('outline-color','rgb(59, 130, 246)');
        await expect(page.locator('#training-cards .selected')).toHaveCount(1);
    });
}
test('長押しの推薦理由は場面に合う一文で、非推奨の教室清掃は空欄、経理コストだけ注意する',async({page},info)=>{
    await start(page,'pro');
    await page.evaluate(()=>{
        const g=window.game,s=g.gameState;s.turn=7;s.phase='training';s.tokens={passion:0,fatigue:0,inspiration:0,organize:0};
        Object.assign(s.player,{experience:40,enrollment:0,satisfaction:35,accounting:16});
        s.currentTrainingCards=[25,31,32].map(no=>({...g.cardManager.allCards.find(c=>Number(c.cardNo)===no)}));
        g.uiController.trainingSelectionMode='normal';g.uiController.renderTrainingCards(s.currentTrainingCards);
    });
    await expect.poll(()=>page.evaluate(()=>window.game.uiController.acquisitionAssist.context.advice.recommended.cardNos)).toEqual(['25']);
    const explanations=await page.evaluate(()=>window.game.uiController.acquisitionAssist.context.explanations);
    expect(explanations[0].text).toMatch(/^🐤.*入塾/);expect(explanations[1].text).toBe('');expect(explanations[2].text).toMatch(/^🐤.*経理.*注意/);
    await page.clock.runFor(5000);
    const card=page.locator('#training-cards .card').first();await card.click();
    await longPress(page,card);await expect(page.locator('.tooltip-assist')).toHaveText(explanations[0].text);
    await expect(page.locator('#training-cards .selected')).toHaveCount(1);
    await page.locator('.effect-tooltip').click();
    await longPress(page,page.locator('#training-cards .card').nth(1));
    await expect(page.locator('.tooltip-effect')).toContainText('情熱');await expect(page.locator('.tooltip-assist')).toBeHidden();
    await expect(page.locator('.effect-tooltip')).not.toContainText('比較評価');await page.locator('.effect-tooltip').click();
    await longPress(page,page.locator('#training-cards .card').nth(2));await expect(page.locator('.tooltip-assist')).toHaveText('🐤経理を消費するので注意');
    await page.screenshot({path:`solver/local-evaluation/assist-feedback-20261107/caution-${info.project.name}.png`,animations:'disabled'});
    expect(await page.evaluate(()=>window.game.uiController.acquisitionAssist.context.explanations)).toEqual(explanations);
});
test('説明も提示時のデッキで固定し、設定オフでは表示せず、再開時に同じ文を作る',async({page})=>{
    await start(page);await page.clock.runFor(5000);
    const before=await page.evaluate(()=>window.game.uiController.acquisitionAssist.context.explanations);
    await page.locator('#training-cards .card').first().click();
    expect(await page.evaluate(()=>window.game.uiController.acquisitionAssist.context.explanations)).toEqual(before);
    await page.evaluate(()=>window.game.uiController.acquisitionAssist.setEnabled(false));
    expect(await page.evaluate(()=>window.game.gameState.currentTrainingCards.map(card=>window.game.uiController.acquisitionAssist.explanation(card)))).toEqual(['','','','']);
    await page.evaluate(()=>window.game.uiController.acquisitionAssist.setEnabled(true));await page.clock.runFor(1);
    expect(await page.evaluate(()=>window.game.uiController.acquisitionAssist.context.explanations)).toEqual(before);
    await page.reload();await page.waitForFunction(()=>window.game?.uiController.acquisitionAssist.context);
    expect(await page.evaluate(()=>window.game.uiController.acquisitionAssist.context.explanations)).toEqual(before);
});
