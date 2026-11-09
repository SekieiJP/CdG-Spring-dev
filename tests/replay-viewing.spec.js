import { test, expect } from './fixtures.js';
import { installClipboard, startGame, finishGame, decodeHistory } from './helpers/replay-game.js';

async function sourceReplay(page, options = {}) {
    await installClipboard(page); await startGame(page, options); await finishGame(page);
    await expect(page.locator('#result-replay-view')).toBeEnabled();
    await expect(page.locator('#result-submission-status')).toHaveText('スコア送信済み');
    const row = await page.evaluate(() => window.game.uiController.resultController.repository.history().at(-1));
    return { row, record: await decodeHistory(page, row.resultId) };
}

async function fingerprint(page) {
    return page.evaluate(() => JSON.stringify({
        state: window.game.gameState,
        decks: window.game.cardManager.trainingDecks, discards: window.game.cardManager.trainingDiscards,
        storage: Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)]))
    }));
}

async function selectScene(page, turn, kind) {
    const { index, cursor, total } = await page.evaluate(({ turn, kind }) => {
        const viewer = window.game.uiController.replayViewing;
        return { index: viewer.scenes.findIndex(scene => scene.turn === turn && scene.kind === kind), cursor: viewer.cursor, total: viewer.scenes.length };
    }, { turn, kind });
    expect(index).toBeGreaterThanOrEqual(0);
    const direction = index > cursor ? 'next' : 'previous';
    for (let step = 0; step < Math.abs(index - cursor); step++) await page.locator(`#replay-${direction}`).click();
    await expect(page.locator('#replay-page-position')).toHaveText(`${index + 1} / ${total}`);
    await expect(page.locator('#replay-ai-reason')).toBeEnabled({ timeout: 90000 });
}

test('防犯カメラで時間移動・解決後の値・選択理由を確認でき、中断中のプレイを変更しない', async ({ page, scoreSubmissions }, testInfo) => {
    test.setTimeout(120000);
    const source = await sourceReplay(page);
    await page.locator('#result-replay-view').click();
    await expect(page.locator('#replay-camera')).toBeVisible();
    await expect(page.locator('#replay-previous')).toBeDisabled();
    await selectScene(page, 0, 'action');
    await expect(page.locator('#replay-stats-timing')).toHaveText('効果解決後のステータス');
    for (const key of ['experience', 'enrollment', 'satisfaction', 'accounting']) {
        await expect(page.locator(`#replay-scene-stats [data-stat="${key}"]`)).toHaveText(String(source.record.turns[0].action.after.player[key]));
    }
    const actual = await page.locator('#replay-scene-cards').innerText();
    await page.locator('#replay-next').click(); await page.locator('#replay-previous').click();
    await expect(page.locator('#replay-ai-reason')).toBeEnabled();
    expect(await page.locator('#replay-scene-cards').innerText()).toBe(actual);
    const duck = page.locator('[data-cpu-choice]:visible').first();
    await expect(duck).toBeVisible(); await duck.click();
    await expect(page.locator('#replay-ai-explanation')).toBeVisible();
    await expect(page.locator('#replay-ai-explanation')).not.toBeEmpty();
    await expect(page.locator('#replay-ai-reason')).toHaveAttribute('aria-expanded', 'true');
    if (testInfo.project.name === 'chromium') {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.clock.runFor(4000);
        await page.locator('#replay-scene-title').scrollIntoViewIfNeeded();
        await expect(page.locator('.replay-transport button')).toHaveCount(2);
        expect(await page.locator('#replay-workshop').evaluate(node => node.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: '/tmp/cdg-0065-replay-camera-mobile.png' });
    }
    await page.locator('#replay-workshop .info-overlay-close').click();
    await page.locator('#restart-game').click(); await page.locator('#start-game').click();
    await expect(page.locator('#training-area')).toBeVisible();
    await page.locator('#btn-settings-full').click(); await page.locator('#settings-result-history').click();
    await page.locator('.result-history-entry summary').click();
    const before = await fingerprint(page);
    await page.locator('#result-history-overlay [data-replay-view-id]').click();
    await expect(page.locator('#replay-camera')).toBeVisible();
    await selectScene(page, 7, 'meeting');
    await expect(page.locator('#replay-next')).toBeDisabled();
    await page.locator('.replay-readonly-card').first().click({ position: { x: 10, y: 10 } });
    expect(await fingerprint(page)).toBe(before);
    await page.locator('#replay-workshop .info-overlay-close').click();
    expect(await fingerprint(page)).toBe(before);
    expect(scoreSubmissions).toHaveLength(1);
    await page.reload(); await expect(page.locator('#training-area')).toBeVisible();
    expect(await page.evaluate(() => window.game.gameState.runId)).not.toBe(source.row.resultId);
});

for (const options of [{ difficulty: 'fresh', calcMode: true, eventMode: true }, { difficulty: 'pro' }]) {
    test(`${options.difficulty.toUpperCase()}のお手本が同じシードとイベントを使い、計算機を引き継がず直接視聴できる`, async ({ page, scoreSubmissions }) => {
        test.setTimeout(180000);
        const source = await sourceReplay(page, options);
        await page.locator('#restart-game').click();
        const before = await fingerprint(page);
        await page.locator('#start-replay-example').click();
        await page.locator('#replay-view-input').fill(source.row.replayText); await page.locator('#replay-view-load').click();
        await expect(page.locator('#replay-example-result')).toBeVisible({ timeout: 120000 });
        const example = await page.evaluate(() => window.game.uiController.replayViewing.example);
        expect(example.text).toMatch(/^CDGR1\./);
        expect(example.record.metadata.seed).toBe(source.record.metadata.seed);
        expect(example.record.metadata.difficulty).toBe(source.record.metadata.difficulty);
        expect(example.record.metadata.eventId).toBe(source.record.metadata.eventId);
        expect(example.record.metadata.calcMode).toBe(false);
        expect(example.record.metadata.exampleOf).toBe(source.record.metadata.runId);
        expect(example.record.metadata.cpuPolicy).toBe(options.difficulty === 'pro' ? 'fixed-pro-v1' : 'reach@fresh_stable');
        expect(example.record.complete).toBe(true); expect(example.record.turns).toHaveLength(8);
        await page.locator('#replay-example-copy').click();
        expect(await page.evaluate(() => window.__copiedReplays.at(-1))).toBe(example.text);
        await page.locator('#replay-example-view').click();
        await expect(page.locator('#replay-camera')).toBeVisible();
        await selectScene(page, 4, 'action');
        await expect(page.locator('#replay-source-description')).toContainText('あひる先生');
        for (const key of ['experience', 'enrollment', 'satisfaction', 'accounting']) {
            await expect(page.locator(`#replay-scene-stats [data-stat="${key}"]`)).toHaveText(String(example.record.turns[4].action.after.player[key]));
        }
        expect(await fingerprint(page)).toBe(before);
        expect(scoreSubmissions).toHaveLength(1);
    });
}

test('互換性のないコードを復元前に拒否し、閉じた場面のCPU処理を新しい入力へ反映しない', async ({ page, context }) => {
    test.setTimeout(120000);
    const source = await sourceReplay(page);
    const incompatible = await page.evaluate(async text => {
        const binary = atob(text.slice(6).replaceAll('-', '+').replaceAll('_', '/'));
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        const packet = JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
        packet[1].buildVersion = 'v20261107-0064'; packet[2] = null;
        const encoded = new Uint8Array(await new Response(new Blob([JSON.stringify(packet)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
        return 'CDGR1.' + btoa(String.fromCharCode(...encoded)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    }, source.row.replayText);
    let releaseWorker, workerRequested = false;
    const workerGate = new Promise(resolve => { releaseWorker = resolve; });
    const holdWorker = async route => { workerRequested = true; await workerGate; await route.continue().catch(() => {}); };
    await context.route('**/replayWorkshopWorker.js*', holdWorker);
    await page.locator('#result-replay-view').click();
    await expect(page.locator('#replay-camera')).toBeVisible();
    await expect.poll(() => workerRequested).toBe(true);
    await page.locator('#replay-workshop .info-overlay-close').click();
    releaseWorker(); await context.unroute('**/replayWorkshopWorker.js*', holdWorker);
    await page.evaluate(() => window.game.uiController.replayViewing.open({ mode: 'example' }));
    const before = await fingerprint(page);
    await page.locator('#replay-view-input').fill(incompatible); await page.locator('#replay-view-load').click();
    await expect(page.locator('#replay-load-status')).toHaveText('このリプレイは現在のゲームと互換性がありません');
    await expect(page.locator('#replay-camera')).toBeHidden(); await expect(page.locator('#replay-example-result')).toBeHidden();
    expect(await fingerprint(page)).toBe(before);
    expect(await page.evaluate(() => window.game.uiController.replayViewing.modelWorker)).toBeNull();
});
