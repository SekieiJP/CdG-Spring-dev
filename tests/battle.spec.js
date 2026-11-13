import { test, expect } from './fixtures.js';
import { expectResultImageDownload } from './helpers/result-image.js';
import { encodeRawReplay } from './helpers/replay-game.js';

async function speedUp(page) {
    await page.evaluate(() => {
        const ui = window.game.uiController;
        ui.actionAnimation.clock.wait = async () => {};
        ui.showTurnOverlay = () => {};
    });
}

async function drive(page, stopAtAction = false) {
    for (let step = 0; step < 120; step++) {
        if (await page.locator('.event-presentation button').isVisible()) {
            await page.locator('.event-presentation button').click(); continue;
        }
        const current = await page.evaluate(() => {
            const { gameState: state, uiController: ui } = window.game;
            return { phase: state.phase, busy: !!ui.actionBusy, calc: state.calcMode,
                preparing: !!state.event?.preparing,
                initial: state.turn === 0 && !state.event?.eventTraining && state.trainingSelectionMode !== 'inspiration' };
        });
        if (current.phase === 'end') { await expect(page.locator('#result-area')).toBeVisible(); return; }
        if (current.preparing) {
            await page.waitForFunction(() => !window.game.gameState.event?.preparing || !!document.querySelector('.event-presentation'));
            continue;
        }
        if (current.busy) {
            await page.waitForFunction(() => !window.game.uiController.actionBusy || !!document.querySelector('.event-presentation'));
            continue;
        }
        if (current.phase === 'training') {
            if (current.calc) {
                const input = await page.evaluate(() => {
                    const { cardManager, uiController: ui } = window.game;
                    const rule = ui.calcTrainingRequirement;
                    const card = cardManager.allCards.find(card => card.rarity === rule.rarity);
                    return String(card.cardNo).padStart(2, '0').repeat(rule.minCount);
                });
                await page.locator('#calc-training-input').fill(input);
            } else {
                await page.locator('#training-cards .card').nth(0).click();
                if (current.initial) await page.locator('#training-cards .card').nth(1).click();
            }
            await page.locator('#confirm-training').click();
        } else if (current.phase === 'action') {
            if (stopAtAction) return;
            if (current.calc) await page.locator('#calc-action-leader').fill('01');
            else if (await page.locator('#hand-cards .card').count()) await page.locator('#hand-cards .card').first().click();
            await page.locator('#confirm-action').click();
        } else if (current.phase === 'meeting') {
            if (await page.evaluate(() => !!window.game.gameState.battle)) await expect(page.locator('#battle-opponent-status')).toBeVisible();
            await page.locator('#confirm-meeting').click();
        }
    }
    throw new Error('対戦を完走できませんでした');
}

async function sourceReplay(page, { difficulty = 'fresh', calc = false, event = false } = {}) {
    page.on('dialog', dialog => dialog.accept());
    await page.goto('/'); await page.waitForFunction(() => !!window.game?.uiController); await speedUp(page);
    await page.locator(`#btn-difficulty-${difficulty}`).click();
    if (calc) {
        await page.locator('#start-overlay h1').click();
        await page.locator('#calc-mode-toggle + .toggle-slider').click();
    }
    if (event) await page.locator('#event-mode-toggle + .toggle-slider').click();
    await page.locator('#start-game').click(); await drive(page);
    await expect(page.locator('#result-replay-copy')).toBeEnabled();
    const source = await page.evaluate(async () => {
        const row = window.game.uiController.resultController.repository.history().at(-1);
        const { decodeReplay } = await import(`/js/replayCodec.js?v=${window.BUILD_VERSION.slice(1)}`);
        return { text: row.replayText, record: await decodeReplay(row.replayText) };
    });
    await page.locator('#restart-game').click();
    return source;
}

async function loadReplay(page, text) {
    await page.locator('#start-battle').click();
    await page.locator('#battle-replay-input').fill(text);
    await page.locator('#battle-load-replay').click();
    await expect(page.locator('#battle-lobby-message')).toHaveText('対戦できます。');
}

test('貼り付けではプレーンテキストを使い、小文字の旧形式も再編集せず読み込める', async ({ page }) => {
    const source = await sourceReplay(page);
    const legacy = await page.evaluate(async record => {
        const stream = new Blob([JSON.stringify(record)]).stream().pipeThrough(new CompressionStream('gzip'));
        const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
        let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
        return 'CDGR1:' + btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    }, source.record);
    await page.locator('#start-battle').click();
    const input = page.locator('#battle-replay-input');
    for (const text of [legacy, legacy.replace(/^CDGR1:/, 'cdgr1:')]) {
        const pasted = await input.evaluate((node, text) => {
            node.select();
            const data = new DataTransfer(); data.setData('text/plain', text); data.setData('text/uri-list', text.toLowerCase());
            node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
            return node.value;
        }, text);
        expect(pasted).toBe(text);
        await expect(page.locator('#battle-start')).toBeDisabled();
        await page.locator('#battle-load-replay').click();
        await expect(page.locator('#battle-lobby-message')).toHaveText('対戦できます。');
    }
    await page.locator('#battle-start').click();
    await expect(page.locator('#training-area')).toBeVisible();
});

for (const difficulty of ['fresh', 'pro']) {
    for (const mode of [
        { name: '通常', calc: false, event: false }, { name: '計算機', calc: true, event: false },
        { name: 'イベント', calc: false, event: true }, { name: 'イベント・計算機', calc: true, event: true }
    ]) {
        test(`${difficulty.toUpperCase()} ${mode.name}のリプレイと対戦し、相手の結果を忠実に残す`, async ({ page, scoreSubmissions }) => {
            test.setTimeout(120000);
            const source = await sourceReplay(page, { difficulty, ...mode });
            await loadReplay(page, source.text);
            await expect(page.locator('#battle-same-seed')).not.toBeChecked();
            await expect(page.locator('#battle-lobby')).not.toContainText('最終デッキ');
            if (mode.name === '通常') await page.locator('#battle-same-seed').check();
            await page.locator('#battle-start').click();
            await expect(page.locator('#training-area')).toBeVisible();
            await expect(page.locator('#battle-opponent-status')).toBeVisible();
            await speedUp(page);
            expect(await page.evaluate(() => window.game.gameState.calcMode)).toBe(false);
            expect(await page.evaluate(() => !!window.game.gameState.event)).toBe(false);
            if (mode.name === '通常') {
                await page.evaluate(() => {
                    const { gameState, scoreManager } = window.game;
                    localStorage.removeItem(scoreManager.getHighScoreStorageKey(gameState.difficulty, gameState));
                });
            }
            await drive(page, true);
            await expect(page.locator('#battle-opponent-status')).toBeVisible();
            await expect(page.locator('#battle-opponent-status .battle-opponent-stat')).toHaveCount(4);
            await expect(page.locator('#battle-opponent-status .rank-progress')).toHaveCount(0);
            await page.locator('#btn-deck-full').click();
            const deck = page.locator('.battle-deck');
            await expect(deck.locator('h3')).toContainText('山札');
            await expect(deck.locator('.staff-slot')).toHaveCount(0);
            const knownIds = [...source.record.turns[0].actionStart.player.deck, ...source.record.turns[0].actionStart.player.hand];
            const knownNames = knownIds.map(id => source.record.instances[id].cardName);
            await expect(deck.locator('.card')).toHaveCount(knownIds.length);
            const future = source.record.result.finalDeck.find(card => !knownNames.includes(card.cardName));
            if (future) await expect(deck).not.toContainText(future.cardName);
            await page.locator('.info-overlay:has(.battle-deck) .info-overlay-close').click();
            await drive(page);
            await expect(page.locator('#battle-outcome')).toBeVisible();
            const comparison = page.locator('.battle-comparison-table');
            await expect(comparison).toBeVisible();
            const experienceRow = comparison.getByRole('rowheader', { name: '体験', exact: true }).locator('..');
            await expect(experienceRow.locator('td').nth(1).locator('.battle-metric-value')).toHaveText(String(source.record.result.score.experience));
            const result = await page.evaluate(() => {
                const { gameState: state, uiController: ui, scoreManager } = window.game;
                const row = ui.resultController.repository.find(state.runId);
                return { battle: row.battle, mode: row.mode, highScore: scoreManager.getHighScore(state.difficulty, state) };
            });
            expect(result.battle.opponentScore).toEqual(source.record.result.score);
            expect(result.battle.opponentFinalDeck).toEqual(source.record.result.finalDeck.map(({ cardNo, cardName, rarity, category }) => ({ cardNo, cardName, rarity, category })));
            expect(result.mode).toContain('対戦:リプレイ');
            if (mode.name === '通常') { expect(result.battle.outcome).toBe('draw'); expect(result.highScore).toBeNull(); }
            await expect.poll(() => scoreSubmissions.length).toBe(2);
            expect(scoreSubmissions[1].mode).toBe('通常');
            expect(scoreSubmissions[1].battleKind).toBe('replay');
            expect(scoreSubmissions[1]).not.toHaveProperty('opponentScore');
            await expect(page.locator('#result-replay-copy')).toBeEnabled();
            const self = await page.evaluate(async () => {
                const row = window.game.uiController.resultController.repository.history().at(-1);
                const { decodeReplay } = await import(`/js/replayCodec.js?v=${window.BUILD_VERSION.slice(1)}`);
                return decodeReplay(row.replayText);
            });
            expect(self.metadata.battleKind).toBe('replay'); expect(self).not.toHaveProperty('opponent');
            if (difficulty === 'fresh' && mode.name === '通常') await expectResultImageDownload(page);
            await page.locator('#view-result-history').click();
            await expect(page.locator('.battle-history-result')).toHaveCount(1);
            await page.locator('.result-history-entry').first().locator('summary').first().click();
            await expect(page.locator('.battle-history-result')).toContainText(String(source.record.result.score.displayScore));
        });
    }
}

for (const difficulty of ['fresh', 'pro']) {
    test(`あひる先生 ${difficulty.toUpperCase()}との対戦を完走し、プレイヤー向けアシストを無効にする`, async ({ page, scoreSubmissions }) => {
        test.setTimeout(180000); page.on('dialog', dialog => dialog.accept());
        await page.goto('/'); await page.locator('#start-battle').click();
        await page.locator('#battle-kind-cpu').click(); await page.locator('#battle-difficulty').selectOption(difficulty);
        await expect(page.locator('#battle-cpu-same-seed')).toBeChecked();
        await expect(page.locator('#battle-replay-controls')).toBeHidden();
        await page.locator('#battle-start').click();
        if (difficulty === 'pro') await expect(page.locator('#battle-lobby-message')).toContainText('あひる先生が教材研究中…');
        await expect(page.locator('#training-area')).toBeVisible({ timeout: 120000 });
        const opponent = await page.evaluate(() => window.game.gameState.battle.opponent);
        expect(await page.evaluate(() => window.game.gameState.rng.seed)).toBe(opponent.metadata.seed);
        const originalOffer = opponent.turns[0].training.find(boundary => boundary.kind === 'training-offer').state.currentTrainingCards
            .map(card => String(opponent.definitions.cards.find(definition => definition.definitionId === card.definitionId).cardNo));
        expect(await page.evaluate(() => window.game.gameState.currentTrainingCards.map(card => String(card.cardNo)))).toEqual(originalOffer);
        await page.reload();
        await expect(page.locator('#training-area')).toBeVisible();
        expect(await page.evaluate(() => window.game.gameState.battle.opponent)).toEqual(opponent);
        await speedUp(page);
        expect(await page.evaluate(() => window.game.gameState.battle.opponent.metadata.cpuPolicy)).toBe(difficulty === 'pro' ? 'fixed-pro-v1' : 'reach@fresh_stable');
        expect(await page.evaluate(() => window.game.uiController.acquisitionAssist.eligible())).toBe(false);
        expect(await page.evaluate(() => window.game.uiController.ahiruAdvice.getSceneDecision())).toBeNull();
        await expect.poll(() => page.evaluate(() => window.game.uiController.ahiruAdvice.lastAdvice?.text)).toMatch(/ね|よ/);
        await drive(page); await expect(page.locator('#battle-outcome')).toBeVisible();
        expect(await page.evaluate(() => window.game.uiController.resultController.repository.history()[0].battle.kind)).toBe('cpu');
        await expect.poll(() => scoreSubmissions.length).toBe(1);
        expect(scoreSubmissions[0].battleKind).toBe('cpu'); expect(scoreSubmissions[0].mode).toBe('通常');
        expect(scoreSubmissions[0].sameSeed).toBe(true);
        await expect(page.locator('.battle-same-seed-note')).toHaveCount(0);
        await expect(page.locator('#result-image-save')).toBeEnabled();
        await page.locator('#battle-rematch').click();
        await expect(page.locator('#battle-kind-cpu')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#battle-difficulty')).toHaveValue(difficulty);
        if (difficulty === 'fresh') {
            await page.locator('#battle-start').click();
            await expect(page.locator('#training-area')).toBeVisible();
            const rematch = await page.evaluate(() => ({ seed: window.game.gameState.rng.seed, opponentSeed: window.game.gameState.battle.opponent.metadata.seed }));
            expect(rematch.seed).toBe(rematch.opponentSeed); expect(rematch.seed).not.toBe(opponent.metadata.seed);
        }
    });
}

test('CPU対戦で同一シードをオフにすると相手と別のシードで開始する', async ({ page }) => {
    await page.goto('/'); await page.locator('#start-battle').click();
    await page.locator('#battle-kind-cpu').click(); await page.locator('#battle-cpu-same-seed').uncheck();
    await page.locator('#battle-start').click(); await expect(page.locator('#training-area')).toBeVisible();
    const state = await page.evaluate(() => ({ same: window.game.gameState.battle.sameSeed,
        seed: window.game.gameState.rng.seed, opponentSeed: window.game.gameState.battle.opponent.metadata.seed }));
    expect(state.same).toBe(false); expect(state.seed).not.toBe(state.opponentSeed);
});

test('互換性のないデータや不正なリプレイで現在のゲームと履歴を壊さない', async ({ page }) => {
    const source = await sourceReplay(page);
    await page.locator('#start-battle').click();
    await page.locator('#battle-replay-input').fill('CDGR1:broken');
    await page.locator('#battle-load-replay').click(); await expect(page.locator('#battle-start')).toBeDisabled();
    await expect(page.locator('#battle-lobby-message')).not.toHaveText('対戦できます。');
    const incompatibleRecord = structuredClone(source.record);
    incompatibleRecord.metadata.buildVersion = 'v20000101-0001';
    const incompatible = await encodeRawReplay(page, incompatibleRecord);
    await page.locator('#battle-replay-input').fill(incompatible); await page.locator('#battle-load-replay').click();
    await expect(page.locator('#battle-lobby-message')).toContainText('互換性');
    for (const defect of ['finalDeck', 'overflow', 'reference']) {
        const record = structuredClone(source.record);
        if (defect === 'finalDeck') record.result.finalDeck[0] = null;
        if (defect === 'overflow') record.result.score.overflow = { experience: '不正', enrollmentDiff: 0, satisfaction: 0 };
        if (defect === 'reference') delete record.instances[record.turns[0].actionStart.player.hand[0]];
        const text = await encodeRawReplay(page, record);
        await page.locator('#battle-replay-input').fill(text); await page.locator('#battle-load-replay').click();
        await expect(page.locator('#battle-lobby-message')).not.toHaveText('リプレイを確認しています。');
        await expect(page.locator('#battle-start')).toBeDisabled();
    }
    const compatible = await page.evaluate(async record => {
        record.metadata.buildVersion = window.BUILD_VERSION.replace(/-\d{4}$/, '-0001');
        const { encodeReplay } = await import(`/js/replayCodec.js?v=${window.BUILD_VERSION.slice(1)}`);
        return encodeReplay(record);
    }, source.record);
    await page.locator('#battle-replay-input').fill(compatible); await page.locator('#battle-load-replay').click();
    await expect(page.locator('#battle-lobby-message')).toHaveText('対戦できます。');
    expect(await page.evaluate(() => window.game.uiController.resultController.repository.history().length)).toBe(1);
});

for (const expired of [false, true]) {
    test(`特殊リプレイのイベント選択：${expired ? '期間外は相手だけ再現' : '開催中は自分にも適用'}`, async ({ page, scoreSubmissions }) => {
        test.setTimeout(120000);
        const source = await sourceReplay(page, { event: true });
        if (expired) await page.clock.setSystemTime(new Date('2026-11-08T00:00:00Z'));
        await loadReplay(page, source.text);
        if (expired) await expect(page.locator('#battle-event-label')).toBeHidden();
        else { await expect(page.locator('#battle-event-label')).toBeVisible(); await page.locator('#battle-event').check(); }
        await page.locator('#battle-start').click();
        await expect.poll(() => page.evaluate(() => window.game.gameState.battle?.kind)).toBe('replay');
        await speedUp(page); await drive(page);
        const result = await page.evaluate(() => window.game.uiController.resultController.repository.history().at(-1));
        expect(result.battle.opponentScore).toEqual(source.record.result.score);
        expect(await page.evaluate(() => !!window.game.gameState.event?.enabled)).toBe(!expired);
        await expect.poll(() => scoreSubmissions.length).toBe(2);
        expect(scoreSubmissions[1].mode).toMatch(expired ? /^通常$/ : /^イベント:/);
    });
}

test('相手のカードを1件ずつスキップし、演出中の再読み込みでも重複適用しない', async ({ page, scoreSubmissions }, testInfo) => {
    test.setTimeout(120000); page.on('dialog', dialog => dialog.accept());
    await page.goto('/');
    const source = await page.evaluate(async () => {
        const suffix = `?v=${window.BUILD_VERSION.slice(1)}`;
        const { createCpuReplay } = await import(`/js/cpuOpponent.js${suffix}`);
        const { encodeReplay, decodeReplay } = await import(`/js/replayCodec.js${suffix}`);
        const record = await createCpuReplay({ difficulty: 'fresh', seed: 'battle-animation-resume' });
        const text = await encodeReplay(record);
        return { record: await decodeReplay(text), text };
    });
    expect(Object.values(source.record.turns[0].action.placed).flat().length).toBeGreaterThan(2);
    await loadReplay(page, source.text); await page.locator('#battle-start').click();
    await expect(page.locator('#training-area')).toBeVisible(); await speedUp(page); await drive(page, true);
    await page.waitForFunction(() => !window.game.uiController.mobileLayout.resetScroll);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator('#sticky-header')).not.toHaveClass(/hidden/);
    await expect(page.locator('#battle-compact-opponent')).toBeVisible();
    expect(await page.evaluate(() => document.getElementById('battle-compact-opponent').getBoundingClientRect().bottom <=
        document.querySelector('#sticky-header .compact-stats').getBoundingClientRect().top)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath('battle-action.png'), animations: 'disabled' });
    await page.evaluate(() => {
        const { uiController: ui, gameState: state } = window.game;
        const clock = ui.actionAnimation.clock, originalWait = Object.getPrototypeOf(clock).wait;
        clock.wait = function (ms) {
            return state.battle.animation?.turn === state.turn && !state.battle.animation.done ? originalWait.call(this, 60000) : Promise.resolve();
        };
    });
    await page.locator('#hand-cards .card').first().click(); await page.locator('#confirm-action').click();
    await page.waitForFunction(() => window.game.gameState.battle.animation?.cursor === 1);
    await page.locator('.battle-animation-card').click();
    await page.waitForFunction(() => window.game.gameState.battle.animation?.cursor === 2);
    await expect(page.locator('#battle-animation-opponent .battle-opponent-rank')).toHaveCount(0);
    const second = Object.values(source.record.turns[0].action.cardEffects).flatMap(info => info.cards)[1];
    for (const key of ['experience', 'enrollment', 'satisfaction', 'accounting']) {
        const stat = page.locator(`#battle-animation-opponent [data-stat="${key}"]`);
        const delta = second.afterStats[key] - second.beforeStats[key];
        if (delta) {
            await expect(stat.locator('.battle-opponent-delta')).toHaveText(`${delta > 0 ? '+' : ''}${delta}`);
            await expect(stat.locator('.battle-opponent-delta')).toHaveCSS('color', delta > 0 ? 'rgb(16, 185, 129)' : 'rgb(239, 68, 68)');
        } else await expect(stat.locator('.battle-opponent-delta')).toHaveCount(0);
        await expect(stat).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    }
    expect(await page.evaluate(() => ({ waiters: window.game.uiController.actionAnimation.clock.waiters.size,
        skipped: window.game.uiController.actionAnimation.clock.skipCurrent }))).toEqual({ waiters: 1, skipped: false });
    const before = await page.evaluate(() => {
        const state = window.game.gameState;
        return { player: Object.fromEntries(['experience', 'enrollment', 'satisfaction', 'accounting'].map(key => [key, state.player[key]])),
            resolves: state.playRecord.events.filter(event => event.type === 'resolve').length };
    });
    await page.screenshot({ path: testInfo.outputPath('battle-opponent-animation.png'), animations: 'disabled' });
    await page.reload();
    await page.waitForFunction(() => window.game?.gameState.battle?.animation?.done && !window.game.uiController.actionBusy);
    expect(await page.evaluate(() => {
        const state = window.game.gameState;
        return { player: Object.fromEntries(['experience', 'enrollment', 'satisfaction', 'accounting'].map(key => [key, state.player[key]])),
            resolves: state.playRecord.events.filter(event => event.type === 'resolve').length };
    })).toEqual(before);
    expect(await page.evaluate(() => window.game.gameState.battle.opponent)).toEqual(source.record);
    await speedUp(page); await drive(page);
    await expect(page.locator('#battle-outcome')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('battle-result.png'), fullPage: true, animations: 'disabled' });
    await expect.poll(() => scoreSubmissions.length).toBe(1);
    await expect(page.locator('#result-replay-copy')).toBeEnabled();
});
