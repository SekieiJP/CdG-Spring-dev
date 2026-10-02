/** 個人情報を含めず、端末内と自動プレイで共通に使う計測記録。 */
export function cardIdentity(card) {
    return { cardName: card.cardName, cardNo: card.cardNo, definitionId: card.definitionId || `card:${card.cardNo || `${card.rarity}:${card.cardName}`}`,
        instanceId: card.instanceId, poolId: card.poolId, rarity: card.rarity, category: card.category, acquiredTurn: card.acquiredTurn };
}

export function createPlayRecord(state, metadata = {}) {
    return { schema: 1, metadata: { codeVersion: globalThis.window?.BUILD_VERSION || 'unknown',
        rulesVersion: state.config.rulesVersion || globalThis.window?.BUILD_VERSION?.slice(1, 9) || 'unknown',
        difficulty: state.difficulty, source: 'human', strategy: null, seed: state.rng.seed,
        randomAlgorithm: state.rng.constructor.algorithm, totalTurns: state.totalTurns, ...metadata }, events: [] };
}

export function recordPlayEvent(state, type, data) {
    if (!state.playRecord) return;
    if (state.playRecord.events.length >= 3000) { state.playRecord.truncated = true; return; }
    state.playRecord.events.push({ sequence: state.playRecord.events.length, turn: state.turn,
        phase: state.phase, type, ...structuredClone(data) });
}

export async function fingerprint(text) {
    if (globalThis.crypto?.subtle) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return `sha256:${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
    }
    let value = 2166136261;
    for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
    return `fnv1a32:${(value >>> 0).toString(16)}`;
}
