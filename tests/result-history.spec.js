import { test, expect } from './fixtures.js';

async function start(page) {
    page.on('dialog', dialog => dialog.accept());
    await page.goto('/'); await page.click('#start-game');
    await expect(page.locator('#training-cards .card').first()).toBeVisible();
}

test('再読込みで保留結果を同じID・完了時刻・デッキのまま送信し履歴を見返せる', async ({ page, scoreSubmissions }) => {
    await start(page);
    const original = await page.evaluate(() => {
        const originalFetch = window.fetch;
        window.fetch = (...args) => String(args[0]).includes('script.google.com') ? new Promise(() => {}) : originalFetch(...args);
        const game = window.game; game.gameState.phase = 'end'; game.uiController.showResultPhase();
        return game.uiController.resultController.repository.pending()[0].payload;
    });
    await expect(page.locator('#restart-game')).toBeEnabled();
    await page.reload();
    await expect.poll(() => scoreSubmissions.length).toBe(1);
    expect(scoreSubmissions[0]).toEqual(original);
    await page.click('#start-result-history');
    await expect(page.locator('.result-history-entry')).toHaveCount(1);
    await page.locator('.result-history-entry summary').click();
    await expect(page.locator('.result-history-entry')).toContainText('スコア送信済み');
    await expect(page.locator('.result-history-entry')).toContainText(original.finalDeck[0]);
});

test('終了状態からの復帰・結果の再描画でも同じゲームを二重保存・二重送信しない', async ({ page, scoreSubmissions }) => {
    await start(page);
    const resultId = await page.evaluate(() => {
        window.game.gameState.phase = 'end'; window.game.uiController.saveGameState();
        return window.game.gameState.runId;
    });
    await page.reload(); await expect(page.locator('#result-area')).toBeVisible();
    await expect.poll(() => scoreSubmissions.length).toBe(1);
    await page.evaluate(() => window.game.uiController.showResultPhase());
    const rows = await page.evaluate(() => window.game.uiController.resultController.repository.history());
    expect(rows).toHaveLength(1); expect(rows[0].resultId).toBe(resultId); expect(scoreSubmissions).toHaveLength(1);
});

test('古い送信の完了が新しい結果の送信状態を上書きしない', async ({ page }) => {
    await start(page);
    await page.evaluate(() => {
        const originalFetch = window.fetch; window.__responses = [];
        window.fetch = (...args) => {
            if (!String(args[0]).includes('script.google.com')) return originalFetch(...args);
            return new Promise(resolve => window.__responses.push(() => resolve({ ok: true, json: async () => ({ status: 'ok' }) })));
        };
        const game = window.game; game.gameState.phase = 'end'; game.uiController.showResultPhase();
        game.gameState.reset('fresh'); game.gameState.phase = 'end'; game.uiController.showResultPhase();
    });
    await page.evaluate(() => window.__responses[0]());
    await expect.poll(() => page.evaluate(() => window.__responses.length)).toBe(2);
    await expect(page.locator('#result-submission-status')).toContainText('送信中');
    await page.evaluate(() => window.__responses[1]());
    await expect(page.locator('#result-submission-status')).toHaveText('スコア送信済み');
});
