import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomCode, parseRoomCode, hasStartedRoom, recordRoomStart } from '../../game/js/colleagueRoom.js?v=20261122-0069';

test('部屋の発行と入室は先頭数字で難易度を決め、割り当て範囲外を拒む', () => {
    for (const [difficulty, low, high] of [['fresh',1,2], ['pro',3,4], ['int',5,6]]) {
        assert.equal(parseRoomCode(low + '0000000').difficulty, difficulty);
        assert.equal(parseRoomCode(high + '9999999').difficulty, difficulty);
        assert.equal(parseRoomCode(createRoomCode(difficulty)).difficulty, difficulty);
    }
    assert.equal(parseRoomCode('　５００００００１　').code, '50000001');
    for (const invalid of ['01234567','70000000','80000000','99999999','900000000','1234567']) {
        assert.equal(parseRoomCode(invalid), null);
    }
});

test('同じ番号は同じルール版で再挑戦になり、別版では新しいシードと開始記録を使う', () => {
    const items = new Map(), storage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
    const previous = globalThis.window;
    try {
        globalThis.window = { BUILD_VERSION: 'v20261122-0069' };
        const code = '50000001';
        const seed = parseRoomCode(code).seed;
        assert.equal(recordRoomStart(code, storage), true);
        globalThis.window.BUILD_VERSION = 'v20261122-0070';
        assert.equal(parseRoomCode(code).seed, seed);
        assert.equal(hasStartedRoom(code, storage), true);
        globalThis.window.BUILD_VERSION = 'v20261123-0071';
        assert.notEqual(parseRoomCode(code).seed, seed);
        assert.equal(hasStartedRoom(code, storage), false);
    } finally {
        if (previous === undefined) delete globalThis.window;
        else globalThis.window = previous;
    }
});
