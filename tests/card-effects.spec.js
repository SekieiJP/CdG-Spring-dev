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

test.describe('発想トークン追加習得フロー', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('発想トークンがある状態で通常研修を確定すると追加習得画面が表示される', async ({ page }) => {
        page.on('dialog', dialog => dialog.accept());

        // PRO難易度でゲーム開始
        await page.click('#btn-difficulty-pro');
        await page.click('#start-game');
        await page.waitForSelector('#training-cards .card', { timeout: 10000 });

        // 初回研修: カード2枚選択して確定
        const cards = page.locator('#training-cards .card');
        await cards.nth(0).click();
        await cards.nth(1).click();
        await page.click('#confirm-training');

        // ターン1の行動フェーズまで進む
        await page.waitForFunction(() => {
            const area = document.getElementById('action-area');
            return area && !area.classList.contains('hidden');
        }, { timeout: 10000 });

        // 発想トークンをデバッグで注入
        await page.evaluate(() => {
            window.game.gameState.tokens.inspiration = 2;
        });

        // アクション確定
        await page.click('#confirm-action');

        // アニメーション完了待機
        await page.waitForFunction(() => !document.getElementById('status-animation-overlay')?.classList.contains('hidden'), { timeout: 5000 }).catch(() => {});
        await page.waitForFunction(() => document.getElementById('status-animation-overlay')?.classList.contains('hidden'), { timeout: 20000 });

        // 会議フェーズ
        await page.waitForSelector('#meeting-area:not(.hidden)', { timeout: 10000 });
        await page.click('#confirm-meeting');

        // 研修フェーズへ遷移
        await page.waitForSelector('#training-cards .card', { timeout: 10000 });

        // 通常研修: 1枚選択して確定
        const trainingCards = page.locator('#training-cards .card');
        await trainingCards.nth(0).click();
        await page.click('#confirm-training');

        // 発想追加習得画面が表示されることを確認
        await page.waitForFunction(() => {
            const instruction = document.querySelector('#training-area .instruction');
            return instruction && instruction.textContent.includes('発想追加習得');
        }, { timeout: 10000 });

        const instruction = await page.locator('#training-area .instruction').textContent();
        expect(instruction).toContain('発想追加習得');
        expect(instruction).toContain('残り2回');

        // リフレッシュボタンが非表示であることを確認
        const refreshRow = page.locator('#training-refresh-row');
        await expect(refreshRow).toHaveClass(/hidden/);
    });

    test('発想追加習得で1枚選択して確定するとデッキに追加される', async ({ page }) => {
        page.on('dialog', dialog => dialog.accept());

        // PRO難易度でゲーム開始 → 初回研修
        await page.click('#btn-difficulty-pro');
        await page.click('#start-game');
        await page.waitForSelector('#training-cards .card', { timeout: 10000 });
        const initCards = page.locator('#training-cards .card');
        await initCards.nth(0).click();
        await initCards.nth(1).click();
        await page.click('#confirm-training');

        // ターン1の行動フェーズまで進む
        await page.waitForFunction(() => {
            const area = document.getElementById('action-area');
            return area && !area.classList.contains('hidden');
        }, { timeout: 10000 });

        // 発想トークンを1つ注入
        await page.evaluate(() => {
            window.game.gameState.tokens.inspiration = 1;
        });

        const deckBefore = await page.evaluate(() => window.game.gameState.player.deck.length);

        // 行動確定
        await page.click('#confirm-action');

        // アニメーション完了待機
        await page.waitForFunction(() => !document.getElementById('status-animation-overlay')?.classList.contains('hidden'), { timeout: 5000 }).catch(() => {});
        await page.waitForFunction(() => document.getElementById('status-animation-overlay')?.classList.contains('hidden'), { timeout: 20000 });

        // 会議フェーズ
        await page.waitForSelector('#meeting-area:not(.hidden)', { timeout: 10000 });
        await page.click('#confirm-meeting');

        // 研修フェーズ
        await page.waitForSelector('#training-cards .card', { timeout: 10000 });
        const trainingCards = page.locator('#training-cards .card');
        await trainingCards.nth(0).click();
        await page.click('#confirm-training');

        // 発想追加習得画面に切り替わる
        await page.waitForFunction(() => {
            const instruction = document.querySelector('#training-area .instruction');
            return instruction && instruction.textContent.includes('発想追加習得');
        }, { timeout: 10000 });

        // 発想追加習得: 1枚選択して確定
        const inspirationCards = page.locator('#training-cards .card');
        await inspirationCards.nth(0).click();
        await page.click('#confirm-training');

        // 行動フェーズに遷移することを確認
        await page.waitForFunction(() => {
            const area = document.getElementById('action-area');
            return area && !area.classList.contains('hidden');
        }, { timeout: 10000 });

        // デッキが増加していることを確認（通常1枚 + 発想1枚）
        const deckAfter = await page.evaluate(() => window.game.gameState.player.deck.length + window.game.gameState.player.hand.length);
        expect(deckAfter).toBeGreaterThan(deckBefore + 1);

        // inspiration トークンがリセットされていることを確認
        const inspirationRemaining = await page.evaluate(() => window.game.gameState.tokens.inspiration);
        expect(inspirationRemaining).toBe(0);
    });
});

test.describe('[並行🤹] 効果 配置ロジックテスト', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('並行カードを埋まりスロットに重ね配置できる（タップ自動配置）', async ({ page }) => {
        page.on('dialog', dialog => dialog.accept());

        // PRO難易度でゲーム開始 → 初回研修 → 行動フェーズへ
        await page.click('#btn-difficulty-pro');
        await page.click('#start-game');
        await page.waitForSelector('#training-cards .card', { timeout: 10000 });
        const initCards = page.locator('#training-cards .card');
        await initCards.nth(0).click();
        await initCards.nth(1).click();
        await page.click('#confirm-training');
        await page.waitForSelector('#action-area:not(.hidden)', { timeout: 10000 });

        // 手札に非並行カード3枚 + 並行カード1枚を設定
        await page.evaluate(() => {
            const normalCards = window.game.cardManager.allCards
                .filter(c => c.effect && !c.effect.includes('並行') && !c.effect.includes('【'))
                .slice(0, 3);
            const parallelCard = window.game.cardManager.allCards
                .find(c => c.effect && c.effect.includes('並行'));
            if (normalCards.length >= 3 && parallelCard) {
                window.game.gameState.player.hand = [...normalCards, parallelCard];
                window.game.uiController.renderHand();
            }
        });

        // 非並行3枚を各スロットにタップ配置（室長→講師→事務の順）
        for (let i = 0; i < 3; i++) {
            await page.locator('#hand-cards .card').first().click();
        }

        // 全スロットに1枚ずつ入ったことを確認
        await expect(page.locator('#slot-leader .card')).toHaveCount(1);
        await expect(page.locator('#slot-teacher .card')).toHaveCount(1);
        await expect(page.locator('#slot-staff .card')).toHaveCount(1);

        // 並行カードをタップ → 最少枚数スロット（全て1枚 → 室長が優先）に重ね配置
        await page.locator('#hand-cards .card').first().click();

        // 室長スロットに2枚入ったことを確認（重ね配置成功）
        await expect(page.locator('#slot-leader .card')).toHaveCount(2);
    });

    test('非並行カードは埋まりスロットに配置できない（重ね配置拒否）', async ({ page }) => {
        page.on('dialog', dialog => dialog.accept());

        await page.click('#btn-difficulty-pro');
        await page.click('#start-game');
        await page.waitForSelector('#training-cards .card', { timeout: 10000 });
        const initCards = page.locator('#training-cards .card');
        await initCards.nth(0).click();
        await initCards.nth(1).click();
        await page.click('#confirm-training');
        await page.waitForSelector('#action-area:not(.hidden)', { timeout: 10000 });

        // ゲーム状態を直接操作: 室長スロットに1枚配置済み、手札に非並行カード1枚
        const rejected = await page.evaluate(() => {
            const normalCard = window.game.cardManager.allCards
                .find(c => c.effect && !c.effect.includes('並行') && !c.effect.includes('【'));
            if (!normalCard) return null;

            // 室長スロットに1枚セット（直接状態操作）
            window.game.gameState.player.placed.leader = [{ ...normalCard }];
            window.game.uiController.renderStaffSlot('leader');

            // tryPlaceCardToSlot を呼び、拒否されることを確認
            const beforeCount = window.game.gameState.player.placed.leader.length; // 1
            window.game.uiController.tryPlaceCardToSlot(normalCard, 'leader');
            const afterCount = window.game.gameState.player.placed.leader.length;
            return afterCount === beforeCount; // trueなら拒否された
        });

        expect(rejected).toBe(true);

        // 室長スロットは1枚のまま
        await expect(page.locator('#slot-leader .card')).toHaveCount(1);
    });

    test('全スロット埋まり時に並行カードが手札にあると確定ダイアログが出る', async ({ page }) => {
        const dialogs = [];
        page.on('dialog', dialog => {
            dialogs.push(dialog.message());
            dialog.accept();
        });

        await page.click('#btn-difficulty-pro');
        await page.click('#start-game');
        await page.waitForSelector('#training-cards .card', { timeout: 10000 });
        const initCards = page.locator('#training-cards .card');
        await initCards.nth(0).click();
        await initCards.nth(1).click();
        await page.click('#confirm-training');
        await page.waitForSelector('#action-area:not(.hidden)', { timeout: 10000 });

        // 手札を「非並行カード3枚 + 並行カード1枚」に設定し、非並行3枚を各スロットに配置
        await page.evaluate(() => {
            const normalCards = window.game.cardManager.allCards.filter(c => c.effect && !c.effect.includes('並行') && !c.effect.includes('【'));
            const parallelCard = window.game.cardManager.allCards.find(c => c.effect && c.effect.includes('並行'));
            if (normalCards.length >= 3 && parallelCard) {
                window.game.gameState.player.hand = [...normalCards.slice(0, 3), parallelCard];
                window.game.uiController.renderHand();
            }
        });

        // 非並行カードを3スロットに配置
        for (const slot of ['#slot-leader', '#slot-teacher', '#slot-staff']) {
            const card = page.locator('#hand-cards .card').first();
            await card.dragTo(page.locator(slot));
        }

        // 全スロット埋まり・並行カード1枚残り状態で確定ボタンを押す
        await page.click('#confirm-action');

        // 「まだ配置できるカードがあります」ダイアログが出たことを確認
        expect(dialogs.some(msg => msg.includes('まだ配置できるカードがあります'))).toBe(true);
    });
});

test.describe('[情熱✊] トークン効果テスト', () => {
    test.beforeEach(async ({ page }) => {
        page.on('dialog', dialog => dialog.accept());
        await page.goto('/');
        await page.click('#btn-difficulty-pro');
        await page.click('#start-game');
        await page.waitForSelector('#training-cards .card', { timeout: 10000 });
        const cards = page.locator('#training-cards .card');
        await cards.nth(0).click();
        await cards.nth(1).click();
        await page.click('#confirm-training');
        await page.waitForSelector('#action-area:not(.hidden)', { timeout: 10000 });
    });

    test('情熱トークン2つで手札が6枚になる', async ({ page }) => {
        await page.evaluate(() => {
            const game = window.game;
            game.gameState.tokens.passion = 2;
            game.gameState.tokens.fatigue = 0;
            game.gameState.player.hand = [];
            game.gameState.player.deck = [...(game.cardManager.allCards.slice(0, 10))];
            game.turnManager.startActionPhase();
            game.uiController.showActionPhase();
        });

        await expect(page.locator('#hand-cards .card')).toHaveCount(6);
    });

    test('疲労トークン1つで手札が3枚になる', async ({ page }) => {
        await page.evaluate(() => {
            const game = window.game;
            game.gameState.tokens.passion = 0;
            game.gameState.tokens.fatigue = 1;
            game.gameState.player.hand = [];
            game.gameState.player.deck = [...(game.cardManager.allCards.slice(0, 10))];
            game.turnManager.startActionPhase();
            game.uiController.showActionPhase();
        });

        await expect(page.locator('#hand-cards .card')).toHaveCount(3);
    });

    test('疲労トークン4つで手札が0枚になり行動確定できる', async ({ page }) => {
        await page.evaluate(() => {
            const game = window.game;
            game.gameState.tokens.passion = 0;
            game.gameState.tokens.fatigue = 4;
            game.gameState.player.hand = [];
            game.gameState.player.deck = [...(game.cardManager.allCards.slice(0, 10))];
            game.turnManager.startActionPhase();
            game.uiController.showActionPhase();
        });

        await expect(page.locator('#hand-cards .card')).toHaveCount(0);
        await page.click('#confirm-action');
        await page.waitForSelector('#meeting-area:not(.hidden)', { timeout: 20000 });
        await expect(page.locator('#meeting-area:not(.hidden)')).toBeVisible();
    });
});

test.describe('[整理🗑️] トークン効果テスト', () => {
    test.beforeEach(async ({ page }) => {
        page.on('dialog', dialog => dialog.accept());
        await page.goto('/');
        await page.click('#btn-difficulty-pro');
        await page.click('#start-game');
        await page.waitForSelector('#training-cards .card', { timeout: 10000 });
        const cards = page.locator('#training-cards .card');
        await cards.nth(0).click();
        await cards.nth(1).click();
        await page.click('#confirm-training');
        await page.waitForSelector('#action-area:not(.hidden)', { timeout: 10000 });
    });

    test('整理トークン1つで削除可能枚数が+1される', async ({ page }) => {
        await page.evaluate(() => {
            window.game.gameState.tokens.organize = 1;
        });

        await page.click('#confirm-action');
        await page.waitForSelector('#meeting-area:not(.hidden)', { timeout: 20000 });
        await expect(page.locator('#meeting-area:not(.hidden)')).toBeVisible();
        await expect(page.locator('#max-delete')).toHaveText('3');

        const deleteMax = await page.evaluate(() => {
            return window.game.turnManager.getCurrentDeleteMax();
        });
        expect(deleteMax).toBe(3);
    });
});

test.describe('初回研修リフレッシュ', () => {
    test('初回研修でリフレッシュ後も4枚表示・2枚選択できる', async ({ page }) => {
        // PRO難易度でゲーム開始（FRESHはリフレッシュ機能なし）
        await page.goto('/');
        await page.click('#btn-difficulty-pro');
        await page.click('#start-game');
        await page.waitForSelector('#training-area:not(.hidden)');

        // 初回研修: 4枚表示を確認
        const initialCount = await page.locator('#training-cards .card').count();
        expect(initialCount).toBe(4);

        // リフレッシュ
        await page.click('#btn-training-refresh');

        // リフレッシュ後も4枚表示されることを確認
        const afterCount = await page.locator('#training-cards .card').count();
        expect(afterCount).toBe(4);

        // 1枚目をタップ（選択）
        await page.locator('#training-cards .card').nth(0).click();
        // 2枚目をタップ（選択）
        await page.locator('#training-cards .card').nth(1).click();

        // 確定ボタンが有効になることを確認（2枚選択で解放）
        const confirmEnabled = await page.locator('#confirm-training').isEnabled();
        expect(confirmEnabled).toBe(true);

        // 確定してデッキに2枚追加されることを確認
        await page.click('#confirm-training');
        await page.waitForSelector('#action-area:not(.hidden)');

        const deckSize = await page.evaluate(() =>
            window.game.gameState.player.deck.length + window.game.gameState.player.hand.length
        );
        // 初期デッキ8枚 + 習得2枚 = 10枚
        expect(deckSize).toBe(10);
    });
});
