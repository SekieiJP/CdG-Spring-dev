import { test, expect } from './fixtures.js';
test('保存した評価ログと乱数位置を引き継ぎ、手動出力できる', async ({ page }) => {
    await page.goto('/index.html'); await page.click('#start-game');
    await page.waitForSelector('#training-cards .card');
    const before = await page.evaluate(() => window.game.gameState.exportPlayRecord());
    expect(before.events.some(event => event.type === 'offer')).toBe(true);
    expect(before.metadata.cardVersion).toMatch(/^sha256:/);
    await page.reload();
    await page.waitForSelector('#training-cards .card');
    const restored = await page.evaluate(() => window.game.gameState.exportPlayRecord());
    expect(restored.events).toEqual(before.events);
    expect(restored.metadata.randomState).toEqual(before.metadata.randomState);
    await page.click('#btn-settings-full');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'プレイ記録をJSONで保存' }).click();
    expect((await download).suggestedFilename()).toMatch(/^cdg-play-fresh/);
});
