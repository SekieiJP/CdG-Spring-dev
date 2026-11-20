import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(new URL('../../gas/scoreReceiver.gs', import.meta.url), 'utf8');
export function createScoreReceiver(initialRows = []) {
    const rows = structuredClone(initialRows), cache = new Map();
    const state = { busy: false, locked: false, failWrite: false, failFlush: false, cacheDown: false };
    const historyRows = [];
    const makeSheet = (rows, history = false) => ({
        getLastRow: () => rows.length,
        getLastColumn: () => Math.max(0, ...rows.map(row => row.length)),
        appendRow: row => {
            assert.equal(state.locked, true);
            if (state.failWrite && rows.length) { state.failWrite = false; throw new Error('write'); }
            if (history && state.failHistoryPart === rows.length) { state.failHistoryPart = null; throw new Error('history write'); }
            rows.push([...row]);
        },
        getRange: (row, column, height = 1, width = 1) => ({
            getValue: () => rows[row - 1][column - 1],
            getValues: () => rows.slice(row - 1, row - 1 + height).map(values => values.slice(column - 1, column - 1 + width)),
            setValue: value => { assert.equal(state.locked, true); rows[row - 1][column - 1] = value; },
            createTextFinder: value => {
                let entire = false, caseSensitive = false;
                const finder = {
                    matchEntireCell: flag => { entire = flag; return finder; },
                    matchCase: flag => { caseSensitive = flag; return finder; },
                    findNext: () => {
                        const normalize = text => caseSensitive ? String(text || '') : String(text || '').toLowerCase();
                        const index = rows.slice(row - 1, row - 1 + height).findIndex(values => entire ? normalize(values[column - 1]) === normalize(value) : normalize(values[column - 1]).includes(normalize(value)));
                        return index < 0 ? null : { getRow: () => row + index };
                    }
                }; return finder;
            }
        })
    });
    const sheet = makeSheet(rows), historySheet = makeSheet(historyRows, true);
    const sheets = new Map([['スコア記録', sheet], ['ターン履歴', historySheet]]);
    const context = vm.createContext({
        console: { log() {}, error() {} },
        ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
        LockService: { getScriptLock: () => ({ tryLock: () => { if (state.busy) return false; state.locked = true; return true; }, releaseLock: () => { state.locked = false; } }) },
        SpreadsheetApp: {
            getActiveSpreadsheet: () => { assert.equal(state.locked, true); return { getSheetByName: name => sheets.get(name), insertSheet: name => { const added = makeSheet([]); sheets.set(name, added); return added; } }; },
            flush: () => { if (state.failFlush) { state.failFlush = false; throw new Error('flush'); } }
        },
        CacheService: { getScriptCache: () => { if (state.cacheDown) throw new Error('cache'); return { get: key => cache.get(key), put: (key, value) => cache.set(key, value) }; } },
        Utilities: { getUuid: randomUUID, DigestAlgorithm: { MD5: 'md5', SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, computeDigest: (algorithm, value) => [...createHash(algorithm).update(value).digest()] }
    });
    vm.runInContext(source, context);
    return { rows, historyRows, cache, state, submit: data => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(data) } }).text) };
}
