import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResultRepository } from '../../game/js/resultRepository.js?v=20260815-0054';
import { SubmissionQueue } from '../../game/js/submissionQueue.js?v=20260815-0054';
import { buildScorePayload, submitPayload } from '../../game/js/scoreSubmitter.js?v=20260815-0054';
import { GameState } from '../../game/js/gameState.js?v=20260815-0054';

function memoryStorage() {
    const items = new Map();
    return { getItem: key => items.get(key) || null, setItem: (key, value) => items.set(key, value) };
}
function add(repository, id, overrides = {}) {
    return repository.commit({ resultId: id, difficulty: 'pro', mode: '通常', rulesVersion: '20260815', cardVersion: 'card-1', rankVersion: 'rank-1', ...overrides },
        { resultId: id, completedAt: '2026-10-02T00:00:00Z', finalDeck: ['確定カード'] });
}

test('履歴50件と送信待ち5件は別の上限で、上限から外れた結果も履歴に残る', () => {
    const repository = new ResultRepository(memoryStorage());
    for (let i = 1; i <= 55; i++) add(repository, `result-${i}`);
    assert.equal(repository.history().length, 50);
    assert.deepEqual(repository.pending().map(row => row.resultId), [51, 52, 53, 54, 55].map(i => `result-${i}`));
    assert.equal(repository.find('result-6').submission, 'outside-queue');
    add(repository, 'result-55');
    assert.equal(repository.pending().length, 5);
    repository.acknowledge('result-55');
    assert.equal(repository.pending().length, 4);
    assert.equal(repository.find('result-55').submission, 'sent');
});

test('後のゲームが送信済みでも6ゲーム以上前の未送信結果を保留し続けない', () => {
    const repository = new ResultRepository(memoryStorage()); add(repository, 'old');
    for (let i = 1; i < 6; i++) { add(repository, `later-${i}`); repository.acknowledge(`later-${i}`); }
    assert.equal(repository.pending().length, 0);
    assert.equal(repository.find('old').submission, 'outside-queue');
    assert.equal(repository.history().length, 6);
});

test('保存容量に達しても古い永続データで画面内の結果を失わず、回復後に保存できる', () => {
    const storage = memoryStorage(); const repository = new ResultRepository(storage);
    add(repository, 'first');
    const originalSet = storage.setItem;
    storage.setItem = () => { throw new Error('quota'); };
    add(repository, 'second');
    assert.equal(repository.history().length, 2);
    repository.acknowledge('second');
    assert.equal(repository.find('second').submission, 'sent');
    storage.setItem = originalSet;
    add(repository, 'third');
    assert.equal(repository.storageError, null);
    assert.equal(new ResultRepository(storage).history().length, 3);
});

test('前回比較は同じ環境の過去だけを使い、カード・ランク・実行モードの変更を混ぜない', () => {
    const repository = new ResultRepository(memoryStorage());
    const first = add(repository, 'first');
    add(repository, 'other-mode', { mode: '計算機' });
    add(repository, 'other-cards', { cardVersion: 'card-2' });
    add(repository, 'other-ranks', { rankVersion: 'rank-2' });
    const last = add(repository, 'last');
    assert.equal(repository.previous(last).resultId, first.resultId);
    assert.equal(repository.previous(first), null);
});

test('完了時に作った送信結果は、次のゲームや元の配列・得点の変更から独立する', () => {
    globalThis.window = { BUILD_VERSION: 'v20260815-0052' };
    globalThis.document = { cookie: '' };
    const state = new GameState(); state.reset('pro'); state.recordStartTime(); state.discardedCards = ['削除'];
    const score = { experience: 10, enrollment: 5, satisfaction: 3, accounting: 8, displayScore: 6, rank: { grade: 'A' }, points: 6, withdrawal: 0, mobilization: 10, enrollmentDiff: 5 };
    const deck = [{ cardName: '完成デッキ' }];
    const payload = buildScorePayload(state, score, deck, { cardVersion: 'card-1', rankVersion: 'rank-1' });
    const snapshot = structuredClone(payload);
    deck[0].cardName = '別デッキ'; state.discardedCards.push('追加'); score.rank.grade = 'D'; state.reset('fresh');
    assert.deepEqual(payload, snapshot);
    assert.notEqual(payload.resultId, state.runId);
});

test('fetchとJSON応答の停止をそれぞれタイムアウトし、Abortを無視する通信も待ち続けない', { timeout: 1000 }, async () => {
    for (const fetchImpl of [() => new Promise(() => {}), async () => ({ ok: true, json: () => new Promise(() => {}) })]) {
        const result = await submitPayload({ resultId: 'timeout' }, null, { timeoutMs: 20, fetchImpl });
        assert.equal(result.ok, false); assert.match(result.error, /タイムアウト/);
    }
});

test('別の結果IDへの応答を成功扱いせず、中断した送信も未受領として返す', async () => {
    const mismatch = await submitPayload({ resultId: 'expected' }, null, { fetchImpl: async () => ({ ok: true, json: async () => ({ status: 'ok', resultId: 'other' }) }) });
    assert.equal(mismatch.ok, false);
    const controller = new AbortController(); controller.abort();
    const aborted = await submitPayload({ resultId: 'aborted' }, null, { signal: controller.signal, fetchImpl: () => { throw new Error('呼ばない'); } });
    assert.equal(aborted.ok, false); assert.match(aborted.error, /中断/);
});

test('失敗した送信は同じIDと完了時刻で3回試し、再起動後にも保留する', async () => {
    const storage = memoryStorage(); const repository = new ResultRepository(storage);
    add(repository, 'retry'); const payloads = [];
    const queue = new SubmissionQueue(repository, async payload => { payloads.push(payload); return { ok: false, error: 'network' }; }, { retryDelayMs: 1 });
    await queue.start();
    assert.equal(payloads.length, 3);
    assert.deepEqual(payloads[0], payloads[2]);
    const restored = new ResultRepository(storage);
    assert.equal(restored.pending()[0].attempts, 3);
    await new SubmissionQueue(restored, async () => ({ ok: true })).start();
    assert.equal(restored.find('retry').submission, 'sent');
    assert.equal(restored.pending().length, 0);
});

test('オフライン中は保持し、通信回復時に直近5ゲームだけを送信する', async () => {
    const repository = new ResultRepository(memoryStorage());
    for (let i = 0; i < 8; i++) add(repository, `offline-${i}`);
    let online = false; const sent = [];
    const queue = new SubmissionQueue(repository, async payload => { sent.push(payload.resultId); return { ok: true }; }, { online: () => online });
    await queue.start(); assert.equal(sent.length, 0);
    online = true; await queue.start();
    assert.deepEqual(sent, [3, 4, 5, 6, 7].map(i => `offline-${i}`));
});

test('送信中の古い結果が5件の上限から外れたら中断し、新たなゲームは別IDで送る', async () => {
    const repository = new ResultRepository(memoryStorage()); add(repository, 'old');
    const sent = []; let aborted = false;
    const queue = new SubmissionQueue(repository, (payload, signal) => {
        sent.push(payload.resultId);
        if (payload.resultId !== 'old') return Promise.resolve({ ok: true });
        return new Promise(resolve => signal.addEventListener('abort', () => { aborted = true; resolve({ ok: false }); }, { once: true }));
    });
    const running = queue.start();
    for (let i = 0; i < 5; i++) add(repository, `new-${i}`);
    queue.start(); await running;
    assert.equal(aborted, true);
    assert.equal(repository.find('old').submission, 'outside-queue');
    assert.equal(repository.pending().length, 0);
    assert.deepEqual(sent, ['old', ...[0, 1, 2, 3, 4].map(i => `new-${i}`)]);
});

test('送信中に新たな結果を追加しても同じ処理内で失敗結果の試行上限を増やさない', async () => {
    const repository = new ResultRepository(memoryStorage()); add(repository, 'old');
    const sent = []; let release;
    const queue = new SubmissionQueue(repository, async payload => {
        sent.push(payload.resultId);
        if (sent.length === 1) await new Promise(resolve => { release = resolve; });
        return { ok: payload.resultId !== 'old' };
    }, { retryDelayMs: 1 });
    const running = queue.start();
    add(repository, 'new'); queue.start(); release(); await running;
    assert.deepEqual(sent, ['old', 'old', 'old', 'new']);
    assert.equal(repository.pending()[0].attempts, 3);
});
