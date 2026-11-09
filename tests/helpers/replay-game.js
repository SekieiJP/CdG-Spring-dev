import { expect } from '../fixtures.js';

export async function installClipboard(page) {
    await page.addInitScript(() => {
        window.__copiedReplays = [];
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
            writeText: async text => {
                if (window.__rejectClipboard) throw new Error('denied');
                window.__copiedReplays.push(text);
            }
        } });
        const NativeCompressionStream = window.CompressionStream;
        window.CompressionStream = function (format) {
            if (localStorage.getItem('cdg_test_hold_compression') === 'true') {
                return new TransformStream({ transform(chunk, controller) { controller.enqueue(chunk); }, flush() { return new Promise(() => {}); } });
            }
            return new NativeCompressionStream(format);
        };
    });
}

export async function startGame(page, { difficulty = 'fresh', calcMode = false, eventMode = false, holdCompression = false } = {}) {
    page.on('dialog', dialog => dialog.accept());
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => !!window.game?.uiController)).toBe(true);
    await page.evaluate(hold => {
        const ui = window.game.uiController;
        ui.actionAnimation.clock.wait = async () => {};
        ui.showTurnOverlay = () => {};
        if (hold) localStorage.setItem('cdg_test_hold_compression', 'true');
    }, holdCompression);
    await page.locator(`#btn-difficulty-${difficulty}`).click();
    if (calcMode) {
        await page.locator('#start-overlay h1').click();
        await page.locator('#calc-mode-toggle + .toggle-slider').click();
    }
    if (eventMode) await page.locator('#event-mode-toggle + .toggle-slider').click();
    await page.locator('#start-game').click();
    await page.waitForFunction(() => window.game.gameState.phase === 'training');
}

export async function finishGame(page) {
    for (let step = 0; step < 100; step++) {
        if (await page.locator('.event-presentation button').isVisible()) {
            await page.locator('.event-presentation button').click();
            continue;
        }
        const state = await page.evaluate(() => ({
            phase: window.game.gameState.phase,
            busy: !!window.game.uiController.actionBusy,
            calc: window.game.gameState.calcMode,
            initial: window.game.gameState.turn === 0 && !window.game.gameState.event?.eventTraining && window.game.gameState.trainingSelectionMode !== 'inspiration'
        }));
        if (state.phase === 'end') {
            await expect(page.locator('#result-area')).toBeVisible();
            return;
        }
        if (state.busy) {
            await page.waitForFunction(() => !window.game.uiController.actionBusy || !!document.querySelector('.event-presentation'));
            continue;
        }
        if (state.phase === 'training') {
            await expect(page.locator('#training-area')).toBeVisible();
            if (state.calc) {
                const input = await page.evaluate(() => {
                    const game = window.game;
                    const requirement = game.uiController.calcTrainingRequirement;
                    const card = game.cardManager.allCards.find(candidate => candidate.rarity === requirement.rarity);
                    return String(card.cardNo).padStart(2, '0').repeat(requirement.minCount);
                });
                await page.locator('#calc-training-input').fill(input);
            } else {
                await page.locator('#training-cards .card').nth(0).click();
                if (state.initial) await page.locator('#training-cards .card').nth(1).click();
            }
            await page.locator('#confirm-training').click();
        } else if (state.phase === 'action') {
            await expect(page.locator('#action-area')).toBeVisible();
            if (state.calc) await page.locator('#calc-action-leader').fill('01');
            else if (await page.locator('#hand-cards .card').count()) await page.locator('#hand-cards .card').first().click();
            await page.locator('#confirm-action').click();
        } else if (state.phase === 'meeting') {
            await page.locator('#confirm-meeting').click();
        }
    }
    throw new Error('8ターンを完走できませんでした');
}

export async function decodeHistory(page, resultId) {
    return page.evaluate(async id => {
        const row = window.game.uiController.resultController.repository.find(id);
        const { decodeReplay } = await import(`/js/replayCodec.js?v=${window.BUILD_VERSION.slice(1)}`);
        return decodeReplay(row.replayText, { currentBuildVersion: window.BUILD_VERSION });
    }, resultId);
}

export async function encodeRawReplay(page, record) {
    return page.evaluate(async source => {
        const stream = new Blob([JSON.stringify(source)]).stream().pipeThrough(new CompressionStream('gzip'));
        const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
        let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
        return 'CDGR1:' + btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    }, record);
}
