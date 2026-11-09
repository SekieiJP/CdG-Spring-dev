import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../../game/js/gameState.js?v=20261110-0065';
import { CardManager } from '../../game/js/cardManager.js?v=20261110-0065';
import { TurnManager } from '../../game/js/turnManager.js?v=20261110-0065';
import { SaveManager } from '../../game/js/saveManager.js?v=20261110-0065';
import { createEventState, getEventDefinition, getEventItem } from '../../game/js/eventManager.js?v=20261110-0065';
import { startReplayRecording, captureReplayBoundary, captureReplayEventEffect, completeReplayAction,
    finalizeReplayRecording, getCompletedReplay } from '../../game/js/replayRecorder.js?v=20261110-0065';

function createGame({ difficulty = 'fresh', calcMode = false, event = false } = {}) {
    globalThis.window = { BUILD_VERSION: 'v20260815-0059' };
    const state = new GameState(); state.difficulty = difficulty;
    const cards = new CardManager();
    cards.allCards = [{ cardNo: '01', cardName: '基本動員', rarity: 'N', category: '動員', effect: '体験+1' }];
    const turns = new TurnManager(state, cards);
    turns.initializeGame();
    state.calcMode = calcMode; state.recordStartTime();
    const definition = event ? getEventDefinition('summer-cup-2026-post-obon') : null;
    state.event = definition ? createEventState(definition, difficulty) : null;
    startReplayRecording(state, { cardManager: cards, scoreManager: { rankTable: [], dataVersion: 'rank-test' },
        eventDefinition: definition, eventItems: definition?.items.map(getEventItem) || [] });
    state.phase = 'training';
    return { state, cards, turns };
}

function beginAction(game) {
    const { state, turns } = game;
    turns.advancePhase();
    if (state.player.hand.length) state.placeCard(state.player.hand.shift(), 'leader');
    return turns.executeActions();
}

function finishAction(game) {
    const { state, turns } = game;
    if (state.event) state.event.actionCompletion = { turn: state.turn, status: 'ready' };
    completeReplayAction(state);
    turns.advancePhase();
    if (state.phase === 'meeting') {
        state.tokens.organize = 0;
        turns.advancePhase();
    }
}

function finishGame(game) {
    while (game.state.phase !== 'end') {
        beginAction(game);
        finishAction(game);
    }
    return finalizeReplayRecording(game.state, { displayScore: 1, rank: { grade: 'D' } }, game.state.getOwnedCards());
}

test('通常・計算機・イベント・併用の全ターンと独立した完了データを保持する', () => {
    for (const difficulty of ['fresh', 'pro']) {
        for (const calcMode of [false, true]) for (const event of [false, true]) {
            const game = createGame({ difficulty, calcMode, event });
            const record = finishGame(game);
            assert.equal(record.complete, true);
            assert.equal(record.metadata.difficulty, difficulty);
            assert.equal(record.metadata.calcMode, calcMode);
            assert.equal(!!record.metadata.eventId, event);
            assert.equal(record.turns.length, 8);
            assert.equal(record.turns.every(turn => turn.completed && turn.action.before && turn.action.after && turn.meeting.after), true);
            assert.equal(record.turns[7].meeting.skipped, true);
            assert.equal(record.result.state.turn, 8);
            assert.equal(record.initial.player.deck.length, 1);
            const initialCard = record.initial.player.deck[0];
            assert.equal(record.instances[initialCard].cardName, '基本動員');
            const frozen = JSON.stringify(record);
            game.state.reset('fresh');
            assert.equal(JSON.stringify(record), frozen);
            assert.equal(getCompletedReplay(game.state), null);
        }
    }
});

test('途中終了・欠けたターン・旧セーブを完全なリプレイとして出力しない', () => {
    const game = createGame(); beginAction(game); finishAction(game);
    game.state.phase = 'end';
    assert.equal(finalizeReplayRecording(game.state, {}, []), null);
    const completeGame = createGame(); finishGame(completeGame);
    delete completeGame.state.replayRecord.turns[2].action.after;
    assert.equal(getCompletedReplay(completeGame.state), null);
    completeGame.state.replayRecord.turns[2] = null;
    assert.equal(getCompletedReplay(completeGame.state), null);
    const save = new SaveManager();
    const legacy = save.serializeGameState(completeGame.state); delete legacy.replayRecord;
    const restored = new GameState();
    save.restoreGameState(restored, legacy);
    assert.equal(restored.replayRecord, null);
    assert.equal(finalizeReplayRecording(restored, {}, []), null);
});

test('分析ログの打ち切りや配置予測が完全再現用の記録を消費しない', () => {
    const game = createGame();
    for (let i = 0; i < 3005; i++) game.state.record('offer', { cards: [], rarity: 'R' });
    assert.equal(game.state.playRecord.truncated, true);
    assert.equal(game.state.replayRecord.turns[0].events.filter(event => event.type === 'offer').length, 3005);
    const before = JSON.stringify(game.state.replayRecord);
    const simulation = game.turns.createSimulationState();
    game.turns.resolveCardAction(game.cards.allCards[0], 'leader', simulation);
    assert.equal(JSON.stringify(game.state.replayRecord), before);
    assert.equal(simulation.replayRecord, null);
});

test('解決途中の保存・復元でカードとイベントの記録を二重適用しない', () => {
    const game = createGame({ event: true });
    beginAction(game);
    const beforeStats = { experience: game.state.player.experience };
    game.state.updateStatus('experience', 2);
    const effect = { itemId: 'press-coverage', usageTotal: 1, beforeStats,
        afterStats: { experience: game.state.player.experience }, actual: 2 };
    captureReplayEventEffect(game.state, effect);
    captureReplayBoundary(game.state, 'checkpoint');
    const save = new SaveManager();
    const saved = JSON.parse(JSON.stringify(save.serializeGameState(game.state)));
    const restored = new GameState(); save.restoreGameState(restored, saved);
    const turns = new TurnManager(restored, game.cards);
    const recordLength = restored.replayRecord.turns[0].events.length;
    const experience = restored.player.experience;
    turns.executeActions();
    captureReplayEventEffect(restored, effect);
    assert.equal(restored.player.experience, experience);
    assert.equal(restored.replayRecord.turns[0].events.length, recordLength);
    assert.equal(restored.replayRecord.turns[0].action.eventEffects.length, 1);
    finishAction({ state: restored, turns });
    const completed = finishGame({ state: restored, turns });
    assert.equal(completed.complete, true);
    assert.equal(completed.turns[0].action.eventEffects[0].actual, 2);
    assert.equal(completed.turns[0].action.after.player.experience, experience);
});
