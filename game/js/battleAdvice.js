import { createAdvisorObservation } from './acquisitionAdvisor.js?v=20261110-0066';
import { recommendFreshStatus } from './ahiruFreshAdvice.js?v=20261110-0066';
import { recommendProStatus } from './ahiruProAdvice.js?v=20261110-0066';
import { snapshotCards } from './battleReplay.js?v=20261110-0066';
import { projectFreshAdviceState } from './ahiruFreshForecast.js?v=20261110-0066';
import { projectProAdviceState } from './ahiruProForecast.js?v=20261110-0066';
import { getFreshSGoals } from './ahiruFreshGoals.js?v=20261110-0066';
import { getProSGoals } from './ahiruProGoals.js?v=20261110-0066';
import { createAhiruRoleInspector } from './ahiruCardRoles.js?v=20261110-0066';

const AXES = ['experience', 'enrollment', 'satisfaction', 'accounting'];
const LABELS = { experience: '体験', enrollment: '入塾', satisfaction: '満足', accounting: '経理' };

function observationFromSnapshot(record, snapshot, turnIndex, candidates = []) {
    const owned = snapshotCards(snapshot).map(id => record.instances[id]);
    if (owned.some(card => !card)) return null;
    const state = {
        difficulty: record.metadata.difficulty, turn: turnIndex, totalTurns: record.metadata.totalTurns,
        config: { turns: record.definitions.turns }, event: snapshot.event, tokens: snapshot.tokens,
        player: { ...snapshot.player, deck: owned, hand: [], placed: {}, zones: {} }
    };
    return createAdvisorObservation(state, candidates, {
        pickCount: Math.max(1, candidates.length), allowSkip: false, rankTable: record.definitions.ranks
    });
}

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
    if (selected.some(card => !card)) return fallback;
    // 取得前の所有札と当ターンの取得予定だけを評価し、未解決配置や実際の将来結果は渡さない
    const observation = observationFromSnapshot(record, before, turnIndex, selected);
    if (!observation) return fallback;
    const recommend = observation.difficulty === 'pro' ? recommendProStatus : recommendFreshStatus;
    const status = recommend(observation, { phase: 'acquisition', catalog, refreshEnabled: false });
    if (!status) return fallback;
    const text = status.text.replace(/手に入れよう$/, '手に入れるね').replace(/選ぼう$/, '選ぶね')
        .replace(/進もう$/, '進むね').replace(/見よう$/, '見るね');
    return { tone: status.tone, text };
}

export function cpuMeetingAdvice(record, turnIndex) {
    const turn = record.turns[turnIndex];
    const observation = turn?.meetingStart && observationFromSnapshot(record, turn.meetingStart, turnIndex);
    if (!observation) return { tone: 'yellow', text: '次の行動に向けてデッキを整えるね' };
    if (turnIndex + 1 >= record.metadata.totalTurns) return { tone: 'green', text: 'これで教室運営は完了だよ' };
    const indices = [];
    // 観測用デッキは個体IDを除いて並べ替えられるため、効果と取得ターンを照合する
    for (const event of turn.meeting?.deleted || []) {
        const card = record.instances[event.card?.instanceId];
        const index = card && observation.owned.findIndex((owned, index) => !indices.includes(index) &&
            String(owned.cardNo) === String(card.cardNo) && owned.effect === card.effect && owned.acquiredTurn === card.acquiredTurn);
        if (Number.isInteger(index) && index >= 0) indices.push(index);
    }
    const project = observation.difficulty === 'pro' ? projectProAdviceState : projectFreshAdviceState;
    const goals = (observation.difficulty === 'pro' ? getProSGoals : getFreshSGoals)(observation.rankTable);
    if (!goals) return { tone: 'yellow', text: '次の行動に向けてデッキを整えるね' };
    const options = { phase: 'deletion', deleteMax: indices.length };
    // 実際の削除方針を説明する。投影には会議開始時点の所有札だけを使い、将来の取得や結果を読まない
    const before = project(observation, options);
    const after = indices.length ? project(observation, { ...options, selectedIndices: indices }) : before;
    const shortage = ['satisfaction', 'accounting'].find(axis => after.expectedEnd[axis] < goals.sThresholds[axis]);
    if (!indices.length) return { tone: shortage ? 'red' : 'yellow', text: shortage
        ? `${LABELS[shortage]}を補う札は残して、次に備えるね` : 'まだ働けるカードが多いから、今回は残すね' };
    const removed = indices.map(index => observation.owned[index]);
    const categories = [...new Set(removed.map(card => card.category))];
    const target = categories.length === 1 ? `${categories[0]}を${indices.length}枚` : `カードを${indices.length}枚`;
    const roles = createAhiruRoleInspector(before.observation, before.expectedEnd);
    const enough = AXES.filter(axis => after.expectedEnd[axis] >= goals.caps[axis] &&
        removed.some(card => roles.canRecover(card, axis, goals.caps[axis])))
        .sort((a, b) => after.expectedEnd[b] / goals.caps[b] - after.expectedEnd[a] / goals.caps[a])[0];
    if (enough) return { tone: 'yellow', text: `${LABELS[enough]}は足りそう。${target}減らすね` };
    const gain = AXES.filter(axis => after.expectedEnd[axis] > before.expectedEnd[axis] + .01)
        .sort((a, b) => after.expectedEnd[b] - before.expectedEnd[b] - (after.expectedEnd[a] - before.expectedEnd[a]))[0];
    if (gain) return { tone: shortage ? 'red' : 'yellow', text: `${target}減らして、${LABELS[gain]}を伸ばすね` };
    return { tone: shortage ? 'red' : 'yellow', text: `${target}減らして、手札の回転を上げるね` };
}
