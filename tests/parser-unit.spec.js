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
