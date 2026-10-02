import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(new URL('../../gas/scoreReceiver.gs', import.meta.url), 'utf8');
const payload = overrides => ({ resultId: 'game-1', buildVersion: 'v20260815-0052', startedAt: 'start', completedAt: 'end', userUUID: 'user',
    difficulty: 'pro', mode: '通常', experience: 20, enrollment: 10, satisfaction: 10, accounting: 10,
    displayScore: 8, points: 8, grade: 'A', withdrawal: 1, mobilization: 20, enrollmentDiff: 9,
    finalDeck: ['カード'], discardedCards: [], cardVersion: 'sha256:cards', rulesVersion: '20260815', rankVersion: 'sha256:ranks', ...overrides });

function server(initialRows = []) {
    const rows = structuredClone(initialRows), cache = new Map();
    const state = { busy: false, locked: false, failWrite: false, failFlush: false, cacheDown: false };
    const sheet = {
        getLastRow: () => rows.length,
        getLastColumn: () => Math.max(0, ...rows.map(row => row.length)),
        appendRow: row => {
            assert.equal(state.locked, true);
            if (state.failWrite && rows.length) { state.failWrite = false; throw new Error('write'); }
            rows.push([...row]);
        },
        getRange: (row, column, height = 1, width = 1) => ({
            getValues: () => rows.slice(row - 1, row - 1 + height).map(values => values.slice(column - 1, column - 1 + width)),
            setValue: value => { assert.equal(state.locked, true); rows[row - 1][column - 1] = value; },
            createTextFinder: value => {
                let entire = false, caseSensitive = false;
                const finder = {
                    matchEntireCell: flag => { entire = flag; return finder; },
                    matchCase: flag => { caseSensitive = flag; return finder; },
                    findNext: () => {
                        const normalize = text => caseSensitive ? String(text || '') : String(text || '').toLowerCase();
                        return rows.slice(row - 1, row - 1 + height).find(values => entire ? normalize(values[column - 1]) === normalize(value) : normalize(values[column - 1]).includes(normalize(value))) || null;
                    }
                }; return finder;
            }
        })
    };
    const context = vm.createContext({
        console: { log() {}, error() {} },
        ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
        LockService: { getScriptLock: () => ({ tryLock: () => { if (state.busy) return false; state.locked = true; return true; }, releaseLock: () => { state.locked = false; } }) },
        SpreadsheetApp: {
            getActiveSpreadsheet: () => { assert.equal(state.locked, true); return { getSheetByName: () => sheet, insertSheet: () => sheet }; },
            flush: () => { if (state.failFlush) { state.failFlush = false; throw new Error('flush'); } }
        },
        CacheService: { getScriptCache: () => { if (state.cacheDown) throw new Error('cache'); return { get: key => cache.get(key), put: (key, value) => cache.set(key, value) }; } },
        Utilities: { DigestAlgorithm: { MD5: 'md5' }, Charset: { UTF_8: 'utf8' }, computeDigest: (_, value) => [...createHash('md5').update(value).digest()] }
    });
    vm.runInContext(source, context);
    return { rows, cache, state, submit: data => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(data) } }).text) };
}

test('応答を失っても同じ結果IDの再送を受領済みとして返し、Cache失効後も1行だけ残す', () => {
    const receiver = server();
    assert.equal(receiver.submit(payload()).status, 'ok');
    receiver.cache.clear();
    const retry = receiver.submit(payload());
    assert.equal(retry.status, 'ok'); assert.equal(retry.duplicate, true); assert.equal(retry.resultId, 'game-1');
    assert.equal(receiver.rows.length, 2); assert.equal(receiver.state.locked, false);
});

test('書き込み失敗は受領済みにせず、再試行で保存できる', () => {
    const receiver = server(); receiver.state.failWrite = true;
    assert.equal(receiver.submit(payload()).status, 'error'); assert.equal(receiver.cache.size, 0);
    assert.equal(receiver.submit(payload()).status, 'ok'); assert.equal(receiver.rows.length, 2);
});

test('flush失敗後の再送も永続列で検出し、Cache障害があっても重複しない', () => {
    const receiver = server(); receiver.state.failFlush = true;
    assert.equal(receiver.submit(payload()).status, 'error'); assert.equal(receiver.cache.size, 0);
    receiver.state.cacheDown = true;
    assert.equal(receiver.submit(payload()).duplicate, true); assert.equal(receiver.rows.length, 2);
});

test('ロックを取得できないときは書き込まず、再試行可能なエラーを返す', () => {
    const receiver = server(); receiver.state.busy = true;
    assert.equal(receiver.submit(payload()).message, 'busy'); assert.equal(receiver.rows.length, 0);
    receiver.state.busy = false; assert.equal(receiver.submit(payload()).status, 'ok');
});

test('結果IDは部分一致や大文字小文字で混同せず、旧クライアントにも安定したIDを付ける', () => {
    const receiver = server();
    for (const id of ['abc2', 'abc', 'ABC']) assert.equal(receiver.submit(payload({ resultId: id })).duplicate, false);
    const old = payload(); delete old.resultId;
    const first = receiver.submit(old); receiver.cache.clear();
    const second = receiver.submit(old);
    assert.equal(first.resultId, second.resultId); assert.equal(second.duplicate, true); assert.equal(receiver.rows.length, 5);
});

test('既存列・行を維持して版と結果IDを追加し、追加難易度と多数カードを受け付ける', () => {
    const receiver = server([['受信日時', '総合スコア', '独自メモ'], ['previous', 7, '保持']]);
    assert.equal(receiver.submit(payload({ difficulty: 'example-difficulty', finalDeck: Array(60).fill('多数カード') })).status, 'ok');
    assert.deepEqual(receiver.rows[1], ['previous', 7, '保持']);
    assert.equal(receiver.rows[2][receiver.rows[0].indexOf('カードバージョン')], 'sha256:cards');
    assert.equal(receiver.rows[2][receiver.rows[0].indexOf('結果ID')], 'game-1');
    assert.equal(receiver.submit(payload({ resultId: 'too-many', finalDeck: Array(201).fill('カード') })).status, 'error');
    assert.equal(receiver.submit(null).status, 'error');
});
