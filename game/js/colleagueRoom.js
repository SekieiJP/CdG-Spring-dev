const ROOM_START_KEY = 'cdg_room_started_codes';
const ROOM_CODE_PATTERN = /^\d{8}$/;

export function parseRoomCode(input) {
    const code = String(input ?? '').trim().replace(/[０-９]/g, digit =>
        String.fromCharCode(digit.charCodeAt(0) - 0xFEE0));
    if (!ROOM_CODE_PATTERN.test(code)) return null;
    const difficulty = Number(code.at(-1)) % 2 === 0 ? 'fresh' : 'pro';
    return { code, difficulty, seed: `room:${code}` };
}

export function createRoomCode(difficulty) {
    if (!['fresh', 'pro'].includes(difficulty)) {
        throw new TypeError('難易度はfreshまたはproを指定してください。');
    }

    const limit = Math.floor(0x100000000 / 50_000_000) * 50_000_000;
    const sample = new Uint32Array(1);
    let value;
    if (globalThis.crypto?.getRandomValues) {
        do {
            globalThis.crypto.getRandomValues(sample);
            value = sample[0];
        } while (value >= limit);
    } else {
        value = Math.floor(Math.random() * 50_000_000);
        return String(value * 2 + (difficulty === 'pro' ? 1 : 0)).padStart(8, '0');
    }
    const n = value % 50_000_000;
    return String(n * 2 + (difficulty === 'pro' ? 1 : 0)).padStart(8, '0');
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
    if (!parsed) throw new TypeError('部屋コードは数字8桁で指定してください。');
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
