import { test, expect } from './fixtures.js';

async function startActionPhase(page) {
    page.on('dialog', dialog => dialog.accept());
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator('#start-game').click();
    await page.waitForSelector('#training-cards .card', { timeout: 10000 });
    await page.locator('#training-cards .card').nth(0).click();
    await page.locator('#training-cards .card').nth(1).click();
    await page.locator('#confirm-training').click();
    await page.waitForSelector('#action-area:not(.hidden)', { timeout: 10000 });
}

test.describe('スタッフスロットのレスポンシブ配置', () => {
    test('480px以下でも配置先を横に並べ、縦幅を圧縮する', async ({ page }) => {
        await page.setViewportSize({ width: 480, height: 800 });
        await startActionPhase(page);

        const staffAreaColumns = await page.locator('.staff-area').evaluate(el =>
            getComputedStyle(el).gridTemplateColumns.split(' ').length
        );
        expect(staffAreaColumns).toBe(3);

        const slotBox = await page.locator('#slot-leader').boundingBox();
        const placeholderBox = await page.locator('#slot-leader .slot-placeholder').boundingBox();
        expect(slotBox).not.toBeNull();
        expect(placeholderBox).not.toBeNull();
        expect(placeholderBox.width).toBeGreaterThan(slotBox.width * 0.9);
    });

    test('480px以下では同一スタッフ内カードを短縮して縦に重ねる', async ({ page }) => {
        await page.setViewportSize({ width: 480, height: 800 });
        await startActionPhase(page);

        await page.evaluate(() => {
            const cards = window.game.cardManager.allCards.slice(0, 3).map(card => ({ ...card }));
            window.game.gameState.player.placed.leader = cards;
            window.game.uiController.renderStaffSlot('leader');
        });

        const boxes = await page.locator('#slot-leader .card').evaluateAll(cards =>
            cards.map(card => {
                const rect = card.getBoundingClientRect();
                return { x: rect.x, y: rect.y, width: rect.width };
            })
        );

        expect(boxes).toHaveLength(3);
        expect(boxes[1].y).toBeGreaterThan(boxes[0].y);
        expect(Math.abs(boxes[0].x - boxes[1].x)).toBeLessThan(2);
        expect(boxes[2].y).toBeGreaterThan(boxes[0].y + 20);
        expect(boxes[0].width).toBeGreaterThan(100);
    });

    test('481px以上ではスタッフスロットを従来通り横3列にする', async ({ page }) => {
        await page.setViewportSize({ width: 600, height: 800 });
        await startActionPhase(page);

        const staffAreaColumns = await page.locator('.staff-area').evaluate(el =>
            getComputedStyle(el).gridTemplateColumns.split(' ').length
        );
        expect(staffAreaColumns).toBe(3);
    });
});
