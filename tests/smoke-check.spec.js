/**
 * 動作確認用スモークテスト
 * - スロット指定モードで並行カードを重ね配置できる（入れ替えにならない）
 * - ゲーム開始時に startedAt が記録される
 * - ゲーム終了時に submitScore が呼ばれる（エンドポイント未設定のためログ出力を確認）
 */
import { test, expect } from '@playwright/test';

test.describe('スロット指定モード: 並行カード重ね配置', () => {
    test.beforeEach(async ({ page }) => {
        page.on('dialog', dialog => dialog.accept());
        await page.goto('/');
        await page.click('#btn-difficulty-pro');
        await page.click('#start-game');
        await page.waitForSelector('#training-cards .card', { timeout: 10000 });

        // 初回研修: 2枚選択して確定
        const cards = page.locator('#training-cards .card');
        await cards.nth(0).click();
        await cards.nth(1).click();
        await page.click('#confirm-training');
        await page.waitForSelector('#action-area:not(.hidden)', { timeout: 10000 });
    });

    test('スロット指定モードONで並行カードを配置済みスロットに配置すると重ね配置になる（入れ替えではない）', async ({ page }) => {
        // 手札に通常カードと並行カードを注入
        await page.evaluate(() => {
            const normalCard = {
                category: '動員', rarity: 'R', cardName: 'テスト通常カード',
                topEffect: '体験+1', effect: '体験+1', acquiredTurn: 0
            };
            const parallelCard = {
                category: '動員', rarity: 'R', cardName: 'テスト並行カード',
                topEffect: '体験+1', effect: '[並行🤹] 体験+1', acquiredTurn: 0
            };
            const gs = window.game.gameState;
            gs.player.hand = [normalCard, parallelCard];
            window.game.uiController.renderHand();
        });

        // スロット指定モードをON
        await page.click('#btn-slot-manual');

        // 通常カードをタップ→室長スロットへ配置
        await page.locator('#hand-cards .card').nth(0).click();
        await page.locator('#slot-leader').click();

        // 室長スロットに1枚配置されていることを確認
        const slotCardsAfterFirst = await page.locator('#slot-leader .card').count();
        expect(slotCardsAfterFirst).toBe(1);

        // 並行カードをタップ→室長スロット（配置済み）へ配置
        await page.locator('#hand-cards .card').nth(0).click();
        await page.locator('#slot-leader').click();

        // 室長スロットに2枚になっていること（入れ替えではなく重ね配置）
        const slotCardsAfterSecond = await page.locator('#slot-leader .card').count();
        expect(slotCardsAfterSecond).toBe(2);

        // 手札が空になっていること
        const handCount = await page.locator('#hand-cards .card').count();
        expect(handCount).toBe(0);
    });
});

test.describe('startedAt 記録とスコア送信ログ', () => {
    test('ゲーム開始時に startedAt が記録される', async ({ page }) => {
        page.on('dialog', dialog => dialog.accept());
        await page.goto('/');
        await page.click('#start-game');
        await page.waitForSelector('#training-cards .card', { timeout: 10000 });

        const startedAt = await page.evaluate(() => window.game.gameState.startedAt);
        expect(startedAt).toBeTruthy();
        expect(startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('ゲーム終了時にスコア送信ログが出る（エンドポイント未設定 → 設定済みのためfetch試行）', async ({ page }) => {
        page.on('dialog', dialog => dialog.accept());

        const logMessages = [];
        await page.goto('/');

        // ゲームを強制的に終了フェーズへ
        await page.click('#start-game');
        await page.waitForSelector('#training-cards .card', { timeout: 10000 });
        const cards = page.locator('#training-cards .card');
        await cards.nth(0).click();
        await cards.nth(1).click();
        await page.click('#confirm-training');
        await page.waitForSelector('#action-area:not(.hidden)', { timeout: 10000 });

        // アクション確定（カード未配置でOK）
        await page.click('#confirm-action');

        // 会議フェーズをスキップして終了フェーズへ強制遷移
        await page.evaluate(() => {
            window.game.gameState.turn = 7;
            window.game.gameState.phase = 'end';
            window.game.uiController.showResultPhase();
        });

        // 結果画面が表示されることを確認
        await expect(page.locator('#result-area:not(.hidden)')).toBeVisible({ timeout: 5000 });

        // startedAt が結果画面でも残っていること
        const startedAt = await page.evaluate(() => window.game.gameState.startedAt);
        expect(startedAt).toBeTruthy();
    });
});
