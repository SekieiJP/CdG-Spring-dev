import { test, expect } from './fixtures.js';

test('PWAの起動先・表示・ホーム画面アイコンを配信する', async ({ page, request }) => {
    await page.goto('/');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    const response = await request.get(href);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('application/manifest+json');
    const manifest = await response.json();
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('./index.html');
    expect(manifest.scope).toBe('./');
    for (const size of [192, 512]) {
        const icon = manifest.icons.find(icon => icon.sizes === `${size}x${size}`);
        const dimensions = await page.evaluate(src => new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
            image.onerror = reject; image.src = src;
        }), icon.src);
        expect(dimensions).toEqual([size, size]);
    }
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', 'pwa/icon-180.png');
});

test('削除履歴と研修の使用済みカードはブラウザ再読み込みでも失わない', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-difficulty-pro'); await page.click('#start-game');
    await expect(page.locator('#training-cards .card')).toHaveCount(4);
    const before = await page.evaluate(() => {
        const game = window.game;
        game.gameState.discardedCards = ['問合対応の基本'];
        game.gameState.trainingRefreshRemaining = 1;
        game.uiController.saveGameState();
        return {
            cards: game.gameState.currentTrainingCards,
            used: game.cardManager.trainingDiscards,
            startedAt: game.gameState.startedAt
        };
    });
    await page.reload();
    await expect(page.locator('#training-cards .card')).toHaveCount(4);
    const after = await page.evaluate(() => ({
        cards: window.game.gameState.currentTrainingCards,
        used: window.game.cardManager.trainingDiscards,
        startedAt: window.game.gameState.startedAt,
        discarded: window.game.gameState.discardedCards,
        refresh: window.game.gameState.trainingRefreshRemaining
    }));
    expect(after.cards).toEqual(before.cards);
    expect(after.used).toEqual(before.used);
    expect(after.startedAt).toBe(before.startedAt);
    expect(after.discarded).toEqual(['問合対応の基本']);
    expect(after.refresh).toBe(1);
});

test('カードCSVのHTTPエラーで別難易度へ切り替えず再試行できる', async ({ page }) => {
    await page.goto('/');
    await page.route('**/cards_pro.csv*', route => route.fulfill({ status: 503, body: 'unavailable' }));
    page.once('dialog', dialog => dialog.accept());
    await page.click('#btn-difficulty-pro'); await page.click('#start-game');
    await expect(page.locator('#start-overlay')).toBeVisible();
    await expect(page.locator('#btn-difficulty-pro')).toHaveClass(/selected/);
    await page.unroute('**/cards_pro.csv*');
    await page.click('#start-game');
    await expect(page.locator('#training-area')).toBeVisible();
    expect(await page.evaluate(() => window.game.gameState.difficulty)).toBe('pro');
});

test.describe('イベント期間外', () => {
    test.use({ testDate: '2026-10-02T03:00:00Z' });
    test('実際の開催日時に依存せず、期間外のトグル非表示も検証する', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#event-mode-panel')).toBeHidden();
    });
});

test('発想を持つ通常研修と発想追加習得を、中断再開で取り違えない', async ({ page }) => {
    await page.goto('/'); await page.click('#start-game');
    await expect(page.locator('#training-cards .card')).toHaveCount(4);
    await page.evaluate(() => {
        const {gameState, uiController} = window.game;
        gameState.turn = 3; gameState.phase = 'training'; gameState.tokens.inspiration = 1;
        uiController.showTrainingPhase();
    });
    await page.reload();
    await expect(page.locator('#training-area .instruction')).not.toContainText('発想追加習得');
    await page.locator('#training-cards .card').first().click(); await page.click('#confirm-training');
    await expect(page.locator('#training-area .instruction')).toContainText('発想追加習得');
    const choices = await page.evaluate(() => window.game.gameState.currentTrainingCards.map(c => c.poolId));
    await page.reload();
    await expect(page.locator('#training-area .instruction')).toContainText('発想追加習得');
    expect(await page.evaluate(() => window.game.gameState.currentTrainingCards.map(c => c.poolId))).toEqual(choices);
    await page.locator('#training-cards .card').first().click(); await page.click('#confirm-training');
    await expect(page.locator('#action-area')).toBeVisible();
    expect(await page.evaluate(() => window.game.gameState.tokens.inspiration)).toBe(0);
});
