import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import '../../game/js/difficultyExtensions.js?v=20261110-0066';
import { ScoreManager } from '../../game/js/scoreManager.js?v=20261110-0066';
import { GameState } from '../../game/js/gameState.js?v=20261110-0066';
import { SaveManager } from '../../game/js/saveManager.js?v=20261110-0066';
import { ResultRepository } from '../../game/js/resultRepository.js?v=20261110-0066';
import { startReplayRecording, getCompletedReplay } from '../../game/js/replayRecorder.js?v=20261110-0066';

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

test('INTは1.5倍切り上げのランク境界とPRO得点帯を使う', async () => {
    const manager = new ScoreManager(null, { migrateHighScore: false });
    await loadRanks(manager, 'Int');

    const nearExperienceTarget = manager.getStatusRank('experience', 22, 'int');
    assert.equal(nearExperienceTarget.grade, 'D');
    assert.equal(nearExperienceTarget.targetGrade, 'C');
    assert.equal(nearExperienceTarget.deficit, 1);
    assert.equal(manager.getStatusRank('accounting', 22, 'int').grade, 'A+');
    assert.equal(manager.getStatusRank('experience', 74, 'int').deficit, 1);
    assert.equal(manager.getStatusRank('experience', 75, 'int').grade, 'SS');
    assert.equal(manager.getStatusRank('enrollment', 11, 'int').deficit, 1);
    assert.equal(manager.getStatusRank('satisfaction', 37, 'int').targetGrade, 'S+');

    const pointThresholds = manager.calculateScore({ difficulty: 'int', player: {
        experience: 23, enrollment: 12, satisfaction: 38, accounting: 20
    } });
    assert.deepEqual(pointThresholds.breakdown, {
        mobilizationPoints: 1, withdrawalPoints: 1,
        enrollmentDiffPoints: 1, satisfactionPoints: 1
    });

    const maxScore = manager.calculateScore({ difficulty: 'int', player: {
        experience: 75, enrollment: 72, satisfaction: 53, accounting: 20
    } });
    assert.equal(maxScore.points, 16);
    assert.equal(maxScore.rank.grade, 'SS');

    const score = manager.calculateScore({ difficulty: 'int', player: {
        experience: 23, enrollment: 18, satisfaction: 17, accounting: 19
    } });
    assert.equal(score.withdrawal, 4);
    assert.equal(score.enrollmentDiff, 14);
    assert.deepEqual(score.breakdown, {
        mobilizationPoints: 1, withdrawalPoints: -5,
        enrollmentDiffPoints: 1, satisfactionPoints: 0
    });
    assert.equal(score.points, -3);

    const fallback = manager.calculateScore({ difficulty: 'int', player: {
        experience: 0, enrollment: 0, satisfaction: 20, accounting: 15
    } });
    assert.equal(fallback.withdrawal, 5);
    assert.equal(fallback.breakdown.withdrawalPoints, -13);
});

test('INTの退塾基準は20で、FRESHとPROの15基準は維持する', () => {
    const manager = new ScoreManager(null, { migrateHighScore: false });
    const state = (difficulty, accounting, satisfaction) => ({ difficulty, player: { accounting, satisfaction } });
    assert.equal(manager.calculateWithdrawal(state('int', 19, 17)), 4);
    assert.equal(manager.calculateWithdrawal(state('pro', 14, 13)), 3);
    assert.equal(manager.calculateWithdrawal(state('fresh', 14, 13)), 3);
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

test('INT結果は端末履歴に保存し、送信待ちやPRO形式リプレイを作らない', () => {
    const repository = new ResultRepository(memoryStorage());
    repository.commit({ resultId: 'int-result', difficulty: 'int', score: { displayScore: 0 } },
        { resultId: 'int-result', difficulty: 'int' }, { submit: false });
    assert.equal(repository.find('int-result').submission, 'local');
    assert.deepEqual(repository.pending(), []);

    const state = new GameState();
    state.reset('int');
    assert.equal(startReplayRecording(state), false);
    assert.equal(getCompletedReplay(state), null);
});
