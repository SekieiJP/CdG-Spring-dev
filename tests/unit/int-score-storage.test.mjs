import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import '../../game/js/difficultyExtensions.js?v=20261122-0069';
import { ScoreManager } from '../../game/js/scoreManager.js?v=20261122-0069';
import { GameState } from '../../game/js/gameState.js?v=20261122-0069';
import { TurnManager } from '../../game/js/turnManager.js?v=20261122-0069';
import { CardManager } from '../../game/js/cardManager.js?v=20261122-0069';
import { SaveManager } from '../../game/js/saveManager.js?v=20261122-0069';
import { ResultRepository } from '../../game/js/resultRepository.js?v=20261122-0069';
import { startReplayRecording, getCompletedReplay } from '../../game/js/replayRecorder.js?v=20261122-0069';

async function loadRanks(manager, difficulty) {
    const path = new URL(`../../game/data/rank${difficulty}.csv`, import.meta.url);
    const csv = await readFile(path, 'utf8');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, text: async () => csv });
    try { return await manager.loadRankData('test-ranks'); }
    finally { globalThis.fetch = originalFetch; }
}

function memoryStorage() {
    const data = new Map();
    return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
}

test('MASTERのゲージと結果に新しい基準を使う', async () => {
    const manager = new ScoreManager(null, { migrateHighScore: false });
    await loadRanks(manager, 'Int');

    assert.equal(manager.getStatusRank('experience', 31, 'int').deficit, 1);
    assert.equal(manager.getStatusRank('experience', 84, 'int').grade, 'SSS');
    assert.equal(manager.getStatusRank('enrollment', 20, 'int').deficit, 1);
    assert.equal(manager.getStatusRank('enrollment', 0, 'int').startThreshold, 0);
    assert.equal(manager.getStatusRank('accounting', 14, 'int').deficit, 1);
    for (const [value, start, next] of [[14, 0, 15], [15, 15, 30], [30, 30, 40], [40, 40, 40]]) {
        const rank = manager.getStatusRank('satisfaction', value, 'int');
        assert.deepEqual([rank.startThreshold, rank.nextThreshold], [start, next]);
    }

    const score = (experience, enrollment, satisfaction, accounting) => manager.calculateScore({
        difficulty: 'int', player: { experience, enrollment, satisfaction, accounting }
    });
    assert.deepEqual(score(32, 21, 30, 15).breakdown, {
        mobilizationPoints: 1, withdrawalPoints: 1, enrollmentDiffPoints: 1, satisfactionPoints: 1
    });
    const top = score(84, 70, 30, 15);
    assert.equal(top.points, 19);
    assert.deepEqual(top.rank, { grade: 'SSS', name: '業界に轟く伝説の室長、爆誕！！！' });
    assert.equal(score(83, 70, 30, 15).rank.grade, 'SS+');
    assert.equal(score(32, 28, 13, 11).breakdown.withdrawalPoints, -9);
    const lowest = score(0, 0, 0, 0);
    assert.equal(lowest.withdrawal, 30);
    assert.equal(lowest.breakdown.withdrawalPoints, -15);
});

test('MASTERは満足・経理3で開始し、両方が15に達すると退塾0人になる', () => {
    const manager = new ScoreManager(null, { migrateHighScore: false });
    const state = new GameState();
    state.reset('int');
    assert.equal(state.player.satisfaction, 3);
    assert.equal(state.player.accounting, 3);
    assert.equal(manager.calculateWithdrawal(state), 24);
    Object.assign(state.player, { satisfaction: 14, accounting: 16 });
    assert.equal(manager.calculateWithdrawal(state), 1);
    state.player.satisfaction = 15;
    assert.equal(manager.calculateWithdrawal(state), 0);
});

test('講習で要求枚数に足りない山札から残りを引き、手札と捨て札を保持する', () => {
    const state = new GameState();
    state.reset('int');
    state.turn = 6;
    state.phase = 'training';
    const available = { cardNo: '1', cardName: '問合対応の基本' };
    const held = { cardNo: '3', cardName: '質問対応の基本' };
    const used = { cardNo: '4', cardName: '生徒面談の基本' };
    state.addToDeck(available);
    state.addToHand(held);
    state.ruleState.int.springDiscard.push(used);
    state.tokens.passion = 1;
    const manager = new TurnManager(state, new CardManager());
    manager.advancePhase();
    assert.deepEqual(state.player.hand, [held, available]);
    assert.equal(state.player.deck.length, 0);
    assert.deepEqual(state.ruleState.int.springDiscard, [used]);
    assert.deepEqual(state.lastDrawNotification, { passion: 1, fatigue: 0, drawCount: 1, requested: 4 });
});

test('INTハイスコアは専用キーに保存され、他難易度の記録を共有しない', () => {
    const previousStorage = globalThis.localStorage;
    const data = new Map();
    globalThis.localStorage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
    try {
        const manager = new ScoreManager(null, { migrateHighScore: false });
        const score = { points: 16, displayScore: 16, rank: { grade: 'SS' } };
        assert.equal(manager.saveHighScore(score, 'int'), true);
        assert.equal(manager.getHighScore('int').rank.grade, 'SS');
        assert.equal(manager.getHighScore('pro'), null);
    } finally {
        if (previousStorage === undefined) delete globalThis.localStorage;
        else globalThis.localStorage = previousStorage;
    }
});

test('INTの中旬途中保存は難易度と固有状態を保ち、上8桁で互換判定する', () => {
    globalThis.window = { BUILD_VERSION: 'v20261110-0066' };
    const state = new GameState();
    state.reset('int');
    state.turn = 2;
    state.phase = 'outing';
    state.ruleState.int = {
        outing: { place: '本部', stage: 'staff', candidates: [{ cardNo: '40', poolId: 'sr-1' }], selectedCard: { cardNo: '40' } },
        springDiscard: [{ cardNo: '2', cardName: '質問対応の基本' }]
    };
    state.tokens.passion = 1;

    const manager = new SaveManager();
    const snapshot = JSON.parse(JSON.stringify(manager.serializeGameState(state)));
    const restored = new GameState();
    manager.restoreGameState(restored, snapshot);
    assert.equal(restored.difficulty, 'int');
    assert.equal(restored.phase, 'outing');
    assert.deepEqual(restored.ruleState, state.ruleState);
    assert.equal(restored.tokens.passion, 1);
    assert.equal(manager.isVersionMatch({ buildVersion: 'v20261110-0050' }), true);
    assert.equal(manager.isVersionMatch({ buildVersion: 'v20261111-0001' }), false);
});

test('MASTERは共有停止中も端末に履歴を残し、初回からリプレイの記録を開始できる', () => {
    const repository = new ResultRepository(memoryStorage());
    repository.commit({ resultId: 'int-result', difficulty: 'int', score: { displayScore: 0 } },
        { resultId: 'int-result', difficulty: 'int' }, { submit: false });
    assert.equal(repository.find('int-result').submission, 'local');
    assert.deepEqual(repository.pending(), []);

    const state = new GameState();
    state.reset('int');
    assert.equal(startReplayRecording(state), true);
    assert.equal(getCompletedReplay(state), null);
});
