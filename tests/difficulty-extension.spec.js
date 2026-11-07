import { test, expect } from './fixtures.js';

test('追加難易度の4配置先と6ターン設定を既存画面で使える', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForFunction(() => !!window.game?.cardManager.allCards.length);
    await page.evaluate(() => {
        const base = window.game.gameState.config;
        window.game.registerDifficulty({ ...base, id: 'test-mode', name: '検証用', turns: base.turns.slice(0, 6),
            slots: [...base.slots, { id: 'coach', name: '補助役', capacity: 1 }] });
    });
    await page.click('#btn-difficulty-test-mode'); await page.click('#start-game');
    await page.locator('#training-cards .card').nth(0).click(); await page.locator('#training-cards .card').nth(1).click();
    await page.click('#confirm-training');
    await expect(page.locator('.staff-slot')).toHaveCount(4);
    await page.click('#btn-slot-manual'); await page.locator('#hand-cards .card').first().click(); await page.click('#slot-coach');
    await expect(page.locator('#slot-coach .card')).toHaveCount(1);
    expect(await page.evaluate(() => [window.game.gameState.difficulty, window.game.gameState.totalTurns])).toEqual(['test-mode', 6]);
});

test('通常のカード演出中に再読み込みしても解決した効果を再適用しない', async ({ page }) => {
    page.on('dialog', dialog => dialog.accept());
    await page.goto('/index.html'); await page.click('#start-game');
    await page.locator('#training-cards .card').nth(0).click(); await page.locator('#training-cards .card').nth(1).click();
    await page.click('#confirm-training'); await page.locator('#hand-cards .card').first().click(); await page.click('#confirm-action');
    const resolved = await page.evaluate(() => ({ ...window.game.gameState.player, deck: undefined, hand: undefined, placed: undefined, zones: undefined }));
    await page.reload();
    await page.waitForFunction(() => window.game?.gameState.phase === 'meeting');
    const after = await page.evaluate(() => ({ ...window.game.gameState.player, deck: undefined, hand: undefined, placed: undefined, zones: undefined }));
    expect(after).toEqual(resolved);
});
