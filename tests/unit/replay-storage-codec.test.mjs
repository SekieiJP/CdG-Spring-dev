import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { ResultRepository } from '../../game/js/resultRepository.js?v=20261110-0065';
import { encodeReplay, decodeReplay, REPLAY_PREFIX, MAX_REPLAY_BYTES } from '../../game/js/replayCodec.js?v=20261110-0065';

function storage() {
    const items = new Map();
    return { items, getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
}

function add(repository, id, extra = {}) {
    return repository.commit({ resultId: id, completedAt: id, score: { displayScore: 8 }, ...extra },
        { resultId: id, completedAt: id, displayScore: 8, finalDeck: ['固定カード'] });
}

function fullReplay() {
    const snapshot = { player: { satisfaction: 15, accounting: 15 }, tokens: {}, cards: ['sekiei-card-1'] };
    return {
        schema: 1, complete: true,
        metadata: { buildVersion: 'v20260815-0059', difficulty: 'fresh', calcMode: false, eventId: null,
            seed: 'sekiei-replay', totalTurns: 2, runId: 'sekiei-run' },
        initial: structuredClone(snapshot),
        definitions: { cards: [{ instanceId: 'sekiei-card-1', cardName: '履歴ごとに保持する確認用のカード' }] },
        turns: Array.from({ length: 2 }, (_, turn) => ({
            turn, training: [], actionStart: structuredClone(snapshot),
            action: { before: structuredClone(snapshot), placed: { leader: ['sekiei-card-1'] }, cardEffects: {}, eventEffects: [], after: structuredClone(snapshot) },
            meeting: { after: structuredClone(snapshot), deleted: [], skipped: false }, completed: true
        })),
        result: { score: { displayScore: 8.9 }, finalDeck: [{ cardName: '履歴ごとに保持する確認用のカード' }], state: structuredClone(snapshot) }
    };
}

test('お気に入り49件を保護し、履歴から消えた直近結果の送信内容は保持する', () => {
    const repository = new ResultRepository(storage());
    for (let i = 1; i <= 49; i++) {
        add(repository, `favorite-${i}`);
        assert.equal(repository.setFavorite(`favorite-${i}`, true).ok, true);
    }
    add(repository, 'normal-50');
    const pendingPayload = repository.pending().find(row => row.resultId === 'normal-50').payload;
    const before = repository.history();
    assert.equal(repository.setFavorite('normal-50', true).ok, false);
    assert.deepEqual(repository.history(), before);
    add(repository, 'normal-51');
    assert.equal(repository.history().length, 50);
    assert.equal(repository.favoriteCount(), 49);
    assert.equal(repository.find('normal-50'), null);
    assert.equal(repository.find('normal-51').favorite, false);
    assert.deepEqual(repository.pending().map(row => row.resultId), ['favorite-47', 'favorite-48', 'favorite-49', 'normal-50', 'normal-51']);
    assert.deepEqual(repository.pending().find(row => row.resultId === 'normal-50').payload, pendingPayload);
    assert.equal(repository.find('favorite-46').submission, 'outside-queue');
    const retainedHistory = repository.history();
    const retainedPending = repository.pending();
    add(repository, 'normal-50');
    assert.deepEqual(repository.history(), retainedHistory);
    assert.deepEqual(repository.pending(), retainedPending);
    repository.setFavorite('favorite-1', false);
    add(repository, 'normal-52');
    assert.equal(repository.find('favorite-1'), null);
    assert.ok(repository.find('normal-51'));
    assert.equal(repository.favoriteCount(), 48);
});

test('古いお気に入りは残しても、後続が送信済みなら古い未送信を保持しない', () => {
    const repository = new ResultRepository(storage());
    add(repository, 'old');
    repository.setFavorite('old', true);
    for (let i = 0; i < 6; i++) {
        add(repository, `later-${i}`);
        repository.acknowledge(`later-${i}`);
    }
    assert.equal(repository.find('old').favorite, true);
    assert.equal(repository.find('old').submission, 'outside-queue');
    assert.deepEqual(repository.pending(), []);
});

test('旧履歴を移行し、お気に入りとリプレイ操作が完了順・確定送信内容を変えない', () => {
    const target = storage();
    const legacy = {
        history: Array.from({ length: 8 }, (_, i) => ({ resultId: `old-${i}`, completedAt: i, submission: 'pending' })),
        pending: Array.from({ length: 5 }, (_, i) => ({ resultId: `old-${i + 3}`, payload: { fixed: i }, attempts: 0 }))
    };
    target.setItem(ResultRepository.KEY, JSON.stringify(legacy));
    const repository = new ResultRepository(target);
    assert.equal(repository.favoriteCount(), 0);
    repository.setFavorite('old-0', true);
    const pending = repository.pending();
    const order = repository.history().map(row => row.resultId);
    repository.setReplay('old-0', 'CDGR1:fixed');
    assert.deepEqual(repository.history().map(row => row.resultId), order);
    assert.deepEqual(repository.pending(), pending);
    add(repository, 'new-8');
    assert.deepEqual(repository.pending().map(row => row.resultId), ['old-4', 'old-5', 'old-6', 'old-7', 'new-8']);
    const restored = new ResultRepository(target);
    assert.equal(restored.find('old-0').favorite, true);
    assert.equal(restored.find('old-0').replayText, 'CDGR1:fixed');
});

test('圧縮後は元の記録を置換し、削除済み履歴へ非同期のリプレイを誤保存しない', () => {
    const repository = new ResultRepository(storage());
    add(repository, 'first', { replayPending: fullReplay() });
    const pending = repository.pending();
    const row = repository.setReplay('first', 'CDGR1:compressed');
    assert.equal(row.replayText, 'CDGR1:compressed');
    assert.equal('replayPending' in row, false);
    assert.deepEqual(repository.pending(), pending);
    for (let i = 0; i < 50; i++) add(repository, `next-${i}`);
    const snapshot = repository.history();
    assert.equal(repository.setReplay('first', 'CDGR1:late'), null);
    assert.deepEqual(repository.history(), snapshot);
});

test('保存容量不足でも既存のお気に入りを永続データから消さず、画面内の新記録を保つ', () => {
    const target = storage();
    const repository = new ResultRepository(target);
    add(repository, 'protected');
    repository.setFavorite('protected', true);
    repository.setReplay('protected', 'CDGR1:protected');
    const persisted = target.getItem(ResultRepository.KEY);
    target.setItem = () => { throw new Error('quota'); };
    add(repository, 'new', { replayPending: fullReplay() });
    repository.setReplay('new', 'CDGR1:new');
    assert.equal(target.getItem(ResultRepository.KEY), persisted);
    assert.equal(new ResultRepository(target).find('protected').favorite, true);
    assert.equal(repository.find('new').replayText, 'CDGR1:new');
    assert.equal(repository.find('protected').favorite, true);
    assert.equal(repository.storageError, 'quota');
});

test('圧縮テキストは元の再現データへ戻り、互換判定は上8桁で行う', async () => {
    const record = fullReplay();
    const text = await encodeReplay(record);
    assert.ok(text.startsWith(REPLAY_PREFIX));
    assert.equal(text.includes(record.result.finalDeck[0].cardName), false);
    assert.deepEqual(await decodeReplay(text, { currentBuildVersion: 'v20260815-0060' }), record);
    await assert.rejects(decodeReplay(text, { currentBuildVersion: 'v20261107-0001' }), /互換性/);
});

test('完全フラグだけでは、欠けたターン・演出・会議を出力も読込も認めない', async () => {
    const changes = [
        record => { record.complete = false; },
        record => { record.turns.pop(); },
        record => { delete record.turns[0].actionStart; },
        record => { delete record.turns[0].action.after; },
        record => { delete record.turns[0].action.eventEffects; },
        record => { delete record.turns[0].meeting.after; }
    ];
    for (const change of changes) {
        const record = fullReplay();
        change(record);
        await assert.rejects(encodeReplay(record), /不足/);
        const text = REPLAY_PREFIX + gzipSync(JSON.stringify(record)).toString('base64url');
        await assert.rejects(decodeReplay(text), /不足/);
    }
});

test('壊れたテキスト・圧縮データと、展開後サイズ超過を拒否する', async () => {
    for (const text of ['not-replay', REPLAY_PREFIX + '*broken', REPLAY_PREFIX + 'a', REPLAY_PREFIX + 'abcd']) {
        await assert.rejects(decodeReplay(text), /形式|壊れて/);
    }
    const text = await encodeReplay(fullReplay());
    const bytes = Buffer.from(text.slice(REPLAY_PREFIX.length), 'base64url');
    bytes[bytes.length - 1] ^= 255;
    await assert.rejects(decodeReplay(REPLAY_PREFIX + bytes.toString('base64url')), /壊れて/);
    await assert.rejects(decodeReplay(text, { maxDecodedBytes: 64 }), /大きすぎ/);
    const oversized = fullReplay();
    oversized.extra = 'x'.repeat(MAX_REPLAY_BYTES);
    await assert.rejects(encodeReplay(oversized), /大きすぎ/);
});
