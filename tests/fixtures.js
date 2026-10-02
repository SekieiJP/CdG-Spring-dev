import { test as base, expect } from '@playwright/test';

export { expect };
export const test = base.extend({
    testDate: ['2026-08-20T03:00:00Z', { option: true }],
    scoreSubmissions: async ({}, use) => { await use([]); },
    _isolatedServices: [async ({ context, baseURL, scoreSubmissions }, use) => {
        await context.route('**/*', async route => {
            const request = route.request();
            const url = new URL(request.url());
            if (url.origin === new URL(baseURL).origin) { await route.fallback(); return; }
            if (url.hostname === 'script.google.com' && request.method() === 'POST') {
                const payload = JSON.parse(request.postData());
                scoreSubmissions.push(payload);
                await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
                    status: 'ok', currentVersion: payload.buildVersion, clientVersion: payload.buildVersion, versionMatch: true
                }) });
                return;
            }
            // Analyticsも含め、通常テストは実際の外部サービスへ接続しない。
            await route.abort('blockedbyclient');
        });
        await use();
    }, { auto: true }],
    _testClock: [async ({ page, testDate }, use) => {
        if (testDate) await page.clock.install({ time: new Date(testDate) });
        await use();
    }, { auto: true }]
});
