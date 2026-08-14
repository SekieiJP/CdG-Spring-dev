import { test, expect } from '@playwright/test';

test.describe('イベントアイテム獲得演出', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.locator('#event-mode-toggle').check();
        await page.locator('#start-game').click();
        await expect(page.locator('.event-presentation')).toBeVisible();
    });

    test('白背景でも文字を黒ベースで表示する', async ({ page }) => {
        const presentation = page.locator('.event-presentation');
        await expect(presentation).toHaveCSS('background-color', 'rgb(255, 255, 255)');
        await expect(presentation).toHaveCSS('color', 'rgb(31, 41, 55)');
    });

    test('演出中の再読み込みではタイトル画面を表示しない', async ({ page }) => {
        await page.reload();

        await expect(page.locator('.event-presentation')).toBeVisible();
        await expect(page.locator('#start-overlay')).toHaveClass(/hidden/);
    });
});
