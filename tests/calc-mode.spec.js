import { test, expect } from '@playwright/test';

test.describe('計算機モード', () => {
    test.beforeEach(async ({ page }) => {
        page.on('dialog', dialog => dialog.accept());
        await page.goto('/');
        await page.evaluate(() => localStorage.clear());
        await page.reload();
    });

    test('タイトルタップでトグルを表示し、研修入力欄へ自動フォーカスする', async ({ page }) => {
        await expect(page.locator('#calc-mode-row')).toHaveClass(/hidden/);

        await page.locator('#start-overlay h1').click();
        await expect(page.locator('#calc-mode-row')).not.toHaveClass(/hidden/);

        await page.locator('#calc-mode-row .toggle-slider').click();
        await page.locator('#start-game').click();

        await expect(page.locator('#training-area')).toBeVisible();
        await expect(page.locator('#training-cards .card')).toHaveCount(0);
        await expect(page.locator('#calc-training-input')).toBeFocused();
        await expect(page.locator('#training-area .instruction')).toContainText('計算機モード');
    });

    test('研修入力では同一Noを複数入力しても重複枚数理由で拒否しない', async ({ page }) => {
        await page.locator('#start-overlay h1').click();
        await page.locator('#calc-mode-row .toggle-slider').click();
        await page.locator('#start-game').click();

        await page.locator('#calc-training-input').fill('0606');
        await page.locator('#confirm-training').click();
        await page.waitForSelector('#action-area:not(.hidden)', { timeout: 10000 });

        const deckNos = await page.evaluate(() =>
            window.game.gameState.player.deck
                .filter(card => String(card.cardNo) === '6')
                .map(card => card.cardName)
        );
        expect(deckNos).toHaveLength(2);
        await expect(page.locator('#calc-action-leader')).toBeFocused();
    });

    test('偶数桁入力でカードプレビューを表示し、研修欄Enterで確定する', async ({ page }) => {
        await page.locator('#start-overlay h1').click();
        await page.locator('#calc-mode-row .toggle-slider').click();
        await page.locator('#start-game').click();

        await page.locator('#calc-training-input').fill('0');
        await expect(page.locator('#calc-training-preview')).toBeEmpty();

        await page.locator('#calc-training-input').fill('06');
        await expect(page.locator('#calc-training-preview')).toContainText('No.06');
        await expect(page.locator('#calc-training-preview')).toContainText('チラシ折り');

        await page.locator('#calc-training-input').fill('0607');
        await page.locator('#calc-training-input').press('Enter');
        await page.waitForSelector('#action-area:not(.hidden)', { timeout: 10000 });
    });

    test('スタッフ配置入力では既存の非並行重ね配置ルールを適用する', async ({ page }) => {
        await page.locator('#start-overlay h1').click();
        await page.locator('#calc-mode-row .toggle-slider').click();
        await page.locator('#start-game').click();

        await page.locator('#calc-training-input').fill('0607');
        await page.locator('#confirm-training').click();
        await page.waitForSelector('#action-area:not(.hidden)', { timeout: 10000 });

        await page.locator('#calc-action-leader').fill('0102');
        await page.locator('#calc-action-leader').press('Enter');

        await expect(page.locator('#calc-action-msg-leader')).toContainText('重ね配置できません');
        await expect(page.locator('#slot-leader .card')).toHaveCount(0);
    });

    test('最後のスタッフ入力欄でEnterすると行動確定ボタン相当になる', async ({ page }) => {
        await page.locator('#start-overlay h1').click();
        await page.locator('#calc-mode-row .toggle-slider').click();
        await page.locator('#start-game').click();

        await page.locator('#calc-training-input').fill('0607');
        await page.locator('#confirm-training').click();
        await page.waitForSelector('#action-area:not(.hidden)', { timeout: 10000 });

        await page.locator('#calc-action-leader').fill('06');
        await expect(page.locator('#calc-action-preview-leader')).toContainText('チラシ折り');
        await page.locator('#calc-action-staff').press('Enter');

        await expect(page.locator('#status-animation-overlay')).not.toHaveClass(/hidden/, { timeout: 10000 });
    });
});
