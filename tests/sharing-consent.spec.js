import { test, expect } from './fixtures.js';

test.use({ sharingAccepted: false });

test('初回に拒否すると完走しても送信せず、次回起動後も日誌一覧を開けない', async ({ page, scoreSubmissions }) => {
    await page.goto('/');
    await page.locator('#start-game').click();
    await expect(page.locator('#sharing-consent-overlay')).toBeVisible();
    await page.locator('#sharing-disable').click();
    await expect(page.locator('#training-cards .card').first()).toBeVisible();
    await page.evaluate(() => {
        window.game.gameState.phase = 'end';
        window.game.uiController.showResultPhase();
    });
    await expect(page.locator('#result-submission-status')).toContainText('共有オフ');
    expect(scoreSubmissions).toHaveLength(0);
    await page.locator('#restart-game').click();
    await page.reload();
    await page.locator('#start-replay-view').click();
    await expect(page.getByRole('button', {name:'他の先生の日誌'})).toBeDisabled();
    await page.locator('#replay-workshop .info-overlay-close').click();
    await page.locator('#start-game').click();
    await expect(page.locator('#training-cards .card').first()).toBeVisible();
    await expect(page.locator('#sharing-consent-overlay')).toHaveCount(0);
});

test('8文字の名前で同意でき、設定で停止すると進行中のゲームも送信しない', async ({ page, scoreSubmissions }) => {
    await page.goto('/');
    await page.locator('#start-game').click();
    await page.locator('#sharing-nickname').fill('123456789');
    await page.locator('#sharing-enable').click();
    await expect(page.locator('#sharing-consent-status')).toContainText('1〜8文字');
    await page.locator('#sharing-nickname').fill('あひる先生１２３');
    await page.locator('#sharing-enable').click();
    await expect(page.locator('#training-cards .card').first()).toBeVisible();
    await page.locator('#btn-settings-full').click();
    await page.locator('#settings-sharing-consent').click();
    await expect(page.locator('#sharing-nickname')).toHaveValue('あひる先生１２３');
    await page.locator('#sharing-disable').click();
    await expect(page.locator('#sharing-consent-overlay')).toHaveCount(0);
    await page.evaluate(() => {
        window.game.gameState.phase = 'end';
        window.game.uiController.showResultPhase();
    });
    await expect(page.locator('#result-submission-status')).toContainText('共有オフ');
    expect(scoreSubmissions).toHaveLength(0);
});

test('同意を送信中はローディングとキャンセルを表示し、取り消した応答が後で届いても同意を保存しない', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
        const originalFetch = window.fetch;
        window.sharingRequests = [];
        window.fetch = (url, options) => {
            if (!String(url).startsWith('https://script.google.com/') || JSON.parse(options?.body || '{}').action !== 'sharing.enable') {
                return originalFetch(url, options);
            }
            return new Promise(resolve => {
                window.sharingRequests.push({
                    signal: options.signal,
                    reply: grantId => resolve(new Response(JSON.stringify({ status: 'ok', grantId, token: 'test-token' })))
                });
            });
        };
    });
    await page.locator('#start-game').click();
    const decline = page.locator('#sharing-disable');
    const cancel = page.locator('#sharing-cancel');
    const status = page.locator('#sharing-consent-status');
    const enable = page.locator('#sharing-enable');
    await expect(cancel).toBeHidden();
    await page.locator('#sharing-nickname').fill('あひる先生');
    await enable.click();
    await expect(status).toHaveText('同意内容を送信しています…');
    await expect(status).toHaveClass('is-loading');
    await expect(decline).toBeDisabled();
    await expect(cancel).toBeFocused();
    await cancel.click();
    await expect(status).toHaveText('送信をキャンセルしました。');
    await expect(status).not.toHaveClass('is-loading');
    await expect(cancel).toBeHidden();
    await expect(decline).toBeEnabled();
    expect(await page.evaluate(() => window.sharingRequests[0].signal.aborted)).toBe(true);

    await enable.click();
    await expect(status).toHaveText('同意内容を送信しています…');
    await page.evaluate(() => window.sharingRequests[0].reply('cancelled'));
    await page.evaluate(() => window.sharingRequests[1].reply('accepted'));
    await expect(page.locator('#training-cards .card').first()).toBeVisible();
    expect(await page.evaluate(() => window.game.gameState.sharingGrantId)).toBe('accepted');
});
