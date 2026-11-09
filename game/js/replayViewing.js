import { validateBattleReplay, snapshotCards, BATTLE_STATS } from './battleReplay.js?v=20261110-0065';

export function replayCard(record, reference) {
    if (typeof reference === 'string') {
        if (!Object.hasOwn(record.instances, reference)) throw new Error('視聴用のカード情報が不足しています');
        return structuredClone(record.instances[reference]);
    }
    if (!reference || typeof reference.definitionId !== 'string') throw new Error('視聴用の候補情報が不正です');
    const definition = record.definitions.cards.find(card => card.definitionId === reference.definitionId);
    if (!definition) throw new Error('視聴用のカード定義がありません');
    return { ...structuredClone(definition), ...structuredClone(reference) };
}

function trainingScene(record, turn, choice, index) {
    const before = choice?.before;
    if (!before?.player || BATTLE_STATS.some(key => !Number.isFinite(before.player[key])) ||
        !Array.isArray(before.currentTrainingCards) || !Array.isArray(choice.selectedIndices) ||
        !['initial', 'main', 'inspiration', 'event'].includes(choice.phaseTag) ||
        !Number.isInteger(choice.pickCount) || choice.pickCount < 1 || choice.pickCount > before.currentTrainingCards.length ||
        choice.selectedIndices.length > choice.pickCount || !choice.allowSkip && !choice.selectedIndices.length ||
        choice.selectedIndices.some(i => !Number.isInteger(i) || i < 0 || i >= before.currentTrainingCards.length) ||
        new Set(choice.selectedIndices).size !== choice.selectedIndices.length ||
        typeof choice.allowSkip !== 'boolean' || typeof choice.allowRefresh !== 'boolean') {
        throw new Error('視聴に必要な取得記録が不足しています');
    }
    const cards = before.currentTrainingCards.map(ref => replayCard(record, ref));
    return { key: `${turn.turn}:training:${index}`, turn: turn.turn, kind: 'training',
        label: choice.phaseTag === 'event' ? 'イベント研修' : choice.phaseTag === 'inspiration' ? '発想研修' : '取得',
        before: structuredClone(before), stats: structuredClone(before.player), cards,
        selectedIndices: [...choice.selectedIndices], rarity: choice.rarity, pickCount: choice.pickCount,
        phaseTag: choice.phaseTag, allowSkip: choice.allowSkip, allowRefresh: choice.allowRefresh };
}

export function sceneAnalysisSource(record, scene) {
    const metadata = record.metadata;
    return { difficulty: metadata.difficulty, seed: metadata.seed, runId: metadata.runId, calcMode: metadata.calcMode,
        cardVersion: metadata.cardVersion, rankVersion: metadata.rankVersion,
        cards: structuredClone(record.definitions.cards), ranks: structuredClone(record.definitions.ranks),
        instances: Object.fromEntries([...new Set(snapshotCards(scene.before))].map(id => [id, replayCard(record, id)])) };
}

export function sceneAnalysisInput(scene) {
    const keys = ['key', 'turn', 'kind', 'before', 'cards', 'rarity', 'pickCount', 'phaseTag', 'allowSkip', 'allowRefresh', 'skipped'];
    return Object.fromEntries(keys.filter(key => Object.hasOwn(scene, key)).map(key => [key, structuredClone(scene[key])]));
}

export function replayScenes(record) {
    validateBattleReplay(record);
    if (record.viewingVersion !== 1 || record.turns.some(turn => !Array.isArray(turn.choices) || !turn.choices.length)) {
        throw new Error('このリプレイには視聴に必要な取得記録がありません');
    }
    const scenes = [];
    for (const turn of record.turns) {
        turn.choices.forEach((choice, index) => scenes.push(trainingScene(record, turn, choice, index)));
        const before = structuredClone(turn.actionStart);
        if (record.metadata.calcMode) {
            before.player.hand = [...new Set(snapshotCards(before))]; before.player.deck = [];
            before.player.placed = Object.fromEntries(Object.keys(before.player.placed).map(slot => [slot, []]));
            before.player.zones = Object.fromEntries(Object.keys(before.player.zones || {}).map(zone => [zone, []]));
        }
        scenes.push({ key: `${turn.turn}:action`, turn: turn.turn, kind: 'action', label: '配置', before,
            stats: structuredClone(turn.action.after.player), cards: before.player.hand.map(id => replayCard(record, id)),
            placements: structuredClone(turn.action.placed), selectedIds: Object.values(turn.action.placed).flat() });
        const meeting = turn.meetingStart || turn.action.after;
        scenes.push({ key: `${turn.turn}:meeting`, turn: turn.turn, kind: 'meeting', label: '削除', before: structuredClone(meeting),
            stats: structuredClone(meeting.player), cards: snapshotCards(meeting).map(id => replayCard(record, id)),
            selectedIds: turn.meeting.deleted.map(event => event.card.instanceId), skipped: turn.meeting.skipped });
    }
    return scenes;
}
