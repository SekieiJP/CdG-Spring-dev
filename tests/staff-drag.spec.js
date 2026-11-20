import { test, expect } from './fixtures.js';

async function startAction(page) {
    await page.goto('/');
    await page.locator('#start-game').click();
    const cards = page.locator('#training-cards .card');
    await cards.nth(0).click();
    await cards.nth(1).click();
    await page.locator('#confirm-training').click();
    await expect(page.locator('#hand-cards .card').first()).toBeVisible();
}

test('マウスが枠の外でもカードが重なるスタッフに移せる', async ({ page }, info) => {
    test.skip(info.project.name !== 'chromium', 'マウスのドラッグを検証する');
    await startAction(page);

    const hand = page.locator('#hand-cards .card');
    const leader = page.locator('#slot-leader');
    const teacher = page.locator('#slot-teacher');
    const staff = page.locator('#slot-staff');
    await hand.first().dragTo(leader);
    const card = leader.locator('.card');
    await expect(card).toHaveCount(1);
    await hand.first().dragTo(teacher);
    await card.dragTo(teacher);
    await expect(teacher.locator('.card')).toHaveCount(1);
    await expect(card).toHaveCount(1);

    const from = await card.boundingBox();
    const to = await staff.boundingBox();
    const x = to.x + to.width / 2;
    const y = to.y + to.height + 4;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height * 0.8);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 12 });
    await page.mouse.move(x, y - 1);
    await expect(staff).toHaveClass(/drag-over/);
    await page.mouse.up();
    await expect(staff.locator('.card')).toHaveCount(1);
    await expect(card).toHaveCount(0);
    await expect(page.locator('.card.dragging, .drag-over')).toHaveCount(0);
});

test('タッチで配置済みのカードを移動できる', async ({ page, context }, info) => {
    test.skip(info.project.name !== 'android-chrome', 'Chromiumのタッチ入力を使う');
    await startAction(page);
    await page.locator('#hand-cards .card').first().tap();
    const leader = page.locator('#slot-leader .card');
    const staff = page.locator('#slot-staff');
    await expect(leader).toHaveCount(1);
    const from = await leader.boundingBox();
    const to = await staff.boundingBox();
    const touch = await context.newCDPSession(page);
    const send = (type, x, y) => touch.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y }]
    });
    const x = from.x + from.width / 2;
    const y = from.y + from.height / 2;
    await send('touchStart', x, y);
    await send('touchMove', x + 16, y);
    await send('touchMove', to.x + to.width / 2, to.y + to.height / 2);
    await expect(staff).toHaveClass(/drag-over/);
    await send('touchEnd');
    await expect(staff.locator('.card')).toHaveCount(1);
    await expect(leader).toHaveCount(0);
    await expect(page.locator('.card-drag-preview, .effect-tooltip')).toHaveCount(0);
});
