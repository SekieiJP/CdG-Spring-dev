const ROOM_START_KEY = 'cdg_room_started_codes';
const ROOM_CODE_PATTERN = /^(?:9\d{8}|\d{8})$/;

export function parseRoomCode(input) {
    const code = String(input ?? '').trim().replace(/[０-９]/g, digit =>
        String.fromCharCode(digit.charCodeAt(0) - 0xFEE0));
    if (!ROOM_CODE_PATTERN.test(code)) return null;
    const difficulty = code.length === 9 ? 'int' : Number(code.at(-1)) % 2 === 0 ? 'fresh' : 'pro';
    return { code, difficulty, seed: `room:${code}` };
}

export function createRoomCode(difficulty) {
    if (!['fresh', 'pro', 'int'].includes(difficulty)) throw new TypeError('未対応の部屋の難易度です。');
    const master = difficulty === 'int';
    const range = master ? 100_000_000 : 50_000_000;
    let n;
    if (globalThis.crypto?.getRandomValues) {
        const limit = Math.floor(0x100000000 / range) * range;
        const sample = new Uint32Array(1);
        do { globalThis.crypto.getRandomValues(sample); } while (sample[0] >= limit);
        n = sample[0] % range;
    } else {
        n = Math.floor(Math.random() * range);
    }
    if (master) return '9' + String(n).padStart(8, '0');
    return String(2 * n + (difficulty === 'pro' ? 1 : 0)).padStart(8, '0');
}

function readStartedRooms(storage) {
    const raw = storage.getItem(ROOM_START_KEY);
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
    storage.setItem(ROOM_START_KEY, JSON.stringify([...started]));
    if (!readStartedRooms(storage).has(parsed.code)) {
        throw new Error('部屋コードの開始記録を保存できませんでした。');
    }
    return true;
}
