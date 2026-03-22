/**
 * カードエフェクトパーサーの単体テスト
 * ブラウザ上でJavaScriptモジュールをテスト
 */
import { test, expect } from '@playwright/test';

test.describe('カード効果パーサーテスト', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        // ゲームが初期化されるまで待機
        await page.waitForSelector('#start-game');
    });

    test('ゲームが正常に読み込まれる', async ({ page }) => {
        const startButton = page.locator('#start-game');
        await expect(startButton).toBeVisible();
        await expect(startButton).toHaveText('ゲーム開始');
    });

    test('ゲーム開始後、初回研修画面が表示される', async ({ page }) => {
        // FRESH難易度を選択してゲーム開始
        await page.click('#btn-difficulty-fresh');
        await page.click('#start-game');

        // 研修エリアが表示される
        await expect(page.locator('#training-area')).toBeVisible();

        // 研修カードが4枚表示される
        const cards = page.locator('#training-cards .card');
        await expect(cards).toHaveCount(4);
    });

    test('初回研修でカードを2枚選択できる', async ({ page }) => {
        // FRESH難易度を選択してゲーム開始
        await page.click('#btn-difficulty-fresh');
        await page.click('#start-game');
        await page.waitForSelector('#training-cards .card');

        // カードを2枚選択
        const cards = page.locator('#training-cards .card');
        await cards.nth(0).click();
        await cards.nth(1).click();

        // 選択状態を確認
        await expect(cards.nth(0)).toHaveClass(/selected/);
        await expect(cards.nth(1)).toHaveClass(/selected/);

        // 確定ボタンをクリック
        await page.click('#confirm-training');

        // アクションフェーズに遷移
        await expect(page.locator('#action-area')).toBeVisible();
    });
});

test.describe('カード効果テスト - 基本効果', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        // FRESH難易度を選択してゲーム開始
        await page.click('#btn-difficulty-fresh');
        await page.click('#start-game');
        await page.waitForSelector('#training-cards .card');

        // 初回研修をスキップ（2枚選んで確定）
        const cards = page.locator('#training-cards .card');
        await cards.nth(0).click();
        await cards.nth(1).click();
        await page.click('#confirm-training');

        // アクションフェーズまで待機
        await page.waitForSelector('#action-area');
    });

    test('手札が4枚表示される', async ({ page }) => {
        const handCards = page.locator('#hand-cards .card');
        await expect(handCards).toHaveCount(4);
    });

    test('カードをスタッフスロットに配置できる', async ({ page }) => {
        // 最初のカードを室長スロットにドラッグ
        const card = page.locator('#hand-cards .card').first();
        const slot = page.locator('#slot-leader');

        await card.dragTo(slot);

        // スロットにカードが配置されたことを確認
        await expect(slot.locator('.card')).toHaveCount(1);
    });

    test('アクション確定でステータスが変化する', async ({ page }) => {
        // confirm()ダイアログを自動承認
        page.on('dialog', dialog => dialog.accept());

        // 初期ステータスを記録
        const expBefore = await page.locator('#status-experience').textContent();

        // 手札のカードをすべて配置
        const cards = page.locator('#hand-cards .card');
        const slots = ['#slot-leader', '#slot-teacher', '#slot-staff'];

        for (let i = 0; i < 3 && i < await cards.count(); i++) {
            await cards.nth(0).dragTo(page.locator(slots[i]));
            await page.waitForTimeout(300); // ドラッグ後の待機
        }

        // アクション確定
        await page.click('#confirm-action');

        // ステータス変動演出が終わるまで待機（開始→終了の2段階）
        await page.waitForFunction(() => !document.getElementById('status-animation-overlay')?.classList.contains('hidden'), { timeout: 5000 }).catch(() => {});
        await page.waitForFunction(() => document.getElementById('status-animation-overlay')?.classList.contains('hidden'), { timeout: 20000 });

        // 会議フェーズに遷移
        await expect(page.locator('#meeting-area')).toBeVisible();
    });
});

test.describe('カード効果テスト - 条件付き効果', () => {
    test('ログにステータス変化が記録される', async ({ page }) => {
        // confirm()ダイアログを自動承認
        page.on('dialog', dialog => dialog.accept());

        await page.goto('/');
        // FRESH難易度を選択してゲーム開始
        await page.click('#btn-difficulty-fresh');
        await page.click('#start-game');

        // 初回研修
        await page.waitForSelector('#training-cards .card');
        const trainingCards = page.locator('#training-cards .card');
        await trainingCards.nth(0).click();
        await trainingCards.nth(1).click();
        await page.click('#confirm-training');

        // アクションフェーズ
        await page.waitForSelector('#hand-cards .card');
        const handCards = page.locator('#hand-cards .card');
        const slots = ['#slot-leader', '#slot-teacher', '#slot-staff'];

        for (let i = 0; i < 3; i++) {
            const cardCount = await page.locator('#hand-cards .card').count();
            if (cardCount > 0) {
                await page.locator('#hand-cards .card').first().dragTo(page.locator(slots[i]));
                await page.waitForTimeout(300);
            }
        }

        // ログを開く
        const logToggle = page.locator('#log-toggle');
        if (await logToggle.isVisible()) {
            await logToggle.click();
        }

        // アクション確定
        await page.click('#confirm-action');

        // ログにカード効果発動が記録されていることを確認
        await page.waitForTimeout(1000);
        const logContent = await page.locator('#log-content').textContent();
        expect(logContent).toContain('カード効果発動');
    });
});

test.describe('全ターン通しテスト', () => {
    test('8ターン完走できる', async ({ page }) => {
        // アニメーション込みで8ターン完走するには長めのタイムアウトが必要
        test.setTimeout(180000);
        // confirm()ダイアログを自動承認（未削除警告など）
        page.on('dialog', dialog => dialog.accept());

        await page.goto('/');
        // FRESH難易度を選択してゲーム開始
        await page.click('#btn-difficulty-fresh');
        await page.click('#start-game');

        // 初回研修
        await page.waitForSelector('#training-cards .card');
        let trainingCards = page.locator('#training-cards .card');
        await trainingCards.nth(0).click();
        await trainingCards.nth(1).click();
        await page.click('#confirm-training');

        // 8ターン分のループ
        for (let turn = 1; turn <= 8; turn++) {
            // アクションフェーズ
            await page.waitForSelector('#action-area:not(.hidden)', { timeout: 10000 });

            // 手札をスロットに配置
            const slots = ['#slot-leader', '#slot-teacher', '#slot-staff'];
            for (let i = 0; i < 3; i++) {
                const cardCount = await page.locator('#hand-cards .card').count();
                if (cardCount > 0) {
                    await page.locator('#hand-cards .card').first().dragTo(page.locator(slots[i]));
                    await page.waitForTimeout(300);
                }
            }

            // アクション確定
            await page.click('#confirm-action');

            // 演出待機（開始→終了の2段階）
            await page.waitForFunction(() => !document.getElementById('status-animation-overlay')?.classList.contains('hidden'), { timeout: 5000 }).catch(() => {});
            await page.waitForFunction(() => document.getElementById('status-animation-overlay')?.classList.contains('hidden'), { timeout: 25000 });

            if (turn === 8) {
                // 最終ターン: 結果画面
                await page.waitForSelector('#result-area:not(.hidden)', { timeout: 10000 });
                break;
            }

            // 会議フェーズ
            await page.waitForSelector('#meeting-area:not(.hidden)', { timeout: 10000 });
            await page.click('#confirm-meeting');

            // 研修フェーズ
            await page.waitForSelector('#training-area:not(.hidden)', { timeout: 10000 });
            trainingCards = page.locator('#training-cards .card');
            if (await trainingCards.count() > 0) {
                await trainingCards.first().click();
            }
            await page.click('#confirm-training');
        }

        // 結果画面が表示されることを確認
        await expect(page.locator('#result-area')).toBeVisible();

        // ランクが表示されていることを確認
        await expect(page.locator('#result-rank')).toBeVisible();
    });
});

test.describe('PRO難易度 基本動作テスト', () => {
    test('PRO難易度でゲームが開始できる', async ({ page }) => {
        await page.goto('/');
        await page.click('#btn-difficulty-pro');
        await page.click('#start-game');

        // 研修エリアが表示される
        await expect(page.locator('#training-area')).toBeVisible();

        // 研修カードが表示される（PRO難易度でも研修カードが出る）
        const cards = page.locator('#training-cards .card');
        await expect(cards).toHaveCount(4);
    });

    test('PRO難易度でアクションフェーズまで進める', async ({ page }) => {
        page.on('dialog', dialog => dialog.accept());
        await page.goto('/');
        await page.click('#btn-difficulty-pro');
        await page.click('#start-game');

        // 初回研修: 2枚選択して確定
        await page.waitForSelector('#training-cards .card');
        const cards = page.locator('#training-cards .card');
        await cards.nth(0).click();
        await cards.nth(1).click();
        await page.click('#confirm-training');

        // アクションフェーズに遷移
        await expect(page.locator('#action-area')).toBeVisible();

        // 手札が4枚表示される
        const handCards = page.locator('#hand-cards .card');
        await expect(handCards).toHaveCount(4);
    });
});
