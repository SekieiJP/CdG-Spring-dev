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

    test('研修入力で99を入力すると直前までを採用して即時確定する', async ({ page }) => {
        await page.locator('#start-overlay h1').click();
        await page.locator('#calc-mode-row .toggle-slider').click();
        await page.locator('#start-game').click();

        await page.locator('#calc-training-input').fill('060799');
        await page.waitForSelector('#action-area:not(.hidden)', { timeout: 10000 });

        const deckNos = await page.evaluate(() =>
            window.game.gameState.player.deck.map(card => String(card.cardNo).padStart(2, '0'))
        );
        expect(deckNos.filter(no => no === '06')).toHaveLength(1);
        expect(deckNos.filter(no => no === '07')).toHaveLength(1);
    });

    test('研修入力で99直前までが不備なら確定せずエラーを表示する', async ({ page }) => {
        await page.locator('#start-overlay h1').click();
        await page.locator('#calc-mode-row .toggle-slider').click();
        await page.locator('#start-game').click();

        await page.locator('#calc-training-input').fill('0699');

        await expect(page.locator('#training-area')).not.toHaveClass(/hidden/);
        await expect(page.locator('#calc-training-input')).toHaveValue('06');
        await expect(page.locator('#calc-training-msg')).toContainText('Rカードを2枚入力してください');
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

    test('スタッフ配置入力で99を入力すると直前までを採用して次の入力欄へ進む', async ({ page }) => {
        await page.locator('#start-overlay h1').click();
        await page.locator('#calc-mode-row .toggle-slider').click();
        await page.locator('#start-game').click();

        await page.locator('#calc-training-input').fill('0607');
        await page.locator('#confirm-training').click();
        await page.waitForSelector('#action-area:not(.hidden)', { timeout: 10000 });

        await page.locator('#calc-action-leader').fill('0699');

        await expect(page.locator('#calc-action-leader')).toHaveValue('06');
        await expect(page.locator('#slot-leader .card')).toContainText('チラシ折り');
        await expect(page.locator('#calc-action-teacher')).toBeFocused();
    });

    test('スタッフ配置入力からフォーカスが外れるとプレビューを配置に反映する', async ({ page }) => {
        await page.locator('#start-overlay h1').click();
        await page.locator('#calc-mode-row .toggle-slider').click();
        await page.locator('#start-game').click();

        await page.locator('#calc-training-input').fill('0607');
        await page.locator('#confirm-training').click();
        await page.waitForSelector('#action-area:not(.hidden)', { timeout: 10000 });

        await page.locator('#calc-action-leader').fill('06');
        await expect(page.locator('#calc-action-preview-leader')).toContainText('チラシ折り');
        await page.locator('#calc-action-teacher').focus();

        await expect(page.locator('#slot-leader .card')).toContainText('チラシ折り');
        await expect(page.locator('#calc-action-preview-leader')).toBeEmpty();
        await expect(page.locator('#action-area')).not.toHaveClass(/hidden/);
    });

    test('事務入力欄のblurは配置反映のみで行動確定しない', async ({ page }) => {
        await page.locator('#start-overlay h1').click();
        await page.locator('#calc-mode-row .toggle-slider').click();
        await page.locator('#start-game').click();

        await page.locator('#calc-training-input').fill('0607');
        await page.locator('#confirm-training').click();
        await page.waitForSelector('#action-area:not(.hidden)', { timeout: 10000 });

        await page.locator('#calc-action-staff').fill('06');
        await page.locator('#confirm-action').focus();

        await expect(page.locator('#slot-staff .card')).toContainText('チラシ折り');
        await expect(page.locator('#status-animation-overlay')).toHaveClass(/hidden/);
        await expect(page.locator('#action-area')).not.toHaveClass(/hidden/);
    });

    test('計算機モードで配置済みカードをタップ取消すると入力欄からNoを消し、デッキに戻す', async ({ page }) => {
        await page.locator('#start-overlay h1').click();
        await page.locator('#calc-mode-row .toggle-slider').click();
        await page.locator('#start-game').click();

        await page.locator('#calc-training-input').fill('0607');
        await page.locator('#confirm-training').click();
        await page.waitForSelector('#action-area:not(.hidden)', { timeout: 10000 });

        await page.locator('#calc-action-leader').fill('06');
        await page.locator('#calc-action-leader').press('Enter');
        await expect(page.locator('#slot-leader .card')).toContainText('チラシ折り');

        await page.locator('#slot-leader .card').click();

        await expect(page.locator('#calc-action-leader')).toHaveValue('');
        await expect(page.locator('#slot-leader .card')).toHaveCount(0);
        const cardLocation = await page.evaluate(() => {
            const game = window.game;
            return {
                deckCount: game.gameState.player.deck
                    .filter(card => game.cardManager.normalizeCardNo(card.cardNo) === '6').length,
                handCount: game.gameState.player.hand
                    .filter(card => game.cardManager.normalizeCardNo(card.cardNo) === '6').length
            };
        });
        expect(cardLocation.deckCount).toBe(1);
        expect(cardLocation.handCount).toBe(0);

        await page.locator('#calc-action-leader').fill('06');
        await page.locator('#calc-action-leader').press('Enter');

        await expect(page.locator('#calc-action-msg-leader')).toBeEmpty();
        await expect(page.locator('#slot-leader .card')).toContainText('チラシ折り');
    });

    test('最後のスタッフ入力欄で99を入力すると空欄扱いで行動確定する', async ({ page }) => {
        await page.locator('#start-overlay h1').click();
        await page.locator('#calc-mode-row .toggle-slider').click();
        await page.locator('#start-game').click();

        await page.locator('#calc-training-input').fill('0607');
        await page.locator('#confirm-training').click();
        await page.waitForSelector('#action-area:not(.hidden)', { timeout: 10000 });

        await page.locator('#calc-action-staff').fill('99');

        await expect(page.locator('#calc-action-staff')).toHaveValue('');
        await expect(page.locator('#status-animation-overlay')).not.toHaveClass(/hidden/, { timeout: 10000 });
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
