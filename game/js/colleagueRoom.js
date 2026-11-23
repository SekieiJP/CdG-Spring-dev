import { resultRulesEpoch } from './resultPresentation.js?v=20261122-0070';

const DIFFICULTIES = ['fresh', 'pro', 'int'];
const FIRST_CODE = 10_000_000;
const CODES_PER_DIFFICULTY = 20_000_000;
const ROOM_CODE_PATTERN = /^[1-6]\d{7}$/;

function rulesEpoch() {
    return resultRulesEpoch({ buildVersion: globalThis.window?.BUILD_VERSION });
}

function startedRoomsKey() {
    return 'cdg_room_started_codes:' + rulesEpoch();
}

export function parseRoomCode(input) {
    const code = String(input ?? '').trim().replace(/[０-９]/g, digit =>
        String.fromCharCode(digit.charCodeAt(0) - 0xFEE0));
    if (!ROOM_CODE_PATTERN.test(code)) return null;
    const difficulty = DIFFICULTIES[Math.floor((Number(code) - FIRST_CODE) / CODES_PER_DIFFICULTY)];
    return { code, difficulty, seed: `room:${rulesEpoch()}:${code}` };
}

export function createRoomCode(difficulty) {
    const index = DIFFICULTIES.indexOf(difficulty);
    if (index < 0) throw new TypeError('未対応の部屋の難易度です。');
    const range = CODES_PER_DIFFICULTY;
    let n;
    if (globalThis.crypto?.getRandomValues) {
        const limit = Math.floor(0x100000000 / range) * range;
        const sample = new Uint32Array(1);
        do { globalThis.crypto.getRandomValues(sample); } while (sample[0] >= limit);
        n = sample[0] % range;
    } else {
        n = Math.floor(Math.random() * range);
    }
    return String(FIRST_CODE + index * range + n);
}

function readStartedRooms(storage) {
    const raw = storage.getItem(startedRoomsKey());
    if (raw === null) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.some(code => typeof code !== 'string' || !ROOM_CODE_PATTERN.test(code))) {
        throw new Error('部屋コードの開始記録を読み取れません。サイトデータを確認してください。');
    }
    return new Set(parsed);
}

export function hasStartedRoom(code, storage = globalThis.localStorage) {
    const parsed = parseRoomCode(code);
    if (!parsed) return false;
    if (!storage) throw new Error('部屋コードの開始記録を読み取れません。');
    return readStartedRooms(storage).has(parsed.code);
}

export function recordRoomStart(code, storage = globalThis.localStorage) {
    const parsed = parseRoomCode(code);
    if (!parsed) throw new TypeError('部屋コードの形式が正しくありません。');
    if (!storage) throw new Error('部屋コードの開始記録を保存できません。');
    const started = readStartedRooms(storage);
    if (started.has(parsed.code)) return false;
    started.add(parsed.code);
    storage.setItem(startedRoomsKey(), JSON.stringify([...started]));
    if (!readStartedRooms(storage).has(parsed.code)) {
        throw new Error('部屋コードの開始記録を保存できませんでした。');
    }
    return true;
}
