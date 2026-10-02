import { test, expect } from './fixtures.js';
async function startAction(page) {
    page.on('dialog', dialog => dialog.accept());
    await page.goto('/'); await page.click('#start-game'); await page.waitForSelector('#training-cards .card');
    await page.locator('#training-cards .card').nth(0).click(); await page.locator('#training-cards .card').nth(1).click();
    await page.click('#confirm-training');
}

test('390×844で8枚の通常手札とステータス・配置・実行ボタンを一望できる', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await startAction(page);
    await page.evaluate(() => {
        const game = window.game;
        game.gameState.player.hand = Array.from({ length: 8 }, (_, index) => ({ ...game.cardManager.getBasicCards()[index % 5] }));
        game.uiController.renderHand();
    });
    await expect.poll(() => page.locator('#hand-cards').evaluate(el => parseFloat(el.style.maxHeight) > 0)).toBe(true);
    await expect.poll(() => page.locator('#hand-cards').evaluate(el => el.scrollHeight <= el.clientHeight + 2)).toBe(true);
    const bounds = await page.locator('#confirm-action').boundingBox(); expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
    expect((await page.locator('#full-status-panel').boundingBox()).y).toBeGreaterThanOrEqual(0);
});

test('360×740の多数手札は手札内をスクロールし実行ボタンを隠さない', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 }); await startAction(page);
    await page.evaluate(() => {
        const game = window.game; game.gameState.player.hand = Array.from({ length: 24 }, () => ({ ...game.cardManager.getBasicCards()[0] }));
        game.uiController.renderHand();
    });
    await expect.poll(() => page.locator('#hand-cards').evaluate(el => parseFloat(el.style.maxHeight) > 0)).toBe(true);
    await expect.poll(() => page.locator('#hand-cards').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    const bounds = await page.locator('#confirm-action').boundingBox(); expect(bounds.y + bounds.height).toBeLessThanOrEqual(740);
});

test('配置済みの短縮表示に目印があり長押し後のclickで取り消さない', async ({ page }) => {
    await startAction(page);
    await page.evaluate(() => {
        const game = window.game; const card = { ...game.cardManager.getBasicCards()[0], topEffect: '要約', effect: '体験+2。〈室長〉体験+3。' };
        game.gameState.player.placed.leader = [card]; game.uiController.renderStaffSlot('leader');
    });
    const card = page.locator('#slot-leader .card');
    await expect(card.locator('.card-effect')).toHaveText('要約'); await expect(card.locator('.card-detail-hint')).toBeVisible();
    await card.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0, clientX: 20, clientY: 20 });
    await page.clock.fastForward(550);
    await card.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true }); await card.dispatchEvent('click');
    await expect(page.locator('.effect-tooltip')).toContainText('〈室長〉体験+3');
    await expect(page.locator('#slot-leader .card')).toHaveCount(1);
});

test('通常演出・カードごとのタップ・まとめてスキップでイベントを含む効果と所在が一致する', async ({ page }) => {
    test.setTimeout(60000);
    await startAction(page);
    const results = await page.evaluate(async () => {
        const { getCurrentEvent, createEventState } = await import('./js/eventManager.js?v=test');
        const game = window.game, ui = game.uiController;
        const outputs = [];
        for (const skip of ['none', 'card', 'turn']) {
            game.gameState.reset('pro', { seed: 'animation-equivalence' });
            game.gameState.phase = 'action'; game.gameState.turn = 7; game.gameState.player.experience = 10;
            game.gameState.player.placed.leader = Array.from({ length: 3 }, () => ({ cardName: '確認', category: '動員', effect: '体験+3、情熱2' }));
            game.gameState.event = createEventState(getCurrentEvent(), 'pro');
            const items = game.gameState.event.items;
            items['press-coverage'].acquired = true; items['spring-homework'].acquired = true;
            items['spring-homework'].activationReservations = [{ reservationId: 'previous-homework', conditionTurn: 6, creationOrder: 0, status: 'pending' }];
            const before = { experience: 10, enrollment: 0, satisfaction: 3, accounting: 5 };
            const action = game.turnManager.executeActions(); const after = { ...action.cardEffects.leader.afterStats };
            const observer = new MutationObserver(() => { if (skip === 'card') document.querySelector('.animation-card-item')?.click(); });
            observer.observe(document.getElementById('animation-cards'), { childList: true, subtree: true });
            const animation = ui.showStatusAnimation(before, after, action);
            if (skip === 'turn') document.getElementById('btn-animation-skip').click();
            await animation;
            observer.disconnect();
            outputs.push({ stats: [game.gameState.player.experience, game.gameState.player.enrollment, game.gameState.player.satisfaction, game.gameState.player.accounting],
                tokens: { ...game.gameState.tokens }, cards: game.gameState.getOwnedCards().map(card => card.cardName), phase: game.gameState.phase,
                items: structuredClone(items), savedPhase: game.saveManager.load()?.gameState.phase ?? null });
        }
        return outputs;
    });
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toEqual(results[2]);
    expect(results[0].items['press-coverage'].usageTotal).toBe(1);
    expect(results[0].items['spring-homework'].resolvedActivationCount).toBe(1);
});

test('効果適用後に中断した発動予約は復帰時に解決済みになり二重適用しない', async ({ page }) => {
    await startAction(page);
    await page.evaluate(async () => {
        const { getCurrentEvent, createEventState } = await import('./js/eventManager.js?v=test');
        const game = window.game, state = game.gameState;
        state.turn = 7; state.phase = 'action'; state.player.experience = 20; state.player.enrollment = 7;
        state.event = createEventState(getCurrentEvent(), state.difficulty);
        const item = state.event.items['spring-homework']; item.acquired = true; item.usageTotal = 1; item.usageThisTurn = 1;
        item.activationReservations = [{ reservationId: 'applied', conditionTurn: 6, creationOrder: 0, status: 'resolving', effectApplied: true }];
        state.pendingAction = { turn: 7, actionInfo: {} }; state.event.actionCompletion = { turn: 7, status: 'resolving' };
        game.uiController.saveGameState();
    });
    await page.reload(); await expect(page.locator('#result-area')).toBeVisible();
    const restored = await page.evaluate(() => ({ enrollment: window.game.gameState.player.enrollment, item: window.game.gameState.event.items['spring-homework'] }));
    expect(restored.enrollment).toBe(7); expect(restored.item.usageTotal).toBe(1);
    expect(restored.item.activationReservations[0].status).toBe('resolved'); expect(restored.item.resolvedActivationCount).toBe(1);
});
