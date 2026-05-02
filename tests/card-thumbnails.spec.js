import { test, expect } from '@playwright/test';

test.describe('カード画像サムネイル', () => {
    test.beforeEach(async ({ page }) => {
        page.on('dialog', dialog => dialog.accept());
        await page.goto('/');
        await page.evaluate(() => localStorage.clear());
        await page.reload();
    });

    test('初期状態で研修カードにカード番号対応のサムネイルを表示し、設定で非表示にできる', async ({ page }) => {
        await page.locator('#start-game').click();
        await page.waitForSelector('#training-cards .card-thumbnail', { timeout: 10000 });

        const firstThumbnail = page.locator('#training-cards .card-thumbnail').first();
        await expect(firstThumbnail).toBeVisible();
        await expect(firstThumbnail).toHaveAttribute('src', /data\/cardIcon\/icon\d{2}\.png/);

        await page.locator('#btn-settings-full').click();
        await page.locator('[data-card-icon="hide"]').click();

        await expect(page.locator('html')).toHaveClass(/card-icon-hide/);
        await expect(firstThumbnail).toBeHidden();

        await page.locator('[data-card-icon="show"]').click();
        await expect(page.locator('html')).not.toHaveClass(/card-icon-hide/);
        await expect(firstThumbnail).toBeVisible();
    });

    test('行動実行アニメーションのカード枠右側にサムネイルを表示する', async ({ page }) => {
        await page.locator('#start-overlay h1').click();
        await page.locator('#calc-mode-row .toggle-slider').click();
        await page.locator('#start-game').click();

        await page.locator('#calc-training-input').fill('0607');
        await page.locator('#confirm-training').click();
        await page.waitForSelector('#action-area:not(.hidden)', { timeout: 10000 });

        await page.locator('#calc-action-leader').fill('06');
        await page.locator('#confirm-action').click();

        const animationItem = page.locator('.animation-card-item').first();
        await expect(animationItem).toBeVisible({ timeout: 10000 });
        await expect(animationItem.locator('.anim-card-thumbnail')).toBeVisible();
        await expect(animationItem.locator('.anim-card-thumbnail')).toHaveAttribute('src', /data\/cardIcon\/icon06\.png/);
    });

    test('スロット指定モードのカード選択では手札サムネイルDOMを再生成しない', async ({ page }) => {
        await page.locator('#start-game').click();
        await page.waitForSelector('#training-cards .card', { timeout: 10000 });
        await page.locator('#training-cards .card').nth(0).click();
        await page.locator('#training-cards .card').nth(1).click();
        await page.locator('#confirm-training').click();
        await page.waitForSelector('#action-area:not(.hidden)', { timeout: 10000 });
        await page.waitForSelector('#hand-cards .card-thumbnail', { timeout: 10000 });

        await page.evaluate(() => {
            window.__firstHandThumbnail = document.querySelector('#hand-cards .card-thumbnail');
        });

        await page.locator('#btn-slot-manual').click();
        await page.locator('#hand-cards .card').first().click();

        const sameNode = await page.evaluate(() =>
            window.__firstHandThumbnail === document.querySelector('#hand-cards .card-thumbnail')
        );
        expect(sameNode).toBe(true);
        await expect(page.locator('#hand-cards .card').first()).toHaveClass(/selected-for-placement/);
    });
});
