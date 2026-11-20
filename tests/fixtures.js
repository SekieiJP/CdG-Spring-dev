import { test as base, expect } from '@playwright/test';

export { expect };
export const test = base.extend({
    testDate: ['2026-08-20T03:00:00Z', { option: true }],
    gameSeed: ['browser-test-20261002', { option: true }],
    sharingAccepted: [true, { option: true }],
    scoreSubmissions: async ({}, use) => { await use([]); },
    _isolatedServices: [async ({ context, baseURL, scoreSubmissions, sharingAccepted }, use) => {
        if (sharingAccepted) await context.addInitScript(() => {
            if (localStorage.getItem('cdg_sharing_preference_v1') === null) {
                localStorage.setItem('cdg_sharing_preference_v1', JSON.stringify({
                    enabled: true, nickname: 'sekiei', grantId: 'test-grant', token: 'test-token'
                }));
            }
        });
        await context.route('**/*', async route => {
            const request = route.request();
            const url = new URL(request.url());
            if (url.origin === new URL(baseURL).origin) { await route.fallback(); return; }
            if (url.hostname === 'script.google.com' && request.method() === 'POST') {
                const payload = JSON.parse(request.postData());
                if (payload.action === 'sharing.enable') {
                    await route.fulfill({ json: { status: 'ok', grantId: 'test-grant', token: 'test-token' } });
                    return;
                }
                if (payload.action && payload.action !== 'score.submit') {
                    await route.fulfill({ json: { status: 'ok', entries: [], nextBefore: null } });
                    return;
                }
                scoreSubmissions.push(payload);
                await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
                    status: 'ok', turnHistoryStored: true, diaryStored: Boolean(payload.replayText), currentVersion: payload.buildVersion, clientVersion: payload.buildVersion, versionMatch: true
                }) });
                return;
            }
            // Analyticsも含め、通常テストは実際の外部サービスへ接続しない。
            await route.abort('blockedbyclient');
        });
        await use();
    }, { auto: true }],
    _testClock: [async ({ page, testDate, gameSeed }, use) => {
        await page.addInitScript(seed => { window.CDG_GAME_SEED = seed; }, gameSeed);
        if (testDate) await page.clock.install({ time: new Date(testDate) });
        await use();
    }, { auto: true }]
});
