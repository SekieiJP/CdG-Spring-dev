import { test, expect } from './fixtures.js';
import { finishGame } from './helpers/replay-game.js';

test('MASTERのあひる先生対戦を完走し、共有日誌から同じシードのお手本とリプレイ対戦を開く', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = [];
    page.on('dialog', dialog => dialog.accept());
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await page.locator('#btn-difficulty-int').click();
    await page.locator('#start-battle').click();
    await page.locator('#battle-kind-cpu').click();
    await expect(page.locator('#battle-difficulty')).toHaveValue('int');
    await page.locator('#battle-start').click();
    await expect(page.locator('#training-cards .card')).toHaveCount(4);
    await page.evaluate(() => {
        const ui = window.game.uiController;
        ui.actionAnimation.clock.wait = async () => {};
        ui.showTurnOverlay = () => {};
    });
    await finishGame(page);
    await expect(page.locator('#battle-result')).toContainText('MASTER');
    await expect(page.locator('#result-replay-copy')).toBeEnabled();
    const row = await page.evaluate(() => window.game.uiController.resultController.repository.history().at(-1));
    expect(row.replayText).toMatch(/^CDGR1\./);
    const entry = { resultId: row.resultId, difficulty: row.difficulty, nickname: '他の先生', completedAt: row.completedAt,
        displayScore: row.score.displayScore, grade: row.score.rank.grade, finalDeck: row.finalDeck };
    const calls = [];
    await page.route('https://script.google.com/**', async route => {
        const payload = route.request().postDataJSON();
        if (!payload.action?.startsWith('diary.')) return route.fallback();
        calls.push(payload);
        await route.fulfill({ json: payload.action === 'diary.list'
            ? { status: 'ok', entries: [entry], nextBefore: null }
            : { status: 'ok', entry: { ...entry, replayText: row.replayText } } });
    });
    await page.locator('#restart-game').click();
    await page.locator('#start-replay-view').click();
    await page.getByRole('button', { name: '他の先生の日誌' }).click();
    const listed = page.locator('.shared-diary-list article');
    await expect(listed).toContainText('他の先生');
    await expect(listed).toContainText(row.score.displayScore + '点');
    await expect(listed.locator('img')).toHaveCount(row.finalDeck.length);
    await listed.getByRole('button', { name: '日誌を読む' }).click();
    await expect(page.locator('#replay-camera')).toBeVisible();
    await expect(page.locator('#replay-source-description')).toContainText('MASTER');
    await expect(page.locator('#replay-ai-reason')).toBeEnabled();
    await page.locator('#replay-generate-example').click();
    await expect(page.locator('#replay-example-result')).toBeVisible();
    expect(await page.evaluate(() => window.game.uiController.replayViewing.example.record.turns.length)).toBe(12);
    expect(calls.map(request => request.action)).toEqual(['diary.list', 'diary.get']);
    await page.locator('#replay-workshop .info-overlay-close').click();
    await page.locator('#start-battle').click();
    await page.locator('#battle-replay-input').fill(row.replayText);
    await page.locator('#battle-load-replay').click();
    await expect(page.locator('#battle-replay-summary')).toContainText('MASTER');
    await page.locator('#battle-same-seed').check();
    await page.locator('#battle-start').click();
    await expect(page.locator('#training-area')).toBeVisible();
    const battle = await page.evaluate(() => {
        const { battle, difficulty } = window.game.gameState;
        return { kind: battle.kind, sameSeed: battle.sameSeed, difficulty };
    });
    expect(battle).toEqual({ kind: 'replay', sameSeed: true, difficulty: 'int' });
    expect(errors).toEqual([]);
});

test('MASTERの部屋コードを作成し、リロード後も部屋とSR候補を保持する', async ({ page }) => {
    await page.goto('/');
    await page.locator('#start-battle').click();
    await page.locator('#battle-kind-room').click();
    await page.locator('#battle-room-difficulty').selectOption('int');
    await page.locator('#battle-room-create-start').click();
    const code = await page.locator('#room-code-display').inputValue();
    expect(code).toMatch(/^[56]\d{7}$/);
    await page.locator('#room-code-ok').click();
    await expect(page.locator('#training-cards .rarity-SR')).toHaveCount(4);
    const cards = await page.locator('#training-cards .card-name').allTextContents();
    await page.reload();
    await expect(page.locator('#training-cards .card-name')).toHaveText(cards);
    expect(await page.evaluate(() => window.game.gameState.room.code)).toBe(code);
});

test('履歴はビルドの上8桁が切り替わるところにルール版を表示する', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#start-game')).toBeEnabled();
    await page.evaluate(() => {
        const { gameState, uiController } = window.game;
        const score = window.game.scoreManager.calculateScore(gameState);
        for (const [i, buildVersion] of ['v20261107-0061', 'v20261122-0068', 'v20261122-0069'].entries()) {
            const resultId = 'history-' + i;
            uiController.resultController.repository.commit({
                score, resultId, buildVersion, completedAt: new Date(i * 1000).toISOString(),
                finalDeck: [], difficulty: 'fresh', mode: '通常'
            }, { resultId }, { submit: false });
        }
    });
    await page.locator('#start-result-history').click();
    await expect(page.locator('.history-rule-divider')).toHaveText(['ルール版 20261122', 'ルール版 20261107']);
});
