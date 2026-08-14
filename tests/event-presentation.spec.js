import { test, expect } from '@playwright/test';

test.describe('イベントアイテム獲得演出', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.locator('#event-mode-toggle').check();
        await page.locator('#start-game').click();
        await expect(page.locator('.event-presentation')).toBeVisible();
    });

    test('白背景でも文字を黒ベースで表示する', async ({ page }) => {
        const presentation = page.locator('.event-presentation');
        await expect(presentation).toHaveCSS('background-color', 'rgb(255, 255, 255)');
        await expect(presentation).toHaveCSS('color', 'rgb(31, 41, 55)');
    });

    test('演出中の再読み込みではタイトル画面を表示しない', async ({ page }) => {
        await page.reload();

        await expect(page.locator('.event-presentation')).toBeVisible();
        await expect(page.locator('#start-overlay')).toHaveClass(/hidden/);
    });

    test('教室行動の最後に室長、講師、事務、塾アイテムの順で同じ体裁の演出を表示する', async ({ page }) => {
        // 開始時の新聞取材・アイデアの化学反応の入手演出を完了する。
        await page.locator('.event-presentation button').click();
        await expect(page.locator('.event-presentation')).toBeVisible();
        await page.locator('.event-presentation button').click();
        await expect(page.locator('.event-presentation')).toBeHidden();

        const result = await page.evaluate(async () => {
            const ui = window.game.uiController;
            const gameState = window.game.gameState;
            const stats = {
                experience: gameState.player.experience,
                enrollment: gameState.player.enrollment,
                satisfaction: gameState.player.satisfaction,
                accounting: gameState.player.accounting
            };
            const makeCard = role => ({
                cardName: `${role}テストカード`,
                category: '動員',
                effect: '体験+0'
            });
            const makeEffect = () => ({
                beforeStats: { ...stats },
                afterStats: { ...stats },
                isRecommended: false,
                recommendedApplied: false,
                applied: true
            });

            gameState.player.placed = {
                leader: [makeCard('室長')],
                teacher: [makeCard('講師')],
                staff: [makeCard('事務')]
            };
            gameState.eventCardUsage = { '動員': 3 };
            gameState.event.items['press-coverage'].triggerCountThisTurn = 0;

            const labels = [];
            const cardsHost = document.getElementById('animation-cards');
            const observer = new MutationObserver(() => {
                const label = cardsHost.querySelector('.anim-staff-name')?.textContent?.trim();
                if (label && labels.at(-1) !== label) labels.push(label);
            });
            observer.observe(cardsHost, { childList: true, subtree: true });

            const originalSleep = ui._sleep;
            const originalFinishActionPhase = ui.finishActionPhase;
            ui._sleep = () => new Promise(resolve => setTimeout(resolve, 10));
            ui.finishActionPhase = async () => {};
            try {
                await ui.showStatusAnimation(stats, stats, {
                    cardEffects: {
                        leader: { cards: [makeEffect()] },
                        teacher: { cards: [makeEffect()] },
                        staff: { cards: [makeEffect()] }
                    }
                });
            } finally {
                observer.disconnect();
                ui._sleep = originalSleep;
                ui.finishActionPhase = originalFinishActionPhase;
            }

            return {
                labels,
                role: cardsHost.querySelector('.anim-staff-name')?.textContent?.trim(),
                name: cardsHost.querySelector('.anim-card-name')?.textContent?.trim(),
                effect: cardsHost.querySelector('.anim-card-effect')?.textContent?.trim(),
                imageAlt: cardsHost.querySelector('.anim-card-thumbnail')?.getAttribute('alt'),
                experience: gameState.player.experience,
                presentation: gameState.event.presentation
            };
        });

        expect(result.labels).toEqual(['室長', '講師', '事務', '塾アイテム']);
        expect(result.role).toBe('塾アイテム');
        expect(result.name).toContain('🏆新聞取材');
        expect(result.effect).toContain('体験+2');
        expect(result.imageAlt).toBe('🏆新聞取材');
        expect(result.experience).toBe(2);
        expect(result.presentation).toBeNull();
    });
});
