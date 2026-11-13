import { test, expect } from './fixtures.js';

import { installClipboard, startGame, finishGame, decodeHistory } from './helpers/replay-game.js';

async function playbackView(page, record = null) {
    return page.evaluate(async record => {
        const source = record || window.game.gameState.replayRecord;
        const { opponentSnapshot, opponentDeck, opponentFrames, interimScore } = await import(`/js/battleReplay.js?v=${window.BUILD_VERSION.slice(1)}`);
        const battle = { opponent: source };
        return JSON.parse(JSON.stringify(source.turns.map((_, turn) => ({
            frames: opponentFrames(source, turn),
            phases: ['training', 'action', 'meeting'].map(phase => {
                const snapshot = opponentSnapshot(battle, turn, phase);
                return { player: snapshot.player, deck: opponentDeck(battle, turn, phase),
                    score: interimScore(window.game.scoreManager, { difficulty: source.metadata.difficulty, event: source.result.state.event }, snapshot.player, turn) };
            })
        }))));
    }, record);
}

test('旧形式の短縮中に再読み込みしても元のコードとお気に入りを保ち、開き直すと短縮できる', async ({ page }) => {
    await installClipboard(page); await startGame(page); await finishGame(page);
    await expect(page.locator('#result-replay-copy')).toBeEnabled();
    const original = await page.evaluate(async () => {
        const controller = window.game.uiController.resultController, row = controller.repository.history().at(-1);
        const { decodeReplay } = await import(`/js/replayCodec.js?v=${window.BUILD_VERSION.slice(1)}`);
        const record = await decodeReplay(row.replayText);
        const bytes = new Uint8Array(await new Response(new Blob([JSON.stringify(record)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
        let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
        const legacy = 'CDGR1:' + btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
        controller.repository.setReplay(row.resultId, legacy); controller.repository.setFavorite(row.resultId, true);
        localStorage.setItem('cdg_test_hold_compression', 'true');
        return { id: row.resultId, legacy, score: row.score, finalDeck: row.finalDeck };
    });
    await page.locator('#view-result-history').click(); await page.locator('.result-history-entry summary').click();
    await expect(page.locator('#result-history-overlay [data-replay-id]')).toBeDisabled();
    expect(await page.evaluate(id => window.game.uiController.resultController.repository.find(id).replayText, original.id)).toBe(original.legacy);
    await page.evaluate(() => localStorage.removeItem('cdg_test_hold_compression')); await page.reload();
    await page.locator('#start-result-history').click(); await page.locator('.result-history-entry summary').click();
    const copy = page.locator('#result-history-overlay [data-replay-id]');
    await expect(copy).toBeEnabled();
    await expect.poll(() => page.evaluate(id => window.game.uiController.resultController.repository.find(id).replayText.startsWith('CDGR1.'), original.id)).toBe(true);
    await copy.click();
    const restored = await page.evaluate(id => window.game.uiController.resultController.repository.find(id), original.id);
    expect(restored.favorite).toBe(true); expect(restored.score).toEqual(original.score); expect(restored.finalDeck).toEqual(original.finalDeck);
    expect(restored.replayText.length).toBeLessThan(original.legacy.length);
    expect(await page.evaluate(() => window.__copiedReplays[0])).toBe(restored.replayText);
});

for (const difficulty of ['fresh', 'pro']) {
    for (const mode of [
        { name: '通常', calcMode: false, eventMode: false },
        { name: '計算機', calcMode: true, eventMode: false },
        { name: 'イベント', calcMode: false, eventMode: true },
        { name: 'イベント・計算機併用', calcMode: true, eventMode: true }
    ]) {
        test(`${difficulty.toUpperCase()}の${mode.name}を完走したリプレイを履歴から出力できる`, async ({ page, scoreSubmissions }, testInfo) => {
            test.setTimeout(90000);
            const resumeEncoding = difficulty === 'fresh' && mode.name === '通常';
            await installClipboard(page);
            await startGame(page, { difficulty, ...mode, holdCompression: resumeEncoding });
            await finishGame(page);
            const original = await page.evaluate(() => {
                const game = window.game;
                const row = game.uiController.resultController.repository.history().at(-1);
                return { id: row.resultId, score: row.score, finalDeck: row.finalDeck };
            });
            const originalPlayback = await playbackView(page);
            await expect.poll(() => scoreSubmissions.length).toBe(1);
            expect(scoreSubmissions[0]).not.toHaveProperty('replayPending');
            expect(scoreSubmissions[0]).not.toHaveProperty('replayText');
            if (resumeEncoding) {
                await expect(page.locator('#result-replay-copy')).toBeDisabled();
                await expect(page.locator('#result-replay-status')).toContainText('準備しています');
                await page.locator('#result-favorite').click();
                await expect(page.locator('#result-favorite')).toHaveAttribute('aria-pressed', 'true');
                if (testInfo.project.name === 'chromium') {
                    await page.setViewportSize({ width: 390, height: 844 });
                    await page.locator('#result-replay-copy').scrollIntoViewIfNeeded();
                    await page.screenshot({ path: '/tmp/cdg-replay-result-mobile.png' });
                }
                await page.evaluate(() => localStorage.removeItem('cdg_test_hold_compression'));
                await page.reload();
                await page.locator('#start-result-history').click();
                await page.locator('.result-history-entry summary').click();
            } else {
                await expect(page.locator('#result-replay-copy')).toBeEnabled();
                await page.locator('#view-result-history').click();
                await page.locator('.result-history-entry summary').click();
            }
            const copy = page.locator('#result-history-overlay [data-replay-id]');
            await expect(copy).toBeEnabled();
            await copy.click();
            await expect(page.locator('[data-replay-status]')).toHaveText('リプレイデータをコピーしました。');
            const replay = await decodeHistory(page, original.id);
            expect(await playbackView(page, replay)).toEqual(originalPlayback);
            expect(replay.metadata.difficulty).toBe(difficulty);
            expect(replay.metadata.calcMode).toBe(mode.calcMode);
            expect(!!replay.metadata.eventId).toBe(mode.eventMode);
            expect(replay.turns).toHaveLength(8);
            expect(replay.result.score).toEqual(original.score);
            expect(replay.result.finalDeck.map(({ cardNo, cardName, rarity, category }) => ({ cardNo, cardName, rarity, category }))).toEqual(original.finalDeck);
            expect(await page.evaluate(() => window.__copiedReplays[0])).toMatch(/^CDGR1\./);
            if (resumeEncoding) {
                await expect(page.locator('#result-history-overlay [data-favorite-id]')).toHaveAttribute('aria-pressed', 'true');
                expect(await page.evaluate(id => window.game.uiController.resultController.repository.find(id).replayPending, original.id)).toBeUndefined();
                if (testInfo.project.name === 'chromium') {
                    await copy.scrollIntoViewIfNeeded();
                    await page.screenshot({ path: '/tmp/cdg-replay-history-mobile.png' });
                }
                await page.evaluate(() => { window.__rejectClipboard = true; });
                await copy.click();
                await expect(page.locator('[data-replay-status]')).toContainText('コピーできませんでした');
                expect(await page.evaluate(() => window.__copiedReplays.length)).toBe(1);
                await page.locator('#result-history-overlay .info-overlay-close').click();
                await page.locator('#start-game').click();
                await expect(page.locator('#training-area')).toBeVisible();
                await page.locator('#btn-settings-full').click();
                await page.locator('#settings-result-history').click();
                await page.locator('.result-history-entry summary').click();
                expect(await decodeHistory(page, original.id)).toEqual(replay);
            }
        });
    }
}

test('お気に入り49件の保護・解除を履歴で維持し、旧履歴のリプレイは出力しない', async ({ page }) => {
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => !!window.game?.uiController)).toBe(true);
    await page.evaluate(() => {
        const repository = window.game.uiController.resultController.repository;
        const history = Array.from({ length: 50 }, (_, index) => ({
            resultId: `legacy-${index}`, difficulty: 'fresh', difficultyName: 'FRESH', mode: '通常',
            buildVersion: window.BUILD_VERSION, rulesVersion: '20260815', cardVersion: 'cards', rankVersion: 'ranks',
            completedAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
            score: { displayScore: 8, rank: { grade: 'S' }, experience: 12, enrollment: 12, satisfaction: 15, accounting: 15 },
            finalDeck: [{ cardName: '問合対応の基本' }], submission: 'sent', favorite: index < 49
        }));
        localStorage.setItem(repository.constructor.KEY, JSON.stringify({ history, pending: [] }));
    });
    await expect(page.locator('#start-result-history')).toHaveText('📚 プレイ履歴');
    await page.locator('#start-result-history').click();
    const newest = page.locator('.result-history-entry[data-result-id="legacy-49"]');
    await newest.locator('summary').click();
    await expect(newest.locator('[data-favorite-id]')).toBeDisabled();
    await expect(newest.locator('[data-replay-id]')).toBeDisabled();
    await expect(newest.locator('[data-replay-status]')).toContainText('完全なリプレイデータがない');
    await expect(page.locator('#result-history-overlay [data-favorite-count]')).toContainText('49/49件');
    const oldest = page.locator('.result-history-entry[data-result-id="legacy-0"]');
    await oldest.locator('summary').click();
    await oldest.locator('[data-favorite-id]').click();
    await expect(newest.locator('[data-favorite-id]')).toBeEnabled();
    await newest.locator('[data-favorite-id]').click();
    await page.reload();
    await page.locator('#start-result-history').click();
    await expect(page.locator('#result-history-overlay [data-favorite-count]')).toContainText('49/49件');
    await page.evaluate(() => {
        const controller = window.game.uiController.resultController;
        const row = controller.repository.find('legacy-49');
        const summary = { ...row, resultId: 'latest', favorite: false, completedAt: new Date().toISOString() };
        controller.repository.commit(summary, { resultId: 'latest', buildVersion: window.BUILD_VERSION });
        controller.showHistory();
    });
    await expect(page.locator('.result-history-entry')).toHaveCount(50);
    await expect(page.locator('.result-history-entry[data-result-id="legacy-0"]')).toHaveCount(0);
    await expect(page.locator('.result-history-entry[data-result-id="legacy-1"]')).toHaveCount(1);
    await expect(page.locator('.result-history-entry[data-result-id="latest"]')).toHaveCount(1);
});

test('完走していない結果はお気に入りにできてもリプレイ出力できない', async ({ page }) => {
    await startGame(page);
    await page.evaluate(() => {
        window.game.gameState.phase = 'end';
        window.game.uiController.showResultPhase();
    });
    await expect(page.locator('#result-replay-copy')).toBeDisabled();
    await expect(page.locator('#result-replay-status')).toContainText('完全な記録がない');
    await page.locator('#result-favorite').click();
    await expect(page.locator('#result-favorite')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.game.uiController.resultController.repository.history()[0].replayText)).toBeUndefined();
});
