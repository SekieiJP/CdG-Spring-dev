/**
 * カード効果パーサー単体テスト
 * ブラウザ内でCardManagerのパース機能を直接テスト
 */
import { test, expect } from '@playwright/test';

test.describe('効果テキストパーサー単体テスト', () => {
    let page;

    test.beforeEach(async ({ page: p }) => {
        page = p;
        await page.goto('/');
        // CardManagerモジュールを読み込んでテスト用にグローバルに公開
        await page.evaluate(async () => {
            const { CardManager } = await import('./js/cardManager.js?v=test');
            window.testCardManager = new CardManager();
        });
    });

    test('基本効果「体験+2」をパースできる', async () => {
        const result = await page.evaluate(() => {
            return window.testCardManager.parseEffect('体験+2。');
        });
        expect(result.baseEffects).toHaveLength(1);
        expect(result.baseEffects[0].status).toBe('experience');
        expect(result.baseEffects[0].value).toBe(2);
    });

    test('複合効果「満足+4、入塾+1」をパースできる', async () => {
        const result = await page.evaluate(() => {
            return window.testCardManager.parseEffect('満足+4、入塾+1。');
        });
        expect(result.baseEffects).toHaveLength(2);
        expect(result.baseEffects[0].status).toBe('satisfaction');
        expect(result.baseEffects[0].value).toBe(4);
        expect(result.baseEffects[1].status).toBe('enrollment');
        expect(result.baseEffects[1].value).toBe(1);
    });

    test('マイナス効果「入塾+4、満足-1」をパースできる', async () => {
        const result = await page.evaluate(() => {
            return window.testCardManager.parseEffect('入塾+4、満足-1。');
        });
        expect(result.baseEffects).toHaveLength(2);
        const negEffect = result.baseEffects.find(e => e.value < 0);
        expect(negEffect.status).toBe('satisfaction');
        expect(negEffect.value).toBe(-1);
    });

    test('スタッフ制限【室長・講師】をパースできる', async () => {
        const result = await page.evaluate(() => {
            return window.testCardManager.parseEffect('【室長・講師】入塾+3。');
        });
        expect(result.staffRestrictions).toContain('leader');
        expect(result.staffRestrictions).toContain('teacher');
        expect(result.staffRestrictions).not.toContain('staff');
    });

    test('スタッフ条件〈室長〉をパースできる', async () => {
        const result = await page.evaluate(() => {
            return window.testCardManager.parseEffect('体験+1。〈室長〉さらに体験+2。');
        });
        expect(result.baseEffects).toHaveLength(1);
        expect(result.baseEffects[0].value).toBe(1);

        expect(result.conditionalBlocks).toHaveLength(1);
        expect(result.conditionalBlocks[0].condition.type).toBe('staff');
        expect(result.conditionalBlocks[0].condition.staffList).toContain('leader');
    });

    test('複合スタッフ条件〈講師・事務〉をパースできる', async () => {
        const result = await page.evaluate(() => {
            return window.testCardManager.parseEffect('満足+1。〈講師・事務〉さらに満足+2。');
        });
        expect(result.conditionalBlocks[0].condition.staffList).toContain('teacher');
        expect(result.conditionalBlocks[0].condition.staffList).toContain('staff');
    });

    test('ステータス条件〈満足8以上〉をパースできる', async () => {
        const result = await page.evaluate(() => {
            return window.testCardManager.parseEffect('体験+4。〈満足8以上〉さらに入塾+2。');
        });
        expect(result.conditionalBlocks).toHaveLength(1);
        expect(result.conditionalBlocks[0].condition.type).toBe('status');
        expect(result.conditionalBlocks[0].condition.status).toBe('satisfaction');
        expect(result.conditionalBlocks[0].condition.value).toBe(8);
        expect(result.conditionalBlocks[0].condition.comparison).toBe('gte');
    });

    test('ステータス条件〈経理13以下〉をパースできる', async () => {
        const result = await page.evaluate(() => {
            return window.testCardManager.parseEffect('〈経理13以下〉経理を14にする。');
        });
        expect(result.conditionalBlocks).toHaveLength(1);
        expect(result.conditionalBlocks[0].condition.comparison).toBe('lte');
        expect(result.conditionalBlocks[0].condition.value).toBe(13);
    });

    test('絶対値設定「経理を14にする」をパースできる', async () => {
        const result = await page.evaluate(() => {
            return window.testCardManager.parseEffect('〈経理13以下〉経理を14にする。');
        });
        const setEffect = result.conditionalBlocks[0].effects.find(e => e.type === 'set');
        expect(setEffect).toBeDefined();
        expect(setEffect.status).toBe('accounting');
        expect(setEffect.value).toBe(14);
    });

    test('全CSVカードの効果がパース可能', async () => {
        // CSVを読み込んで全カードの効果をパース
        const results = await page.evaluate(async () => {
            const response = await fetch('./data/cards.csv');
            const csvText = await response.text();
            const lines = csvText.trim().split('\n').slice(1); // ヘッダースキップ

            const parseResults = [];
            for (const line of lines) {
                const parts = line.split(',');
                if (parts.length >= 4) {
                    const effectText = parts[3].trim();
                    try {
                        const parsed = window.testCardManager.parseEffect(effectText);
                        parseResults.push({
                            cardName: parts[2].trim(),
                            effect: effectText,
                            parsed: parsed,
                            success: true
                        });
                    } catch (e) {
                        parseResults.push({
                            cardName: parts[2].trim(),
                            effect: effectText,
                            error: e.message,
                            success: false
                        });
                    }
                }
            }
            return parseResults;
        });

        // 全カードがパース成功することを確認
        const failures = results.filter(r => !r.success ||
            (r.parsed.baseEffects.length === 0 && r.parsed.conditionalBlocks.length === 0));

        if (failures.length > 0) {
            console.log('パース失敗カード:', failures);
        }

        expect(failures).toHaveLength(0);
    });

    test('全PRO CSVカードの効果がパース可能', async () => {
        const results = await page.evaluate(async () => {
            const response = await fetch('./data/cards_pro.csv');
            const csvText = await response.text();
            window.testCardManager.allCards = [];
            window.testCardManager.parseCSV(csvText);

            const parseResults = [];
            for (const card of window.testCardManager.allCards) {
                try {
                    const parsed = window.testCardManager.parseEffect(card.effect);
                    const hasContent = parsed.baseEffects.length > 0
                        || parsed.conditionalBlocks.length > 0
                        || parsed.staffRestrictions.length > 0;
                    parseResults.push({ cardName: card.cardName, effect: card.effect, parsed, success: true, hasContent });
                } catch (e) {
                    parseResults.push({ cardName: card.cardName, effect: card.effect, error: e.message, success: false, hasContent: false });
                }
            }
            return parseResults;
        });

        const failures = results.filter(r => !r.success || !r.hasContent);
        if (failures.length > 0) {
            console.log('PRO パース失敗カード:', failures);
        }
        expect(failures).toHaveLength(0);
    });

    test('実PRO CSVのごほうび差し入れスイーツ効果を最後まで読み込める', async () => {
        const result = await page.evaluate(async () => {
            const response = await fetch('./data/cards_pro.csv');
            const csvText = await response.text();
            window.testCardManager.allCards = [];
            window.testCardManager.parseCSV(csvText);

            const card = window.testCardManager.allCards
                .find(card => card.cardName === 'ごほうび差し入れスイーツ');
            const parsed = window.testCardManager.parseEffect(card.effect);

            return {
                effect: card.effect,
                changes: parsed.baseEffects.filter(effect => effect.type === 'change')
                    .map(effect => `${effect.status}:${effect.value}`),
                tokens: parsed.baseEffects.filter(effect => effect.type === 'token')
                    .map(effect => effect.token)
            };
        });

        expect(result.effect).toContain('体験+1、入塾+1、満足+1。');
        expect(result.changes).toEqual(expect.arrayContaining([
            'experience:1',
            'enrollment:1',
            'satisfaction:1'
        ]));
        expect(result.tokens.filter(token => token === 'passion')).toHaveLength(2);
    });

    test('複数行CSVフィールドのカード効果を最後まで読み込める', async () => {
        const result = await page.evaluate(() => {
            const csv = [
                'category,rarity,cardName,topEffect,effect,cardNo',
                '庶務,SR,ごほうび差し入れスイーツ,"[長]✊, ✊, 体1, 入1, 満1","【室長】[情熱✊][情熱✊]',
                '体験+1、入塾+1、満足+1。",40'
            ].join('\n');

            window.testCardManager.allCards = [];
            window.testCardManager.parseCSV(csv);
            const card = window.testCardManager.allCards[0];
            const parsed = window.testCardManager.parseEffect(card.effect);
            const gameState = {
                player: { experience: 0, enrollment: 0, satisfaction: 0, accounting: 5 },
                tokens: { passion: 0, inspiration: 0, organize: 0, fatigue: 0 },
                updateStatus(type, delta) {
                    const oldValue = this.player[type];
                    let newValue = Math.max(0, oldValue + delta);
                    if (type === 'enrollment') {
                        newValue = Math.min(newValue, this.player.experience);
                    }
                    this.player[type] = newValue;
                    return newValue - oldValue;
                }
            };
            window.testCardManager.applyCardEffect(card, 'leader', gameState);

            return {
                count: window.testCardManager.allCards.length,
                effect: card.effect,
                changes: parsed.baseEffects.filter(effect => effect.type === 'change')
                    .map(effect => `${effect.status}:${effect.value}`),
                tokens: parsed.baseEffects.filter(effect => effect.type === 'token')
                    .map(effect => effect.token),
                player: gameState.player,
                appliedTokens: gameState.tokens
            };
        });

        expect(result.count).toBe(1);
        expect(result.effect).toContain('体験+1、入塾+1、満足+1。');
        expect(result.changes).toEqual(expect.arrayContaining([
            'experience:1',
            'enrollment:1',
            'satisfaction:1'
        ]));
        expect(result.tokens.filter(token => token === 'passion')).toHaveLength(2);
        expect(result.player.experience).toBe(1);
        expect(result.player.enrollment).toBe(1);
        expect(result.player.satisfaction).toBe(1);
        expect(result.appliedTokens.passion).toBe(2);
    });
});

test.describe('条件評価テスト', () => {
    let page;

    test.beforeEach(async ({ page: p }) => {
        page = p;
        await page.goto('/');
        await page.evaluate(async () => {
            const { CardManager } = await import('./js/cardManager.js?v=test');
            window.testCardManager = new CardManager();
        });
    });

    test('スタッフ条件が正しく評価される（一致）', async () => {
        const result = await page.evaluate(() => {
            const condition = { type: 'staff', staffList: ['leader'] };
            const mockGameState = { player: {} };
            return window.testCardManager.evaluateCondition(condition, 'leader', mockGameState);
        });
        expect(result).toBe(true);
    });

    test('スタッフ条件が正しく評価される（不一致）', async () => {
        const result = await page.evaluate(() => {
            const condition = { type: 'staff', staffList: ['leader'] };
            const mockGameState = { player: {} };
            return window.testCardManager.evaluateCondition(condition, 'teacher', mockGameState);
        });
        expect(result).toBe(false);
    });

    test('ステータス条件「以上」が正しく評価される', async () => {
        const result = await page.evaluate(() => {
            const condition = { type: 'status', status: 'satisfaction', value: 8, comparison: 'gte' };
            const mockGameState = { player: { satisfaction: 10 } };
            return window.testCardManager.evaluateCondition(condition, 'leader', mockGameState);
        });
        expect(result).toBe(true);
    });

    test('ステータス条件「以下」が正しく評価される', async () => {
        const result = await page.evaluate(() => {
            const condition = { type: 'status', status: 'accounting', value: 13, comparison: 'lte' };
            const mockGameState = { player: { accounting: 10 } };
            return window.testCardManager.evaluateCondition(condition, 'staff', mockGameState);
        });
        expect(result).toBe(true);
    });
});

test.describe('コスト不足によるカード効果無効化', () => {
    let page;

    test.beforeEach(async ({ page: p }) => {
        page = p;
        await page.goto('/');
        await page.evaluate(async () => {
            const { CardManager } = await import('./js/cardManager.js?v=test');
            window.testCardManager = new CardManager();
        });
    });

    test('無条件マイナス効果でステータスが負になる場合、カード効果全体が無効になる', async () => {
        const result = await page.evaluate(() => {
            const gameState = {
                player: { experience: 0, enrollment: 0, satisfaction: 0, accounting: 0 },
                tokens: { passion: 0, inspiration: 0, organize: 0, fatigue: 0 },
                updateStatus(type, delta) {
                    this.player[type] = Math.max(0, this.player[type] + delta);
                    return delta;
                }
            };
            const card = {
                cardName: 'コスト不足テスト',
                effect: '体験+2、満足-1。[情熱✊]'
            };

            const applied = window.testCardManager.applyCardEffect(card, 'leader', gameState);
            return { applied, player: gameState.player, tokens: gameState.tokens };
        });

        expect(result.applied.applied).toBe(false);
        expect(result.applied.skippedReason).toBe('cost_shortage');
        expect(result.player.experience).toBe(0);
        expect(result.player.satisfaction).toBe(0);
        expect(result.tokens.passion).toBe(0);
    });

    test('条件未成立ブロック内のマイナス効果はコスト不足判定の対象外', async () => {
        const result = await page.evaluate(() => {
            const gameState = {
                player: { experience: 0, enrollment: 0, satisfaction: 0, accounting: 0 },
                tokens: { passion: 0, inspiration: 0, organize: 0, fatigue: 0 },
                updateStatus(type, delta) {
                    this.player[type] = Math.max(0, this.player[type] + delta);
                    return delta;
                }
            };
            const card = {
                cardName: '条件未成立テスト',
                effect: '体験+1。〈満足1以上〉満足-1。'
            };

            const applied = window.testCardManager.applyCardEffect(card, 'leader', gameState);
            return { applied, player: gameState.player };
        });

        expect(result.applied.applied).toBe(true);
        expect(result.player.experience).toBe(1);
        expect(result.player.satisfaction).toBe(0);
    });

    test('条件成立ブロック内のマイナス効果が不足すると基本効果も無効になる', async () => {
        const result = await page.evaluate(() => {
            const gameState = {
                player: { experience: 0, enrollment: 0, satisfaction: 0, accounting: 0 },
                tokens: { passion: 0, inspiration: 0, organize: 0, fatigue: 0 },
                updateStatus(type, delta) {
                    this.player[type] = Math.max(0, this.player[type] + delta);
                    return delta;
                }
            };
            const card = {
                cardName: '条件成立テスト',
                effect: '体験+1。〈満足0以上〉満足-1。'
            };

            const applied = window.testCardManager.applyCardEffect(card, 'leader', gameState);
            return { applied, player: gameState.player };
        });

        expect(result.applied.applied).toBe(false);
        expect(result.player.experience).toBe(0);
        expect(result.player.satisfaction).toBe(0);
    });

    test('おすすめカードがコスト不足の場合、おすすめボーナスも適用されない', async ({ page }) => {
        await page.click('#btn-difficulty-fresh');
        await page.click('#start-game');
        await page.waitForSelector('#training-cards .card', { timeout: 10000 });

        const result = await page.evaluate(() => {
            window.game.gameState.phase = 'action';
            window.game.gameState.turn = 0; // おすすめ: 動員 / 体験
            window.game.gameState.player.experience = 0;
            window.game.gameState.player.enrollment = 0;
            window.game.gameState.player.satisfaction = 0;
            window.game.gameState.player.accounting = 0;
            window.game.gameState.player.placed = {
                leader: [{
                    category: '動員',
                    rarity: 'R',
                    cardName: 'おすすめ不足テスト',
                    topEffect: '体1, 満-1',
                    effect: '体験+1、満足-1。'
                }],
                teacher: [],
                staff: []
            };

            const actionInfo = window.game.turnManager.executeActions();
            return {
                player: { ...window.game.gameState.player },
                perCard: actionInfo.cardEffects.leader.cards[0]
            };
        });

        expect(result.perCard.applied).toBe(false);
        expect(result.perCard.skippedReason).toBe('cost_shortage');
        expect(result.perCard.isRecommended).toBe(true);
        expect(result.perCard.recommendedApplied).toBe(false);
        expect(result.player.experience).toBe(0);
        expect(result.player.satisfaction).toBe(0);
    });
});
