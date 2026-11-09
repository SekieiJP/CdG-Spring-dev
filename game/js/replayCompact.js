const STATS = ['experience', 'enrollment', 'satisfaction', 'accounting'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const vector = stats => STATS.map(key => stats[key]);
const hasStats = stats => object(stats) && STATS.every(key => Number.isFinite(stats[key]));
const cardData = card => object(card) && ['cardName', 'category', 'rarity', 'effect'].every(key => typeof card[key] === 'string');

function difference(base, value) {
    return [Object.fromEntries(Object.entries(value).filter(([key, item]) => JSON.stringify(base[key]) !== JSON.stringify(item))),
        Object.keys(base).filter(key => !Object.hasOwn(value, key))];
}

export function compactReplay(record) {
    if (!['fresh', 'pro'].includes(record.metadata.difficulty) || !object(record.instances) || !Array.isArray(record.definitions?.cards)) return null;
    const ids = Object.keys(record.instances), instances = Object.values(record.instances);
    const index = new Map(ids.map((id, i) => [id, i]));
    const validGroups = groups => object(groups) && Object.values(groups).every(validList);
    const validList = list => Array.isArray(list) && list.every(id => index.has(id));
    const validSnapshot = snapshot => hasStats(snapshot?.player) && validList(snapshot.player.deck) && validList(snapshot.player.hand) &&
        validGroups(snapshot.player.placed) && validGroups(snapshot.player.zones || {});
    if (!instances.every(cardData) || !validSnapshot(record.initial) || !validSnapshot(record.result.state) ||
        !record.result.finalDeck.every(card => cardData(card) && index.has(card.instanceId)) ||
        !record.turns.every(turn => [turn.actionStart, turn.action.before, turn.action.after, turn.meeting.after].every(validSnapshot) &&
            (!turn.meetingStart || validSnapshot(turn.meetingStart)) && validGroups(turn.action.placed) &&
            Object.values(turn.action.cardEffects).every(info => Array.isArray(info?.cards) && info.cards.every(card => hasStats(card.beforeStats) && hasStats(card.afterStats))) &&
            turn.action.eventEffects.every(effect => hasStats(effect.beforeStats) && hasStats(effect.afterStats)) &&
            turn.meeting.deleted.every(event => index.has(event.card?.instanceId)))) return null;

    const definitions = record.definitions.cards.filter(card => instances.some(instance => instance.definitionId === card.definitionId));
    const encodedInstances = instances.map(card => {
        const definition = definitions.findIndex(item => item.definitionId === card.definitionId);
        return [definition, ...difference(definitions[definition] || {}, card)];
    });
    const list = cards => cards.map(id => index.get(id));
    const groups = value => Object.entries(value || {}).map(([key, cards]) => [key, list(cards)]);
    const snapshots = [], snapshotIndex = new Map();
    const snapshot = state => {
        if (!state) return null;
        const value = [state.turn ?? null, state.phase ?? null, vector(state.player), list(state.player.deck), list(state.player.hand),
            groups(state.player.placed), groups(state.player.zones), state.tokens || {},
            state.event ? { enabled: !!state.event.enabled, eventId: state.event.eventId } : null];
        const key = JSON.stringify(value);
        if (!snapshotIndex.has(key)) { snapshotIndex.set(key, snapshots.length); snapshots.push(value); }
        return snapshotIndex.get(key);
    };
    const initial = snapshot(record.initial);
    const turns = record.turns.map(turn => [snapshot(turn.actionStart), snapshot(turn.action.before), groups(turn.action.placed),
        Object.entries(turn.action.cardEffects).map(([slot, info]) => [slot, info.cards.map(card => [vector(card.beforeStats), vector(card.afterStats),
            ...(Object.hasOwn(card, 'skippedReason') ? [card.skippedReason] : [])])]),
        turn.action.eventEffects.map(effect => [effect.itemId, vector(effect.beforeStats), vector(effect.afterStats)]),
        snapshot(turn.action.after), snapshot(turn.meetingStart), snapshot(turn.meeting.after), turn.meeting.deleted.map(event => index.get(event.card.instanceId))]);
    const result = [record.result.score, record.result.finalDeck.map(card => [index.get(card.instanceId), ...difference(record.instances[card.instanceId], card)]), snapshot(record.result.state)];
    // 再生は確定済みの各時点とカード効果を使う。乱数の途中状態や重複した診断ログは持ち出さない
    return [record.metadata, [definitions, record.definitions.eventItems || []], ids, encodedInstances, snapshots, initial, turns, result];
}

export function expandReplay(packet, maxBytes) {
    const malformed = () => { throw new Error('短縮リプレイの形式が正しくありません'); };
    const array = (value, length) => { if (!Array.isArray(value) || length !== undefined && value.length !== length) malformed(); return value; };
    array(packet, 8);
    const [metadata, definitions, ids, encodedInstances, snapshots, initialIndex, turns, result] = packet;
    if (!object(metadata) || !Number.isInteger(metadata.totalTurns) || metadata.totalTurns < 1 || metadata.totalTurns > 64) malformed();
    array(definitions, 2); const [cards, eventItems] = definitions;
    array(cards); array(eventItems); array(ids); array(encodedInstances, ids.length); array(snapshots); array(turns, metadata.totalTurns); array(result, 3);
    if (!ids.every(id => typeof id === 'string') || new Set(ids).size !== ids.length || !cards.every(object)) malformed();
    const encoder = new TextEncoder(); let remaining = maxBytes;
    const size = value => encoder.encode(JSON.stringify(value)).byteLength;
    const charge = bytes => { remaining -= bytes; if (remaining < 0) throw new RangeError('リプレイデータが大きすぎます'); };
    const reference = (values, index) => { if (!Number.isInteger(index) || index < 0 || index >= values.length) malformed(); return values[index]; };
    charge(size(metadata) + size(definitions) + size(result[0]));
    const idBytes = ids.map(size);
    const readId = index => { const id = reference(ids, index); charge(idBytes[index] + 1); return id; };
    const readList = value => array(value).map(readId);
    const readGroups = value => Object.fromEntries(array(value).map(pair => {
        array(pair, 2); if (typeof pair[0] !== 'string') malformed(); charge(size(pair[0]) + 4);
        return [pair[0], readList(pair[1])];
    }));
    const readStats = value => { array(value, 4); if (!value.every(Number.isFinite)) malformed(); charge(80); return Object.fromEntries(STATS.map((key, index) => [key, value[index]])); };
    const applyDifference = (base, encoded) => {
        array(encoded, 3); if (!object(encoded[1]) || !array(encoded[2]).every(key => typeof key === 'string')) malformed();
        const value = { ...base, ...encoded[1] };
        for (const key of encoded[2]) delete value[key];
        charge(size(value)); return value;
    };
    const decodedInstances = encodedInstances.map(encoded => {
        array(encoded, 3);
        const base = encoded[0] === -1 ? {} : reference(cards, encoded[0]);
        return applyDifference(base, encoded);
    });
    const instances = Object.fromEntries(ids.map((id, index) => { charge(idBytes[index] + 4); return [id, decodedInstances[index]]; }));
    const readSnapshot = index => {
        const value = reference(snapshots, index); array(value, 9);
        if (!object(value[7]) || value[8] !== null && !object(value[8])) malformed();
        charge(100 + size(value[0]) + size(value[1]) + size(value[7]) + size(value[8]));
        return { turn: value[0], phase: value[1], player: { ...readStats(value[2]), deck: readList(value[3]), hand: readList(value[4]),
            placed: readGroups(value[5]), zones: readGroups(value[6]) }, tokens: value[7], event: value[8] };
    };
    const decodedTurns = turns.map((turn, index) => {
        array(turn, 9);
        const cardEffects = Object.fromEntries(array(turn[3]).map(pair => {
            array(pair, 2); if (typeof pair[0] !== 'string') malformed();
            return [pair[0], { cards: array(pair[1]).map(card => { array(card); if (card.length < 2 || card.length > 3) malformed(); return {
                beforeStats: readStats(card[0]), afterStats: readStats(card[1]), ...(card.length === 3 ? { skippedReason: card[2] } : {}) }; }) }];
        }));
        return { turn: index, completed: true, training: [],
            actionStart: readSnapshot(turn[0]), action: { before: readSnapshot(turn[1]), placed: readGroups(turn[2]), cardEffects,
                eventEffects: array(turn[4]).map(effect => { array(effect, 3); return { itemId: effect[0], beforeStats: readStats(effect[1]), afterStats: readStats(effect[2]) }; }), after: readSnapshot(turn[5]) },
            ...(turn[6] === null ? {} : { meetingStart: readSnapshot(turn[6]) }),
            meeting: { after: readSnapshot(turn[7]), skipped: turn[6] === null,
                deleted: array(turn[8]).map(index => ({ type: 'delete', card: { instanceId: readId(index) } })) } };
    });
    const decoded = { schema: 1, complete: true, profile: 'battle-timeline', metadata,
        definitions: { cards, ranks: [], eventItems }, instances, initial: readSnapshot(initialIndex), turns: decodedTurns,
        result: { score: result[0], finalDeck: array(result[1]).map(encoded => { array(encoded, 3); return applyDifference(reference(decodedInstances, encoded[0]), encoded); }), state: readSnapshot(result[2]) } };
    if (size(decoded) > maxBytes) throw new RangeError('リプレイデータが大きすぎます');
    return decoded;
}
