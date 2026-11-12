import { test, expect } from './fixtures.js';

const TEST_DATE = new Date('2026-08-20T03:00:00Z');
const TEST_SEED = 'browser-test-20261002';

async function openRoomLobby(page) {
    await page.goto('/');
    await page.locator('#start-battle').click();
    await page.locator('#battle-kind-room').click();
}

async function joinRoom(page, code) {
    await openRoomLobby(page);
    await page.locator('#battle-room-mode-join').click();
    await page.locator('#battle-room-code-input').fill(code);
    await page.locator('#battle-room-join-start').click();
}

async function initialCandidates(page) {
    return page.evaluate(() => window.game.gameState.currentTrainingCards.map(card => card.cardNo));
}

async function speedUp(page) {
    await page.evaluate(() => {
        const ui = window.game.uiController;
        ui.actionAnimation.clock.wait = async () => {};
        ui.showTurnOverlay = () => {};
    });
}

async function finishRoomGame(page) {
    for (let step = 0; step < 120; step++) {
        if (await page.locator('.event-presentation button').isVisible()) {
            await page.locator('.event-presentation button').click();
            continue;
        }
        const phase = await page.evaluate(() => window.game.gameState.phase);
        if (phase === 'end') {
            await expect(page.locator('#result-area')).toBeVisible();
            return;
        }
        const busy = await page.evaluate(() => !!window.game.uiController.actionBusy);
        if (busy) {
            await page.waitForFunction(() => !window.game.uiController.actionBusy || !!document.querySelector('.event-presentation'));
            continue;
        }
        if (phase === 'training') {
            const initial = await page.evaluate(() => window.game.gameState.turn === 0);
            await page.locator('#training-cards .card').nth(0).click();
            if (initial) await page.locator('#training-cards .card').nth(1).click();
            await page.locator('#confirm-training').click();
        } else if (phase === 'action') {
            await page.locator('#confirm-action').click();
        } else if (phase === 'meeting') {
            await page.locator('#confirm-meeting').click();
        } else {
            await page.waitForFunction(previous => window.game.gameState.phase !== previous || !!window.game.uiController.actionBusy, phase);
        }
    }
    throw new Error('同僚との対戦を完走できませんでした');
}

async function blockExternalRequests(context, baseURL, submissions = []) {
    const appOrigin = new URL(baseURL).origin;
    await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === appOrigin) {
            await route.fallback();
            return;
        }
        if (url.hostname === 'script.google.com' && request.method() === 'POST') {
            const payload = request.postDataJSON();
            submissions.push(payload);
            await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
                status: 'ok', turnHistoryStored: true,
                currentVersion: payload.buildVersion, clientVersion: payload.buildVersion, versionMatch: true
            }) });
            return;
        }
        await route.abort('blockedbyclient');
    });
}

async function expectRoomResultFits(page, width, height) {
    await page.setViewportSize({ width, height });
    const panel = page.locator('#colleague-result');
    await expect(panel).toBeVisible();
    const layout = await page.evaluate(() => {
        const root = document.scrollingElement;
        const panel = document.querySelector('#colleague-result');
        const deck = document.querySelector('#colleague-result-deck');
        const deckRect = deck.getBoundingClientRect();
        const selectors = [
            '#colleague-result-room-code', '#colleague-result-difficulty', '#colleague-result-rules',
            '#colleague-result-revenge', '#colleague-result-score', '#colleague-result-rank',
            '#colleague-result-table', '#colleague-result-deck', '#colleague-result-lobby',
            '#colleague-result-menu-toggle'
        ];
        const boxes = selectors.map(selector => {
            const node = document.querySelector(selector);
            if (!node || node.getClientRects().length === 0) return { selector, hidden: true };
            const rect = node.getBoundingClientRect();
            return { selector, top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
        });
        return {
            width: root.clientWidth, height: root.clientHeight,
            scrollWidth: root.scrollWidth, scrollHeight: root.scrollHeight,
            panelScrollWidth: panel.scrollWidth, panelClientWidth: panel.clientWidth,
            panelScrollHeight: panel.scrollHeight, panelClientHeight: panel.clientHeight,
            deckBox: { top: deckRect.top, right: deckRect.right, bottom: deckRect.bottom, left: deckRect.left },
            metadataText: [...document.querySelectorAll('.colleague-result-room-info p')].map(node => ({
                scrollWidth: node.scrollWidth, clientWidth: node.clientWidth
            })),
            boxes,
            actionsTop: document.querySelector('.colleague-result-actions').getBoundingClientRect().top,
            contentBoxes: [...panel.querySelectorAll('tr, #colleague-result-precision:not([hidden]), .colleague-result-thumb, .colleague-result-thumb-count')]
                .map(node => {
                    const rect = node.getBoundingClientRect();
                    return { isDeckItem: node.matches('.colleague-result-thumb, .colleague-result-thumb-count'), top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
                })
        };
    });
    expect(layout.scrollWidth).toBeLessThanOrEqual(width);
    expect(layout.scrollHeight).toBeLessThanOrEqual(height);
    expect(layout.panelScrollWidth).toBeLessThanOrEqual(layout.panelClientWidth);
    expect(layout.panelScrollHeight).toBeLessThanOrEqual(layout.panelClientHeight);
    for (const line of layout.metadataText) expect(line.scrollWidth).toBeLessThanOrEqual(line.clientWidth);
    for (const box of layout.boxes) {
        expect(box, `${box.selector} should remain visible`).not.toHaveProperty('hidden', true);
        expect(box.left, `${box.selector} left edge`).toBeGreaterThanOrEqual(0);
        expect(box.right, `${box.selector} right edge`).toBeLessThanOrEqual(width);
        expect(box.top, `${box.selector} top edge`).toBeGreaterThanOrEqual(0);
        expect(box.bottom, `${box.selector} bottom edge`).toBeLessThanOrEqual(height);
    }
    for (const box of layout.contentBoxes) {
        expect(box.left, 'result row/card left edge').toBeGreaterThanOrEqual(0);
        expect(box.right, 'result row/card right edge').toBeLessThanOrEqual(width);
        expect(box.top, 'result row/card top edge').toBeGreaterThanOrEqual(0);
        expect(box.bottom, 'result row/card does not overlap actions').toBeLessThanOrEqual(layout.actionsTop);
        if (box.isDeckItem) {
            expect(box.left, 'thumbnail/count left edge inside deck').toBeGreaterThanOrEqual(layout.deckBox.left);
            expect(box.right, 'thumbnail/count right edge inside deck').toBeLessThanOrEqual(layout.deckBox.right);
            expect(box.top, 'thumbnail/count top edge inside deck').toBeGreaterThanOrEqual(layout.deckBox.top);
            expect(box.bottom, 'thumbnail/count bottom edge inside deck').toBeLessThanOrEqual(layout.deckBox.bottom);
        }
    }
}

test.describe('同僚と対戦', () => {
    test('作成者と参加者は同じ部屋コードで同じ初回候補を引く', async ({ page, browser, baseURL }) => {
        await page.goto('/');
        await page.locator('#start-battle').click();
        await page.locator('#battle-kind-room').click();
        await page.locator('#battle-room-difficulty').selectOption('pro');
        await page.locator('#battle-room-create-start').click();
        await expect(page.locator('#room-code-overlay')).toBeVisible();
        const code = await page.locator('#room-code-display').inputValue();
        expect(code).toMatch(/^\d{8}$/);
        expect(Number(code.at(-1)) % 2).toBe(1);
        await page.locator('#room-code-ok').click();
        await expect(page.locator('#training-cards .card')).toHaveCount(4);
        const creatorCandidates = await initialCandidates(page);
        expect(await page.evaluate(() => ({ room: window.game.gameState.room, battle: window.game.gameState.battle }))).toEqual({
            room: { code, revenge: false }, battle: null
        });

        const guestContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
        const guestSubmissions = [];
        try {
            await blockExternalRequests(guestContext, baseURL, guestSubmissions);
            await guestContext.addInitScript(seed => { window.CDG_GAME_SEED = seed; }, TEST_SEED);
            const guest = await guestContext.newPage();
            await guest.clock.install({ time: TEST_DATE });
            await joinRoom(guest, code);
            await expect(guest.locator('#training-cards .card')).toHaveCount(4);
            expect(await initialCandidates(guest)).toEqual(creatorCandidates);
            expect(await guest.evaluate(() => ({ room: window.game.gameState.room, battle: window.game.gameState.battle }))).toEqual({
                room: { code, revenge: false }, battle: null
            });
            expect(guestSubmissions).toEqual([]);
        } finally {
            await guestContext.close();
        }
    });

    test('先頭0の未発行コードを受け付け、9桁を拒否し、リタイア後の結果を一画面に表示する', async ({ page, scoreSubmissions }) => {
        test.setTimeout(180000);
        page.on('dialog', dialog => dialog.accept());
        await openRoomLobby(page);
        await page.locator('#battle-room-mode-join').click();
        const input = page.locator('#battle-room-code-input');
        const join = page.locator('#battle-room-join-start');
        await input.fill('000000000');
        await expect(join).toBeDisabled();
        await expect(page.locator('#battle-lobby-message')).toHaveText('');
        await expect(page.locator('#battle-room-detected')).toHaveText('部屋コードは数字8桁で入力してください');

        const code = '00000000';
        await input.fill(code);
        await expect(join).toBeEnabled();
        await expect(page.locator('#battle-room-detected')).toContainText('FRESH');
        await join.click();
        await expect(page.locator('#training-cards .card')).toHaveCount(4);
        expect(await page.evaluate(() => window.game.gameState.room)).toEqual({ code, revenge: false });
        expect(await page.evaluate(() => window.game.gameState.battle)).toBeNull();

        await page.reload();
        await expect(page.locator('#training-cards .card')).toHaveCount(4);
        await expect(page.locator('#room-revenge-overlay')).toHaveCount(0);
        expect(await page.evaluate(() => window.game.gameState.room)).toEqual({ code, revenge: false });

        await page.locator('#btn-settings-full').click();
        await page.locator('#reset-game-btn').click();
        await expect(page.locator('#start-battle')).toBeVisible();
        await joinRoom(page, code);
        await expect(page.locator('#room-revenge-overlay')).toContainText('遊んだことがあります');
        await expect(page.locator('#room-revenge-overlay')).toContainText('リベンジ');
        await page.locator('#room-revenge-ok').click();
        await expect(page.locator('#training-cards .card')).toHaveCount(4);
        expect(await page.evaluate(() => window.game.gameState.room)).toEqual({ code, revenge: true });
        await page.locator('#btn-settings-full').click();
        await expect(page.locator('#settings-room-code')).toBeVisible();
        await page.locator('#settings-room-code').click();
        await expect(page.locator('#room-code-overlay')).toBeVisible();
        await expect(page.locator('#room-code-display')).toHaveValue(code);
        await page.locator('#room-code-ok').click();

        await speedUp(page);
        await finishRoomGame(page);
        await expect(page.locator('#colleague-result')).toBeVisible();
        const expected = await page.evaluate(() => {
            const { gameState: state, uiController: ui } = window.game;
            const row = ui.resultController.repository.find(state.runId);
            const score = state.playRecord.result.score;
            return {
                room: state.room, summaryRoom: row.room, score: score.displayScore, rank: score.rank.grade,
                scoreRows: {
                    enrollmentDiff: score.enrollmentDiff, withdrawal: score.withdrawal,
                    experience: score.experience ?? score.mobilization,
                    satisfaction: score.satisfaction, accounting: score.accounting, enrollment: score.enrollment
                },
                buildVersion: row.buildVersion,
                deckCount: new Set(row.finalDeck.map(card => String(card.cardNo))).size
            };
        });
        expect(expected.room).toEqual({ code, revenge: true });
        expect(expected.summaryRoom).toEqual({ code, revenge: true });
        await expect(page.locator('#colleague-result-room-code')).toHaveText(code);
        await expect(page.locator('#colleague-result-difficulty')).toContainText('FRESH');
        await expect(page.locator('#colleague-result-rules')).toContainText(expected.buildVersion.replace(/\D/g, '').slice(0, 8));
        await expect(page.locator('#colleague-result-revenge')).toContainText('リベンジ');
        await expect(page.locator('#colleague-result-score')).toContainText(String(expected.score));
        await expect(page.locator('#colleague-result-rank')).toContainText(expected.rank);
        const metricOrder = await page.locator('#colleague-result-table [data-result-metric]')
            .evaluateAll(rows => rows.map(row => row.dataset.resultMetric));
        expect(metricOrder).toEqual(['enrollmentDiff', 'withdrawal', 'experience', 'satisfaction', 'accounting', 'enrollment']);
        for (const [metric, value] of Object.entries(expected.scoreRows)) {
            await expect(page.locator(`#colleague-result-table [data-result-metric="${metric}"]`)).toContainText(String(value));
        }
        await expect(page.locator('#colleague-result-deck .colleague-result-thumb')).toHaveCount(expected.deckCount);

        await expectRoomResultFits(page, 320, 440);
        await expectRoomResultFits(page, 568, 256);

        await expect.poll(() => scoreSubmissions.length).toBe(1);
        expect(scoreSubmissions[0].mode).toBe('通常');
        expect(scoreSubmissions[0]).not.toHaveProperty('battleKind');
        expect(scoreSubmissions[0]).not.toHaveProperty('room');
        expect(scoreSubmissions[0]).not.toHaveProperty('revenge');
        await page.locator('#colleague-result-menu-toggle').click();
        await expect(page.locator('#result-replay-copy')).toBeEnabled();
        const replay = await page.evaluate(async () => {
            const row = window.game.uiController.resultController.repository.history().at(-1);
            const { decodeReplay } = await import(`/js/replayCodec.js?v=${window.BUILD_VERSION.slice(1)}`);
            return { text: row.replayText, record: await decodeReplay(row.replayText) };
        });
        expect(replay.text).toMatch(/^CDGR1[.:]/);
        expect(replay.record.metadata.seed).toBe(`room:${code}`);
        expect(replay.record).not.toHaveProperty('room');

        await page.locator('#colleague-result-lobby').click();
        await expect(page.locator('#battle-lobby')).toBeVisible();
        await page.locator('#battle-kind-replay').click();
        await page.locator('#battle-replay-input').fill(replay.text);
        await page.locator('#battle-load-replay').click();
        await expect(page.locator('#battle-lobby-message')).toHaveText('対戦できます。');
        await expect(page.locator('#battle-start')).toBeEnabled();
    });

    test('精度加点と20枚以上の画像が操作ボタンに重ならない', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => !!window.game?.uiController);
        for (const count of [20, 24]) {
            await page.evaluate(async count => {
                const { renderColleagueResult } = await import(`/js/colleagueResult.js?v=${window.BUILD_VERSION.slice(1)}`);
                const { uiController, gameState, cardManager, scoreManager } = window.game;
                const player = { experience: 16, enrollment: 24, satisfaction: 18, accounting: 132 };
                const score = scoreManager.calculateScore({ difficulty: 'fresh', player });
                gameState.phase = 'end';
                document.getElementById('start-overlay').classList.add('hidden');
                document.documentElement.classList.toggle('font-normal', count === 20);
                uiController.showPhaseArea('result');
                renderColleagueResult(uiController, {
                    room: { code: '01563828', revenge: true },
                    difficulty: 'fresh', score, buildVersion: window.BUILD_VERSION,
                    finalDeck: [...cardManager.allCards.slice(0, count), cardManager.allCards[0]]
                });
            }, count);
            await expect(page.locator('#colleague-result-precision')).toHaveText('精度加点 +1.1点');
            await expect(page.locator('.colleague-result-thumb')).toHaveCount(count);
            await expect(page.locator('.colleague-result-thumb-count')).toHaveText('×2');
            await expectRoomResultFits(page, 320, 440);
            await expectRoomResultFits(page, 568, 256);
        }
    });
});
