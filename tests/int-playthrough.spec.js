import { test, expect } from './fixtures.js';

const choices = '#training-cards .card';

async function prepare(page) {
    await page.evaluate(() => {
        const ui = window.game.uiController;
        ui.actionAnimation.clock.wait = async () => {};
        ui.showTurnOverlay = () => {};
    });
}

async function finishTraining(page, pickCount = 1) {
    await expect(page.locator('#training-area')).toBeVisible();
    for (let i = 0; i < pickCount; i++) await page.locator(choices).nth(i).click();
    await page.locator('#confirm-training').click();
}

async function finishMeeting(page) {
    await expect(page.locator('#meeting-area')).toBeVisible();
    await expect(page.locator('#confirm-meeting')).toBeDisabled();
    await page.locator('#deck-cards .card').first().click();
    await page.locator('#confirm-meeting').click();
}

test('INTを完走し、外出の途中から再開して講習のカードと結果を保持する', async ({ page, scoreSubmissions }) => {
    test.setTimeout(90_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());

    await page.goto('/');
    await page.locator('#btn-difficulty-int').click();
    await expect(page.locator('#start-battle')).toBeHidden();
    await page.locator('#start-game').click();
    await expect(page.locator(choices)).toHaveCount(4);
    await expect(page.locator(choices).locator('.rarity-SR')).toHaveCount(4);
    await expect(page.locator('#training-refresh-count')).toHaveText('残り3回');
    await page.locator('#btn-training-refresh').click();
    await expect(page.locator('#training-refresh-count')).toHaveText('残り2回');
    await prepare(page);
    await finishTraining(page, 2);

    for (const turn of [1, 2, 4, 5]) {
        if (turn > 1) await finishTraining(page);
        await page.locator('#confirm-action').click();
        await finishMeeting(page);
        if (turn !== 2) continue;

        await expect(page.locator('[data-outing-place]')).toHaveCount(3);
        await page.locator('[data-outing-place="bookstore"]').click();
        await expect(page.locator('.int-outing-card')).toHaveCount(3);
        await page.locator('[data-outing-refresh]').click();
        await expect(page.locator('[data-outing-refresh]')).toContainText('残り1回');
        await page.locator('.int-outing-card').nth(0).click();
        await page.locator('.int-outing-card').nth(1).click();
        const deleteCards = page.locator('.int-outing-delete-card');
        await expect(deleteCards).toHaveCount(8);
        const cardName = await deleteCards.first().locator('.card-name').innerText();
        await page.reload();
        await expect(deleteCards).toHaveCount(8);
        await expect(deleteCards.first().locator('.card-name')).toHaveText(cardName);
        await deleteCards.first().click();
        await prepare(page);
    }

    await expect(page.locator('[data-outing-place]')).toHaveCount(3);
    await page.locator('[data-outing-place="headquarters"]').click();
    await expect(page.locator('.int-outing-card')).toHaveCount(3);
    await page.locator('.int-outing-card').first().click();
    await expect(page.locator('[data-outing-staff]')).toHaveCount(3);
    await page.reload();
    await expect(page.locator('[data-outing-staff]')).toHaveCount(3);
    const ownedBefore = await page.evaluate(() => window.game.gameState.getOwnedCards().length);
    await page.locator('[data-outing-staff="staff"]').click();
    await expect(page.locator('#action-area')).toBeVisible();
    expect(await page.evaluate(() => window.game.gameState.getOwnedCards().length)).toBe(ownedBefore);
    await prepare(page);

    await expect(page.locator('#hand-cards .card')).toHaveCount(3);
    await page.locator('#hand-cards .card').first().click();
    const firstDay = await page.evaluate(() => {
        const state = window.game.gameState;
        return {
            used: Object.values(state.player.placed).flat().map(card => card.instanceId),
            kept: state.player.hand.map(card => card.instanceId)
        };
    });
    expect(firstDay.used).toHaveLength(1);
    expect(firstDay.kept).toHaveLength(2);

    for (const day of [1, 2, 3, 4, 5]) {
        if (day === 3) await finishTraining(page);
        await page.locator('#confirm-action').click();
        await page.waitForFunction(turn => {
            const state = window.game.gameState;
            return state.phase === 'meeting' || state.turn > turn;
        }, 5 + day);
        if (await page.evaluate(() => window.game.gameState.phase === 'meeting')) {
            const excluded = [...firstDay.used, ...firstDay.kept];
            const deletionIndex = await page.evaluate(ids =>
                window.game.turnManager.getMeetingDeleteCandidates().findIndex(card => !ids.includes(card.instanceId)), excluded);
            expect(deletionIndex).toBeGreaterThanOrEqual(0);
            await page.locator('#deck-cards .card').nth(deletionIndex).click();
            await page.locator('#confirm-meeting').click();
        }
        await expect.poll(() => page.evaluate(() => window.game.gameState.turn)).toBe(6 + day);
        if (day === 1) {
            const state = await page.evaluate(() => {
                const { player, ruleState } = window.game.gameState;
                return {
                    discarded: ruleState.int.springDiscard.map(card => card.instanceId),
                    hand: player.hand.map(card => card.instanceId)
                };
            });
            expect(state.discarded).toEqual(firstDay.used);
            expect(state.hand).toEqual(expect.arrayContaining(firstDay.kept));
        }
    }

    await expect(page.locator('#training-area')).toBeVisible();
    const april = await page.evaluate(() => {
        const { player, ruleState } = window.game.gameState;
        return {
            discarded: ruleState.int.springDiscard.length,
            deck: player.deck.map(card => card.instanceId)
        };
    });
    expect(april.discarded).toBe(0);
    expect(april.deck).toEqual(expect.arrayContaining([...firstDay.used, ...firstDay.kept]));
    await finishTraining(page);
    await page.locator('#confirm-action').click();
    await finishTraining(page);
    await page.locator('#confirm-action').click();
    await expect(page.locator('#result-area')).toBeVisible();
    await expect(page.locator('#result-rank')).not.toBeEmpty();
    const history = await page.evaluate(() => window.game.uiController.resultController.repository.history());
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ difficulty: 'int', submission: 'local' });
    expect(scoreSubmissions).toEqual([]);
    expect(errors).toEqual([]);
});
