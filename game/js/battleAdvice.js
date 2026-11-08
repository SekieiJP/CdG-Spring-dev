import { createAdvisorObservation } from './acquisitionAdvisor.js?v=20261107-0063';
import { recommendFreshStatus } from './ahiruFreshAdvice.js?v=20261107-0063';
import { recommendProStatus } from './ahiruProAdvice.js?v=20261107-0063';
import { snapshotCards } from './battleReplay.js?v=20261107-0063';

export function cpuTrainingAdvice(record, turnIndex) {
    const fallback = { tone: 'yellow', text: '使えるカードを選んで進むね' };
    const training = record.turns[turnIndex]?.training || [];
    const choiceIndex = training.findIndex(boundary => boundary.kind === 'training-choice');
    const choice = training[choiceIndex];
    const before = training.slice(0, choiceIndex).findLast(boundary => boundary.kind === 'training-offer')?.state;
    if (!before || !Array.isArray(choice?.selected)) return fallback;
    if (!choice.selected.length) return { tone: 'yellow', text: '今回は取得せずに進むね' };
    const catalog = record.definitions.cards;
    const selected = choice.selected.map(cardNo => catalog.find(card => String(card.cardNo) === String(cardNo)));
    const owned = snapshotCards(before).map(id => record.instances[id]);
    if (selected.some(card => !card) || owned.some(card => !card)) return fallback;
    // 取得前の所有札と当ターンの取得予定だけを評価し、未解決配置や実際の将来結果は渡さない
    const state = {
        difficulty: record.metadata.difficulty, turn: turnIndex, totalTurns: record.metadata.totalTurns,
        config: { turns: record.definitions.turns }, event: before.event, tokens: before.tokens,
        player: { ...before.player, deck: owned, hand: [], placed: {}, zones: {} }
    };
    const observation = createAdvisorObservation(state, selected, {
        pickCount: selected.length, allowSkip: false, rankTable: record.definitions.ranks
    });
    const recommend = state.difficulty === 'pro' ? recommendProStatus : recommendFreshStatus;
    const status = recommend(observation, { phase: 'acquisition', catalog, refreshEnabled: false });
    if (!status) return fallback;
    const text = status.text.replace(/手に入れよう$/, '手に入れるね').replace(/選ぼう$/, '選ぶね')
        .replace(/進もう$/, '進むね').replace(/見よう$/, '見るね');
    return { tone: status.tone, text };
}
