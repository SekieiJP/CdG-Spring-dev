import { defineConfig, devices } from '@playwright/test';
import { release } from 'node:os';

// Playwright 1.58のWebKitはmacOS 14以降。古いMacでは端末寸法のみ検証し、CIでWebKitを実行する。
const supportsWebKit = process.platform !== 'darwin' || Number.parseInt(release(), 10) >= 23;
if (!supportsWebKit) console.warn('SafariのWebKit検証はこのmacOSでは非対応です。ローカルはiPhone 12の寸法をChromiumで検証し、CIはWebKitで検証します。');

export default defineConfig({
    testDir: './tests',
    testMatch: '**/*.spec.js',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: `http://127.0.0.1:${process.env.CDG_TEST_PORT || 18080}`,
        serviceWorkers: 'block',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: supportsWebKit ? 'iphone12-safari' : 'iphone12-layout',
            use: { ...devices['iPhone 12'], browserName: supportsWebKit ? 'webkit' : 'chromium' },
        },
        {
            name: 'android-chrome',
            use: { ...devices['Pixel 5'] },
        },
    ],
    webServer: {
        command: 'node scripts/test-server.mjs',
        url: `http://127.0.0.1:${process.env.CDG_TEST_PORT || 18080}`,
        reuseExistingServer: false,
        timeout: 30 * 1000,
    },
});
