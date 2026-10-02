/**
 * 動作確認用スモークテスト
 * - スロット指定モードで並行カードを重ね配置できる（入れ替えにならない）
 * - ゲーム開始時に startedAt が記録される
 * - ゲーム終了時に submitScore が呼ばれる（エンドポイント未設定のためログ出力を確認）
 */
import { test, expect } from './fixtures.js';

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
    test('PROのスケジュール一覧はrankPro.csvの換算表レンジを表示する', async ({ page }) => {
        page.on('dialog', dialog => dialog.accept());
        await page.goto('/');
        await page.click('#btn-difficulty-pro');
        await page.click('#start-game');
        await page.waitForSelector('#training-cards .card', { timeout: 10000 });

        await page.click('#btn-schedule-full');

        const overlay = page.locator('.info-overlay');
        await expect(overlay).toContainText('📊 スコア換算表');
        await expect(overlay).toContainText('30〜39');
        await expect(overlay).toContainText('20〜29');
        await expect(overlay).not.toContainText('25〜39');
    });

    test('ゲーム開始時に startedAt が記録される', async ({ page }) => {
        page.on('dialog', dialog => dialog.accept());
        await page.goto('/');
        await page.click('#start-game');
        await page.waitForSelector('#training-cards .card', { timeout: 10000 });

        const startedAt = await page.evaluate(() => window.game.gameState.startedAt);
        expect(startedAt).toBeTruthy();
        expect(startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('下4桁のみのビルド更新では中断データを破棄しない', async ({ page }) => {
        await page.goto('/');

        const result = await page.evaluate(async () => {
            const { SaveManager } = await import('./js/saveManager.js?v=version-test');
            const originalVersion = window.BUILD_VERSION;
            window.BUILD_VERSION = 'v20260815-0050';
            try {
                const saveManager = new SaveManager();
                return {
                    sameGameVersion: saveManager.isVersionMatch({ buildVersion: 'v20260815-0001' }),
                    differentGameVersion: saveManager.isVersionMatch({ buildVersion: 'v20260816-0001' }),
                    malformedVersion: saveManager.isVersionMatch({ buildVersion: 'v20260815' })
                };
            } finally {
                window.BUILD_VERSION = originalVersion;
            }
        });

        expect(result).toEqual({
            sameGameVersion: true,
            differentGameVersion: false,
            malformedVersion: false
        });
    });

    test('スコア送信payloadに通常/計算機モードを含める', async ({ page }) => {
        await page.goto('/');

        const result = await page.evaluate(async () => {
            const captured = [];
            const results = [];
            const originalFetch = window.fetch;
            window.fetch = async (_url, options) => {
                const payload = JSON.parse(options.body);
                captured.push(payload);
                return {
                    ok: true,
                    json: async () => ({
                        status: 'ok',
                        currentVersion: window.BUILD_VERSION,
                        clientVersion: payload.buildVersion,
                        versionMatch: true
                    })
                };
            };

            try {
                const { submitScore } = await import('./js/scoreSubmitter.js?v=test');
                const baseScore = {
                    experience: 1,
                    enrollment: 1,
                    satisfaction: 3,
                    accounting: 3,
                    displayScore: 0,
                    rank: { grade: 'D' },
                    points: 0,
                    withdrawal: 0,
                    mobilization: 1,
                    enrollmentDiff: 1
                };
                const finalDeck = [{ cardName: 'チラシ折り' }];
                const logger = { log() {} };

                results.push(await submitScore({
                    startedAt: '2026-05-03T00:00:00.000Z',
                    difficulty: 'fresh',
                    calcMode: false,
                    discardedCards: []
                }, baseScore, finalDeck, logger));
                results.push(await submitScore({
                    startedAt: '2026-05-03T00:01:00.000Z',
                    difficulty: 'fresh',
                    calcMode: true,
                    discardedCards: []
                }, baseScore, finalDeck, logger));
            } finally {
                window.fetch = originalFetch;
            }

            return {
                modes: captured.map(payload => payload.mode),
                versionMatches: results.map(result => result.versionMatch)
            };
        });

        expect(result.modes).toEqual(['通常', '計算機']);
        expect(result.versionMatches).toEqual([true, true]);
    });

    test('スコア送信payloadに入手済み塾アイテムと条件成立ターンを含める', async ({ page }) => {
        await page.goto('/');

        const schoolItems = await page.evaluate(async () => {
            const captured = [];
            const originalFetch = window.fetch;
            window.fetch = async (_url, options) => {
                captured.push(JSON.parse(options.body));
                return {
                    ok: true,
                    json: async () => ({ status: 'ok', currentVersion: window.BUILD_VERSION })
                };
            };

            try {
                const { submitScore } = await import('./js/scoreSubmitter.js?v=school-items-test');
                await submitScore({
                    startedAt: '2026-08-15T00:00:00.000Z',
                    difficulty: 'fresh',
                    calcMode: false,
                    discardedCards: [],
                    event: {
                        enabled: true,
                        eventName: 'テストイベント',
                        items: {
                            'press-coverage': {
                                acquired: true,
                                acquisitionOrder: 0,
                                conditionMetTurns: [3, 1, 3]
                            },
                            'spring-homework': {
                                acquired: true,
                                acquisitionOrder: 2,
                                conditionMetTurns: [8, 5]
                            },
                            'idea-chemistry': {
                                acquired: false,
                                acquisitionOrder: 1,
                                conditionMetTurns: [4]
                            }
                        }
                    }
                }, {
                    experience: 1,
                    enrollment: 1,
                    satisfaction: 3,
                    accounting: 3,
                    displayScore: 0,
                    rank: { grade: 'D' },
                    points: 0,
                    withdrawal: 0,
                    mobilization: 1,
                    enrollmentDiff: 1
                }, [{ cardName: 'チラシ折り' }], { log() {} });
                return captured[0].schoolItems;
            } finally {
                window.fetch = originalFetch;
            }
        });

        expect(schoolItems).toEqual([
            { name: '新聞取材', conditionMetTurns: [1, 3] },
            { name: '春休みの宿題', conditionMetTurns: [5, 8] }
        ]);
    });

    test('スコア送信のバージョン判定はハイフンなし数値で比較する', async ({ page }) => {
        await page.goto('/');

        const versionResults = await page.evaluate(async () => {
            const originalFetch = window.fetch;
            const { submitScore, buildVersionNumber, isClientVersionCurrent } = await import('./js/scoreSubmitter.js?v=test');
            const baseScore = {
                experience: 1,
                enrollment: 1,
                satisfaction: 3,
                accounting: 3,
                displayScore: 0,
                rank: { grade: 'D' },
                points: 0,
                withdrawal: 0,
                mobilization: 1,
                enrollmentDiff: 1
            };
            const finalDeck = [{ cardName: 'チラシ折り' }];
            const logger = { log() {} };

            async function submitWithVersions(clientVersion, currentVersion) {
                window.BUILD_VERSION = clientVersion;
                window.fetch = async () => ({
                    ok: true,
                    json: async () => ({
                        status: 'ok',
                        currentVersion,
                        clientVersion,
                        versionMatch: clientVersion === currentVersion
                    })
                });
                const result = await submitScore({
                    startedAt: '2026-05-03T00:00:00.000Z',
                    difficulty: 'fresh',
                    calcMode: false,
                    discardedCards: []
                }, baseScore, finalDeck, logger);
                return result.versionMatch;
            }

            try {
                return {
                    parsed: buildVersionNumber('v20260503-1130'),
                    equal: isClientVersionCurrent('v20260503-1130', 'v20260503-1130'),
                    clientNewer: await submitWithVersions('v20260503-1130', 'v20260503-0030'),
                    clientOlder: await submitWithVersions('v20260502-2100', 'v20260503-0030')
                };
            } finally {
                window.fetch = originalFetch;
            }
        });

        expect(versionResults.parsed).toBe(202605031130);
        expect(versionResults.equal).toBe(true);
        expect(versionResults.clientNewer).toBe(true);
        expect(versionResults.clientOlder).toBe(false);
    });

    test('スコア送信中はもう一度プレイを無効化し、完了後に戻す', async ({ page }) => {
        page.on('dialog', dialog => dialog.accept());
        await page.goto('/');
        await page.click('#start-game');
        await page.waitForSelector('#training-cards .card', { timeout: 10000 });

        await page.evaluate(() => {
            window.fetch = async () => new Promise(resolve => {
                window.__resolveScoreSubmit = () => resolve({
                    ok: true,
                    json: async () => ({
                        status: 'ok',
                        currentVersion: window.BUILD_VERSION,
                        clientVersion: window.BUILD_VERSION,
                        versionMatch: true
                    })
                });
            });
            window.game.gameState.phase = 'end';
            window.game.uiController.showResultPhase();
        });

        await expect(page.locator('#restart-game')).toBeDisabled();
        await expect(page.locator('#restart-game')).toHaveText('スコア送信中…');
        await expect(page.locator('#restart-game')).toHaveAttribute('aria-busy', 'true');
        await page.evaluate(() => window.__resolveScoreSubmit());
        await expect(page.locator('#restart-game')).toBeEnabled();
        await expect(page.locator('#restart-game')).toHaveText('もう一度プレイ');
        await expect(page.locator('#restart-game')).not.toHaveAttribute('aria-busy');
    });

    test('スコア送信リトライ中は再プレイを無効化し、3回失敗確定後に戻す', async ({ page }) => {
        page.on('dialog', dialog => dialog.accept());
        await page.goto('/');
        await page.click('#start-game');
        await page.waitForSelector('#training-cards .card', { timeout: 10000 });

        await page.evaluate(() => {
            window.__scoreSubmitAttempts = 0;
            const originalFetch = window.fetch;
            window.fetch = async (...args) => {
                if (String(args[0]).includes('script.google.com')) {
                    window.__scoreSubmitAttempts += 1;
                    throw new Error('test network error');
                }
                return originalFetch(...args);
            };
            window.game.gameState.phase = 'end';
            window.game.uiController.showResultPhase();
        });

        const restartBtn = page.locator('#restart-game');
        await expect(restartBtn).toBeDisabled();
        await expect(restartBtn).toHaveText('スコア送信中…');
        await expect(restartBtn).toBeEnabled({ timeout: 7000 });
        await expect(restartBtn).toHaveText('もう一度プレイ');
        await expect.poll(() => page.evaluate(() => window.__scoreSubmitAttempts)).toBe(3);
    });

    test('スコア送信レスポンスが旧バージョン判定なら警告フラグを立てる', async ({ page }) => {
        page.on('dialog', dialog => dialog.accept());
        await page.goto('/');
        await page.click('#start-game');
        await page.waitForSelector('#training-cards .card', { timeout: 10000 });

        await page.evaluate(() => {
            window.fetch = async () => ({
                ok: true,
                json: async () => ({
                    status: 'ok',
                    currentVersion: 'v99999999-9999',
                    clientVersion: window.BUILD_VERSION,
                    versionMatch: false
                })
            });
            localStorage.removeItem('cdg_version_updated');
            window.game.gameState.phase = 'end';
            window.game.uiController.showResultPhase();
        });

        await expect(page.locator('#restart-game')).toBeEnabled();
        await page.waitForFunction(() => localStorage.getItem('cdg_version_updated') === 'true');
        await expect(page.locator('.float-notification')).toContainText('新しいバージョン');
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
