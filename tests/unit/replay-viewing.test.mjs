import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createCpuReplay } from '../../game/js/cpuOpponent.js?v=20261110-0065';
import { encodeReplay, decodeReplay } from '../../game/js/replayCodec.js?v=20261110-0065';
import { replayScenes, sceneAnalysisSource, sceneAnalysisInput } from '../../game/js/replayViewing.js?v=20261110-0065';
import { analyzeReplayScene } from '../../game/js/replaySceneAnalysis.js?v=20261110-0065';
import { GameState } from '../../game/js/gameState.js?v=20261110-0065';
import { CardManager } from '../../game/js/cardManager.js?v=20261110-0065';
import { TurnManager } from '../../game/js/turnManager.js?v=20261110-0065';
import { ScoreManager } from '../../game/js/scoreManager.js?v=20261110-0065';
import { startReplayRecording, captureReplayTrainingChoice, completeReplayAction, finalizeReplayRecording } from '../../game/js/replayRecorder.js?v=20261110-0065';
import { UIController } from '../../game/js/uiController.js?v=20261110-0065';
import { createEventState, getEventDefinition } from '../../game/js/eventManager.js?v=20261110-0065';
import { prepareCpuEventTurn, finishCpuEventTraining, resolveCpuEventEffects } from '../../game/js/cpuEventRuntime.js?v=20261110-0065';

globalThis.window = { BUILD_VERSION: 'v20261110-0065' };
globalThis.fetch = async url => new Response(await readFile(fileURLToPath(new URL(url))));
const canonical = value => JSON.parse(JSON.stringify(value));
let fresh;

test('短縮した取得・配置・削除から元の場面を復元し、配置の表示値は効果解決後になる', async () => {
    fresh = await createCpuReplay({ difficulty: 'fresh', seed: 'sekiei-replay-viewing', captureViewing: true });
    const untouched = structuredClone(fresh), original = canonical(fresh), text = await encodeReplay(fresh), decoded = await decodeReplay(text);
    assert.ok(text.startsWith('CDGR1.'));
    assert.ok(text.length < 2000);
    const packet = JSON.parse(gunzipSync(Buffer.from(text.slice(6), 'base64url')));
    assert.equal(packet[0], 1);
    assert.equal(Object.hasOwn(packet[1], 'definitions'), false);
    assert.deepEqual(decoded.turns.map(turn => turn.choices), original.turns.map(turn => turn.choices));
    assert.deepEqual(decoded.definitions.cards, original.definitions.cards);
    assert.deepEqual(decoded.definitions.ranks, original.definitions.ranks);
    const scenes = replayScenes(decoded);
    assert.equal(scenes.filter(scene => scene.kind === 'action').length, 8);
    assert.equal(scenes.filter(scene => scene.kind === 'meeting').length, 8);
    assert.equal(scenes.filter(scene => scene.kind === 'training').length, original.turns.reduce((n, t) => n + t.choices.length, 0));
    for (const scene of scenes.filter(scene => scene.kind === 'action')) {
        assert.deepEqual(scene.stats, original.turns[scene.turn].action.after.player);
        assert.deepEqual(scene.placements, original.turns[scene.turn].action.placed);
    }
    assert.deepEqual(fresh, untouched);
});

test('同じFRESH場面で固定CPUの選択を再現し、判断が元の記録・所有札を変更しない', async () => {
    const record = fresh || await createCpuReplay({ difficulty: 'fresh', seed: 'sekiei-replay-viewing', captureViewing: true });
    const before = structuredClone(record), scenes = replayScenes(record);
    for (const scene of scenes) {
        const input = sceneAnalysisSource(record, scene), sourceBefore = structuredClone(input), sceneBefore = structuredClone(scene);
        const decision = await analyzeReplayScene(input, sceneAnalysisInput(scene));
        assert.deepEqual(input, sourceBefore); assert.deepEqual(scene, sceneBefore);
        if (scene.kind === 'training') {
            assert.equal(decision.refresh, false); assert.deepEqual(decision.selectedIndices, scene.selectedIndices);
        } else assert.deepEqual([...decision.selectedIds].sort(), [...scene.selectedIds].sort(), scene.key);
        assert.ok(decision.reason.length > 0);
    }
    assert.deepEqual(record, before);
});

test('PROの途中場面を単独で判断し、実際の将来ターンと最終結果を参照しない', async () => {
    const record = await createCpuReplay({ difficulty: 'pro', seed: 'ahiru-pro-ahiru-stability-validation-v1-20261103:0' });
    const decoded = await decodeReplay(await encodeReplay(record));
    const scenes = replayScenes(decoded).filter(scene => scene.turn === 3);
    Object.defineProperty(decoded, 'result', { get() { throw new Error('未来の結果を読んだ'); } });
    Object.defineProperty(decoded.turns, 4, { get() { throw new Error('未来のターンを読んだ'); } });
    for (const scene of scenes) {
        const source = sceneAnalysisSource(decoded, scene), decision = await analyzeReplayScene(source, sceneAnalysisInput(scene));
        if (scene.kind === 'training') {
            assert.equal(decision.refresh, false); assert.deepEqual(decision.selectedIndices, scene.selectedIndices);
        } else assert.deepEqual([...decision.selectedIds].sort(), [...scene.selectedIds].sort(), scene.key);
    }
});

test('配置取消で変わったカード順も操作列から復元し、通常と計算機の全ターンが一致する', async () => {
    for (const calcMode of [false, true]) {
        const state = new GameState(), cards = new CardManager(), scorer = new ScoreManager(null, { migrateHighScore: false });
        cards.parseCSV(await readFile(new URL('../../game/data/cards_fresh.csv', import.meta.url), 'utf8'));
        await scorer.loadRankData(new URL('../../game/data/rankFresh.csv', import.meta.url).href);
        const turns = new TurnManager(state, cards); turns.initializeGame({ seed: `sekiei-reordered:${calcMode}` });
        state.calcMode = calcMode; state.recordStartTime(); startReplayRecording(state, { cardManager: cards, scoreManager: scorer });
        state.phase = 'training';
        const acquire = (rarity, count, phaseTag, allowSkip = false) => {
            const candidates = calcMode ? null : cards.drawTrainingCards(rarity, phaseTag === 'initial' ? 4 : 3);
            state.currentTrainingCards = candidates;
            const chosen = calcMode ? Array.from({ length: allowSkip ? 1 : count }, () => ({ ...cards.allCards.find(c => c.rarity === rarity) })) : candidates.slice(0, count);
            captureReplayTrainingChoice(state, chosen, { rarity, pickCount: count, allowSkip, phaseTag });
            chosen.forEach(card => state.addToDeck({ ...card }));
        };
        while (state.turn < 8) {
            const turn = state.turn; acquire(turn === 0 ? 'R' : state.config.turns[turn].training, turn === 0 ? 2 : 1, turn === 0 ? 'initial' : 'main');
            if (calcMode && state.tokens.inspiration > 0) {
                state.trainingSelectionMode = 'inspiration'; acquire('SR', state.tokens.inspiration, 'inspiration', true); state.tokens.inspiration = 0;
            } else while (state.tokens.inspiration > 0) {
                state.trainingSelectionMode = 'inspiration'; acquire('SR', 1, 'inspiration', true); state.tokens.inspiration--;
            }
            state.trainingSelectionMode = 'normal'; state.currentTrainingCards = null; turns.advancePhase();
            if (calcMode) { state.player.deck.push(...state.player.hand); state.player.hand = []; }
            const pool = calcMode ? state.player.deck : state.player.hand;
            if (turn === 0 && pool.length > 1) {
                const card = pool.shift(); state.placeCard(card, 'leader'); state.removePlacedCard(card, 'leader'); pool.push(card);
            }
            if (pool.length) state.placeCard(pool.shift(), 'leader');
            turns.executeActions(); completeReplayAction(state); turns.advancePhase();
            if (state.phase === 'meeting') { state.tokens.organize = 0; turns.advancePhase(); }
        }
        const original = finalizeReplayRecording(state, scorer.calculateScore(state), state.getOwnedCards());
        const restored = await decodeReplay(await encodeReplay(original));
        for (let i = 0; i < 8; i++) {
            assert.deepEqual(restored.turns[i].actionStart.player, original.turns[i].actionStart.player);
            assert.deepEqual(restored.turns[i].action.before.player, original.turns[i].action.before.player);
            assert.deepEqual(restored.turns[i].action.after.player, original.turns[i].action.after.player);
        }
        assert.deepEqual(restored.result.score, original.result.score);
        if (calcMode) {
            for (const kind of ['training', 'action', 'meeting']) {
                const scene = replayScenes(restored).find(scene => scene.kind === kind);
                const decision = await analyzeReplayScene(sceneAnalysisSource(restored, scene), sceneAnalysisInput(scene));
                assert.ok(decision.reason.length > 0);
                const selected = kind === 'training' ? decision.selectedIndices.map(index => scene.cards[index])
                    : decision.selectedIds.map(id => scene.cards.find(card => card.instanceId === id));
                assert.ok(selected.every(Boolean));
            }
        }
    }
});

test('計算機の発想一括入力では固定CPUの1枚判断を繰り返し、記録を書き換えない', async () => {
    const record = await decodeReplay(await encodeReplay(fresh));
    const original = replayScenes(record).find(scene => scene.kind === 'training' && scene.turn > 0);
    const source = sceneAnalysisSource(record, original); source.calcMode = true;
    const scene = sceneAnalysisInput(original);
    scene.phaseTag = 'inspiration'; scene.rarity = 'SR'; scene.pickCount = 4; scene.allowSkip = true; scene.allowRefresh = false;
    scene.before.trainingSelectionMode = 'inspiration'; scene.before.tokens.inspiration = 4;
    const candidates = source.cards.filter(card => card.rarity === 'SR').flatMap(card => Array.from({ length: 4 }, (_, i) => ({ ...card, poolId: `manual:${card.cardNo}:${i}` })));
    scene.cards = candidates; scene.before.currentTrainingCards = candidates.map(({ definitionId, poolId }) => ({ definitionId, poolId }));
    const before = structuredClone({ source, scene });
    const decision = await analyzeReplayScene(source, scene);
    assert.ok(decision.selectedIndices.length <= 4);
    assert.ok(decision.selectedIndices.every(index => index >= 0 && index < candidates.length));
    assert.equal(new Set(decision.selectedIndices).size, decision.selectedIndices.length);
    assert.deepEqual({ source, scene }, before);
});

test('互換性のない操作列は、操作本体を復元する前に拒否する', async () => {
    const record = fresh || await createCpuReplay({ difficulty: 'fresh', seed: 'sekiei-build-gate' });
    const code = await encodeReplay(record), packet = JSON.parse(gunzipSync(Buffer.from(code.slice(6), 'base64url')));
    packet[1].buildVersion = 'v20261107-0064'; packet[2] = null;
    const incompatible = 'CDGR1.' + gzipSync(JSON.stringify(packet)).toString('base64url');
    await assert.rejects(decodeReplay(incompatible, { currentBuildVersion: 'v20261110-0065' }), /互換性/);
});

test('お手本CPUのイベント処理が通常UIと同じ取得条件・予約・上限・最終効果になる', async () => {
    for (const difficulty of ['fresh', 'pro']) {
        const make = async () => {
            const state = new GameState(); state.reset(difficulty, { seed: 'sekiei-event-example' });
            const cards = new CardManager(); cards.gameState = state;
            cards.parseCSV(await readFile(new URL(`../../game/data/cards_${difficulty}.csv`, import.meta.url), 'utf8'));
            cards.initTrainingPool();
            Array.from({ length: 10 }).forEach(() => state.addToDeck({ ...cards.getBasicCards()[0] }));
            state.event = createEventState(getEventDefinition('summer-cup-2026-post-obon'), difficulty);
            state.phase = 'training'; return { gameState: state, cardManager: cards };
        };
        const a = await make(), b = await make();
        const ui = Object.assign(Object.create(UIController.prototype), a, {
            saveGameState() {}, showEventPresentation: async () => {}, acquisitionAssist: { recordChoice() {} }, showTrainingPhase() {}
        });
        await ui.prepareEventTurn(); const candidates = prepareCpuEventTurn(b);
        assert.deepEqual(a.gameState.event, b.gameState.event);
        ui.selectedTrainingCard = a.gameState.event.eventTraining.cards[0]; ui.onConfirmTraining();
        b.gameState.addToDeck({ ...candidates[0] }); finishCpuEventTraining(b.gameState);
        assert.deepEqual(a.gameState.event, b.gameState.event);
        for (let turn = 0; turn < 8; turn++) {
            a.gameState.turn = b.gameState.turn = turn;
            await ui.prepareEventTurn(); prepareCpuEventTurn(b);
            for (const game of [a, b]) {
                Object.assign(game.gameState.player, { experience: 11 + turn, enrollment: 10 + turn, satisfaction: 15, accounting: 15 });
                game.gameState.eventCardUsage = { '動員': 3, '教務': 3 };
            }
            await ui.resolveEventActionEffects(); resolveCpuEventEffects(b.gameState);
            assert.deepEqual(a.gameState.event, b.gameState.event, `${difficulty}:${turn}`);
            for (const key of ['experience', 'enrollment', 'satisfaction', 'accounting']) assert.equal(a.gameState.player[key], b.gameState.player[key]);
            a.gameState.event.actionCompletion = b.gameState.event.actionCompletion = null;
        }
        assert.equal(b.gameState.event.items['spring-homework'].resolvedActivationCount, 4);
    }
});

test('イベント付きのお手本を同じシードで完走し、視聴と再出力に必要な記録を残す', async () => {
    const seed = 'sekiei-event-example-replay';
    const record = await createCpuReplay({ difficulty: 'fresh', seed, eventId: 'summer-cup-2026-post-obon' });
    const decoded = await decodeReplay(await encodeReplay(record), { currentBuildVersion: 'v20261110-0065' });
    assert.equal(decoded.metadata.seed, seed); assert.equal(decoded.metadata.calcMode, false);
    assert.equal(decoded.metadata.eventId, 'summer-cup-2026-post-obon');
    assert.deepEqual(decoded.definitions.event, record.definitions.event);
    assert.deepEqual(decoded.result.score, record.result.score);
    assert.ok(replayScenes(decoded).length >= 24);
    assert.equal(decoded.result.state.event.items['press-coverage'].acquiredTurn, 0);
    assert.equal(decoded.result.state.event.items['spring-homework'].acquiredTurn, 4);
});
