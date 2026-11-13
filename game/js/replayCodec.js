import { compactReplay, expandReplay } from './replayCompact.js?v=20261110-0066';
import { operationReplayPacket, restoreOperationReplay, ReplaySimulationError } from './replaySimulation.js?v=20261110-0066';

export const REPLAY_PREFIX = 'CDGR1:';
export const COMPACT_REPLAY_PREFIX = 'CDGR1.';
export const MAX_REPLAY_BYTES = 8 * 1024 * 1024;
const MAX_COMPRESSED_BYTES = MAX_REPLAY_BYTES + 65536;
const MAX_REPLAY_TEXT_LENGTH = Math.ceil(MAX_COMPRESSED_BYTES * 4 / 3) + REPLAY_PREFIX.length;
const BUILD_PATTERN = /^v(\d{8})-\d{4}$/;

class ReplayDataError extends Error {}

function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateReplayRecord(record) {
    const metadata = record?.metadata;
    const valid = record?.schema === 1 && record.complete === true && object(metadata) &&
        typeof metadata.buildVersion === 'string' && BUILD_PATTERN.test(metadata.buildVersion) && typeof metadata.difficulty === 'string' && metadata.difficulty.length > 0 &&
        typeof metadata.runId === 'string' && metadata.runId.length > 0 && typeof metadata.seed === 'string' &&
        typeof metadata.calcMode === 'boolean' && (metadata.eventId === null || typeof metadata.eventId === 'string') &&
        Number.isInteger(metadata.totalTurns) && metadata.totalTurns > 0 && metadata.totalTurns <= 64 &&
        object(record.initial) && Array.isArray(record.turns) && record.turns.length === metadata.totalTurns &&
        record.turns.every((turn, index) => object(turn) && turn.turn === index && turn.completed === true && Array.isArray(turn.training) &&
            object(turn.actionStart) && object(turn.action) && object(turn.action.before) && object(turn.action.placed) &&
            object(turn.action.cardEffects) && Array.isArray(turn.action.eventEffects) && object(turn.action.after) && object(turn.meeting) &&
            object(turn.meeting.after) && Array.isArray(turn.meeting.deleted) && typeof turn.meeting.skipped === 'boolean') &&
        object(record.result) && object(record.result.score) && Number.isFinite(record.result.score.displayScore) &&
        Array.isArray(record.result.finalDeck) && object(record.result.state);
    if (!valid) throw new ReplayDataError('再現に必要なプレイ記録が不足しています');
    return record;
}

async function readBytes(stream, limit) {
    const reader = stream.getReader();
    const chunks = [];
    let length = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > limit) {
                await reader.cancel();
                throw new ReplayDataError('リプレイデータが大きすぎます');
            }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result;
}

function encodeBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeBase64(text) {
    if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) throw new ReplayDataError('リプレイデータのテキスト形式が正しくありません');
    const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
    const result = Uint8Array.from(binary, char => char.charCodeAt(0));
    if (encodeBase64(result) !== text) throw new ReplayDataError('リプレイデータのテキスト形式が正しくありません');
    return result;
}

export async function encodeReplay(record) {
    validateReplayRecord(record);
    if (typeof CompressionStream !== 'function') throw new ReplayDataError('この環境ではリプレイデータを出力できません');
    const operations = operationReplayPacket(record);
    let compact, json;
    if (operations) {
        compact = operations; json = JSON.stringify(operations);
        if (new TextEncoder().encode(json).byteLength > MAX_REPLAY_BYTES) throw new ReplayDataError('リプレイデータが大きすぎます');
        await restoreOperationReplay(operations);
    } else {
        json = JSON.stringify(record);
        if (new TextEncoder().encode(json).byteLength > MAX_REPLAY_BYTES) throw new ReplayDataError('リプレイデータが大きすぎます');
        compact = compactReplay(JSON.parse(json));
        if (compact) json = JSON.stringify(compact);
    }
    const bytes = new TextEncoder().encode(json);
    const compressed = await readBytes(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')), MAX_COMPRESSED_BYTES);
    return (compact ? COMPACT_REPLAY_PREFIX : REPLAY_PREFIX) + encodeBase64(compressed);
}

export async function decodeReplay(text, { currentBuildVersion, maxDecodedBytes = MAX_REPLAY_BYTES } = {}) {
    if (typeof text !== 'string' || text.length > MAX_REPLAY_TEXT_LENGTH) throw new ReplayDataError('リプレイデータのテキスト形式が正しくありません');
    const normalized = text.trim();
    const prefix = normalized.slice(0, REPLAY_PREFIX.length).toUpperCase();
    if (prefix !== REPLAY_PREFIX && prefix !== COMPACT_REPLAY_PREFIX) throw new ReplayDataError('対応していないリプレイデータの形式です');
    if (typeof DecompressionStream !== 'function') throw new ReplayDataError('この環境ではリプレイデータを読み込めません');
    if (!Number.isInteger(maxDecodedBytes) || maxDecodedBytes < 1 || maxDecodedBytes > MAX_REPLAY_BYTES) throw new ReplayDataError('展開後サイズの上限が正しくありません');
    let record;
    try {
        const compressed = decodeBase64(normalized.slice(REPLAY_PREFIX.length));
        const bytes = await readBytes(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')), maxDecodedBytes);
        record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (prefix === COMPACT_REPLAY_PREFIX) record = Array.isArray(record) && record[0] === 1
            ? await restoreOperationReplay(record, { currentBuildVersion, maxDecodedBytes }) : expandReplay(record, maxDecodedBytes);
    } catch (error) {
        if (error instanceof ReplayDataError) throw error;
        if (error instanceof ReplaySimulationError) throw new ReplayDataError(error.message);
        if (error instanceof RangeError && /大きすぎ/.test(error.message)) throw new ReplayDataError(error.message);
        throw new ReplayDataError('リプレイデータが壊れています');
    }
    validateReplayRecord(record);
    if (currentBuildVersion !== undefined) {
        const current = String(currentBuildVersion).match(BUILD_PATTERN);
        const saved = record.metadata.buildVersion.match(BUILD_PATTERN);
        if (!current || current[1] !== saved[1]) throw new ReplayDataError('このリプレイは現在のゲームと互換性がありません');
    }
    return record;
}
