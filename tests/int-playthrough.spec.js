import { test, expect } from './fixtures.js';
import { createScoreReceiver } from './helpers/score-receiver.mjs';
import { expectResultImageDownload } from './helpers/result-image.js';

const choices = '#training-cards .card';

async function prepare(page) {
    await page.evaluate(() => {
        const ui = window.game.uiController;
        ui.actionAnimation.clock.wait = async () => {};
        const showTurnOverlay = ui.showTurnOverlay.bind(ui);
        ui.showTurnOverlay = config => {
            if (config.week === '春期4日目') showTurnOverlay(config);
        };
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
    await expect(page.locator('#confirm-meeting')).toBeEnabled();
    await page.locator('#confirm-meeting').click();
}

test('MASTERを完走し、外出の途中から再開して旧INTの記録を引き継ぐ', async ({ page, scoreSubmissions }) => {
    test.setTimeout(90_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());

    const receiver = createScoreReceiver();
    const author = receiver.submit({ action: 'sharing.enable', nickname: '授業の先生' });
    await page.addInitScript(profile => localStorage.setItem('cdg_sharing_preference_v1',
        JSON.stringify({ ...profile, enabled: true, nickname: '授業の先生' })), author);
    await page.route('https://script.google.com/**', async route => {
        const payload = route.request().postDataJSON();
        if (payload.action === 'score.submit') scoreSubmissions.push(payload);
        await route.fulfill({ json: receiver.submit(payload) });
    });
    await page.goto('/');
    await expect(page.locator('#start-game')).toBeEnabled();
    await expect(page.locator('#btn-difficulty-int')).toContainText('MASTER');
    await page.evaluate(() => {
        localStorage.setItem('bdrinkai_highscore_int', JSON.stringify({ points: 100, displayScore: 100 }));
    });
    await page.locator('#btn-difficulty-int').click();
    await expect(page.locator('#start-battle')).toBeVisible();
    await page.locator('#start-game').click();
    await expect(page.locator(choices)).toHaveCount(4);
    await expect(page.locator(choices).locator('.rarity-SR')).toHaveCount(4);
    await expect(page.locator('#training-refresh-count')).toHaveText('残り3回');
    await expect.poll(() => page.evaluate(() => window.game.uiController.acquisitionAssist.context?.advice.version)).toBe('master-v2');
    await page.clock.runFor(5100);
    await expect(page.locator('#training-area .acquisition-recommended').first()).toBeVisible();
    expect(await page.evaluate(() => window.game.uiController.ahiruAdvice.lastAdvice?.text)).toBeTruthy();
    await page.locator('#btn-training-refresh').click();
    await expect(page.locator('#training-refresh-count')).toHaveText('残り2回');
    await prepare(page);
    await finishTraining(page, 2);

    for (const turn of [1, 2, 4, 5]) {
        if (turn > 1) await finishTraining(page);
        await page.locator('#confirm-action').click();
        await finishMeeting(page);
        if (turn !== 2) continue;

        await expect(page.getByRole('heading', { name: '外出: 行き先を選択' })).toBeVisible();
        const places = page.locator('[data-outing-place]');
        await expect(places).toHaveCount(3);
        const positions = await places.evaluateAll(elements => elements.map(element => {
            const { x, y } = element.getBoundingClientRect();
            return { x, y };
        }));
        expect(new Set(positions.map(({ x }) => x)).size).toBe(1);
        expect(new Set(positions.map(({ y }) => y)).size).toBe(3);
        await expect(page.locator('[data-outing-place="bookstore"]')).toContainText('Rカード 3枚から2枚獲得');
        await expect(page.locator('[data-outing-place="headquarters"]')).toContainText('SSRカード 3枚から1枚を選んで1回発動');
        await page.locator('[data-outing-place="bookstore"]').click();
        await expect(page.locator('.int-outing-card')).toHaveCount(3);
        await page.locator('[data-outing-refresh]').click();
        await expect(page.locator('[data-outing-refresh]')).toContainText('残り1回');
        await page.locator('.int-outing-card').nth(0).click();
        await expect(page.locator('#confirm-outing')).toBeDisabled();
        await page.locator('.int-outing-card').nth(1).click();
        const before = await page.evaluate(() => window.game.gameState.getOwnedCards().length);
        const selected = await page.locator('.int-outing-card.selected .card-name').allTextContents();
        await page.reload();
        await expect(page.locator('.int-outing-card.selected .card-name')).toHaveText(selected);
        await page.locator('#confirm-outing').click();
        await expect(page.locator('#training-area')).toBeVisible();
        expect(await page.evaluate(() => window.game.gameState.getOwnedCards().length)).toBe(before + 2);
        await prepare(page);
    }

    await expect(page.locator('[data-outing-place]')).toHaveCount(3);
    await expect(page.locator('[data-outing-place="bookstore"]')).toContainText('Rカード 4枚から2枚獲得');
    await expect(page.locator('[data-outing-place="neighbor"]')).toContainText('SRカード 4枚から1枚獲得');
    await page.locator('[data-outing-place="headquarters"]').click();
    await expect(page.locator('.int-outing-card')).toHaveCount(4);
    await page.locator('.int-outing-card').first().click();
    await page.locator('#confirm-outing').click();
    const staffChoices = page.locator('[data-outing-staff]');
    await expect(staffChoices.first()).toBeVisible();
    const staffLabels = await staffChoices.allTextContents();
    await page.reload();
    await expect(staffChoices).toHaveText(staffLabels);
    const ownedBefore = await page.evaluate(() => window.game.gameState.getOwnedCards().length);
    await staffChoices.first().click();
    expect(await page.evaluate(() => window.game.gameState.playRecord.events
        .filter(event => event.turn === 5 && event.type === 'resolve'))).toHaveLength(1);
    await expect(page.locator('.turn-overlay-week')).toHaveText('春期1日目');
    await expect(page.locator('#action-area')).toBeVisible();
    expect(await page.evaluate(() => window.game.gameState.getOwnedCards().length)).toBe(ownedBefore);
    await prepare(page);

    await expect(page.locator('#hand-cards .card')).toHaveCount(3);
    await expect(page.locator('#action-area .spring-teaching-preview')).toHaveCount(2);
    expect(await page.evaluate(() => Object.values(window.game.gameState.player.placed).flat().length)).toBe(0);
    await page.locator('#hand-cards .card').first().click();
    await expect(page.locator('#action-area .spring-teaching-preview')).toHaveCount(1);
    const firstDay = await page.evaluate(() => {
        const state = window.game.gameState;
        return {
            used: Object.values(state.player.placed).flat().map(card => card.instanceId),
            kept: state.player.hand.map(card => card.instanceId)
        };
    });
    expect(firstDay.used).toHaveLength(1);
    expect(firstDay.kept).toHaveLength(2);

    for (const day of [1, 2, 3, 4]) {
        if (day === 3) await finishTraining(page);
        await page.locator('#confirm-action').click();
        await page.waitForFunction(turn => {
            const state = window.game.gameState;
            return state.phase === 'meeting' || state.turn > turn;
        }, 5 + day);
        if (await page.evaluate(() => window.game.gameState.phase === 'meeting')) {
            await expect(page.locator('#confirm-meeting')).toBeEnabled();
            await page.locator('#confirm-meeting').click();
        }
        await expect.poll(() => page.evaluate(() => window.game.gameState.turn)).toBe(6 + day);
        if (day === 3) await expect(page.locator('.turn-overlay-week')).toHaveText('春期4日目');
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
    const thumbnails = page.locator('#result-cards .result-card-thumb');
    await expect(thumbnails.first()).toBeVisible();
    await expect(thumbnails.first().locator('img')).toBeVisible();
    await expect(page.locator('#result-cards .card-detail-hint')).toHaveCount(0);
    await thumbnails.first().hover();
    await expect(page.locator('.hover-tooltip .tooltip-effect')).not.toBeEmpty();
    const history = await page.evaluate(() => window.game.uiController.resultController.repository.history());
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ difficulty: 'int', difficultyName: 'MASTER' });
    expect(await page.evaluate(() => window.game.scoreManager.getHighScore('int')?.displayScore)).toBe(100);

    await page.evaluate(() => {
        const stored = JSON.parse(localStorage.getItem('cdg_results_v1'));
        stored.history[0].difficultyName = 'INT';
        localStorage.setItem('cdg_results_v1', JSON.stringify(stored));
        const fillText = CanvasRenderingContext2D.prototype.fillText;
        window.resultImageText = [];
        CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
            window.resultImageText.push(text);
            fillText.call(this, text, ...args);
        };
    });
    await expectResultImageDownload(page);
    expect(await page.evaluate(() => window.resultImageText[0])).toContain('MASTER');
    await page.locator('#view-result-history').click();
    await page.locator('.result-history-entry summary').click();
    await expect(page.locator('[data-history-label]')).toContainText('MASTER');
    await expect(page.locator('[data-history-status]')).toContainText('送信済み');
    await expect(page.locator('#result-history-overlay [data-replay-view-id]')).toBeEnabled();
    await page.locator('#result-history-overlay [data-replay-view-id]').click();
    await expect(page.locator('#replay-scene-title')).toContainText('1/12ターン');
    const next = page.locator('#replay-next');
    while (!(await page.locator('#replay-scene-title').innerText()).includes('行き先選択') && await next.isEnabled()) await next.click();
    await expect(page.locator('#replay-scene-title')).toContainText('行き先選択');
    await expect(page.locator('#replay-actual-choice')).toContainText('書店');
    await next.click();
    await expect(page.locator('#replay-scene-cards .replay-actual-card')).toHaveCount(2);
    await page.locator('#replay-generate-example').click();
    await expect(page.locator('#replay-example-summary')).toContainText('MASTER');
    await page.locator('#replay-example-view').click();
    await expect(page.locator('#replay-source-description')).toContainText('あひる先生 / MASTER');
    expect(scoreSubmissions).toHaveLength(1);
    const [sent] = scoreSubmissions;
    expect(sent.difficulty).toBe('int');
    expect(sent.turnHistory.some(event => event.phase === 'outing')).toBe(true);
    const reader = receiver.submit({ action: 'sharing.enable', nickname: '読む先生' });
    expect(receiver.submit({ action: 'diary.get', sharingToken: reader.token, resultId: sent.resultId }).entry.replayText).toBe(sent.replayText);
    expect(errors).toEqual([]);
});
