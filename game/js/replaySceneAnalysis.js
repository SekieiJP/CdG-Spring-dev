import { createCpuEngine } from './cpuOpponent.js?v=20261110-0065';
import { RandomSource } from './randomSource.js?v=20261110-0065';
import { getDifficultyConfig } from './difficultyConfig.js?v=20261110-0065';
import { cpuTrainingAdvice, cpuMeetingAdvice } from './battleAdvice.js?v=20261110-0065';
import { resolveCpuEventEffects } from './cpuEventRuntime.js?v=20261110-0065';

const STATS = ['experience', 'enrollment', 'satisfaction', 'accounting'];
const LABELS = { experience: '体験', enrollment: '入塾', satisfaction: '満足', accounting: '経理' };

function restoreScene(game, source, scene) {
    const state = game.gameState, before = scene.before;
    if (!before?.randomState || before.randomState.algorithm !== RandomSource.algorithm ||
        STATS.some(key => !Number.isFinite(before.player?.[key]))) throw new Error('判断前の状態を復元できません');
    const instances = source.instances;
    const read = reference => {
        if (typeof reference === 'string') {
            if (!Object.hasOwn(instances, reference)) throw new Error('判断に必要なカードがありません');
            return structuredClone(instances[reference]);
        }
        const definition = source.cards.find(card => card.definitionId === reference?.definitionId);
        if (!definition) throw new Error('判断に必要なカード定義がありません');
        return { ...structuredClone(definition), ...structuredClone(reference) };
    };
    const groups = value => Object.fromEntries(Object.entries(value || {}).map(([key, refs]) => [key, refs.map(read)]));
    state.turn = scene.turn; state.phase = scene.kind === 'action' ? 'action' : scene.kind === 'meeting' ? 'meeting' : 'training';
    state.player = { ...structuredClone(before.player), deck: before.player.deck.map(read), hand: before.player.hand.map(read),
        placed: groups(before.player.placed), zones: groups(before.player.zones) };
    state.runId = source.runId; state.nextInstanceId = before.nextInstanceId || 1;
    state.tokens = structuredClone(before.tokens || {}); state.ruleState = structuredClone(before.ruleState || {});
    state.event = structuredClone(before.event || null); state.eventCardUsage = structuredClone(before.eventCardUsage || {});
    state.discardedCards = [...(before.discardedCards || [])]; state.calcMode = !!source.calcMode;
    state.rng = RandomSource.restore(before.randomState);
    state.currentTrainingCards = (before.currentTrainingCards || []).map(read);
    state.trainingSelectionMode = before.trainingSelectionMode || 'normal';
    state.trainingRefreshRemaining = before.trainingRefreshRemaining ?? 0;
    state.trainingRefreshPhaseStartRemaining = before.trainingRefreshPhaseStartRemaining ?? state.trainingRefreshRemaining;
    state.replayRecord = null; state.pendingAction = null;
    state.playRecord = { schema: 1, metadata: { difficulty: source.difficulty, seed: source.seed },
        events: structuredClone(before.offerHistory || []) };
    if (before.trainingPool) {
        game.cardManager.trainingDecks = groups(before.trainingPool.decks);
        game.cardManager.trainingDiscards = groups(before.trainingPool.discards);
    } else if (scene.kind === 'training') throw new Error('研修の判断に必要な候補デッキがありません');
}

function adviceRecord(source, scene, selection) {
    const turns = [];
    turns[scene.turn] = { training: [{ kind: 'training-offer', state: scene.before },
        { kind: 'training-choice', selected: selection.map(card => card.cardNo) }],
        meetingStart: scene.before, meeting: { deleted: selection.map(card => ({ card: { instanceId: card.instanceId } })) } };
    return { metadata: { difficulty: source.difficulty, totalTurns: getDifficultyConfig(source.difficulty).turns.length },
        definitions: { cards: source.cards, ranks: source.ranks, turns: getDifficultyConfig(source.difficulty).turns },
        instances: source.instances, turns };
}

export async function analyzeReplayScene(source, scene) {
    const { game, policy } = await createCpuEngine({ difficulty: source.difficulty, seed: source.seed,
        resources: { cards: source.cards, ranks: source.ranks, cardVersion: source.cardVersion, rankVersion: source.rankVersion } });
    restoreScene(game, source, scene);
    const state = game.gameState;
    if (scene.kind === 'training') {
        if (!scene.allowRefresh) state.trainingRefreshRemaining = 0;
        const remaining = state.trainingRefreshRemaining;
        const choose = (candidates, pickCount) => policy.training({ rarity: scene.rarity, candidates,
            drawCount: candidates.length, pickCount, phaseTag: scene.phaseTag, allowSkip: scene.allowSkip });
        let decision;
        const batchInspiration = source.calcMode && scene.phaseTag === 'inspiration' && scene.pickCount > 1;
        if (batchInspiration) {
            const selected = [], used = new Set();
            // 計算機の一括入力も、固定CPUと同じ1枚ずつの発想研修として判断する
            for (let round = 0; round < scene.pickCount; round++) {
                const seen = new Set(), candidates = state.currentTrainingCards.filter(card => {
                    if (used.has(card.poolId) || seen.has(card.cardNo)) return false;
                    seen.add(card.cardNo); return true;
                });
                const choice = choose(candidates, 1);
                for (const card of choice.selected) {
                    selected.push(card); used.add(card.poolId); state.addToDeck({ ...card });
                }
                state.tokens.inspiration = Math.max(0, state.tokens.inspiration - 1);
            }
            decision = { selected };
        } else decision = choose(state.currentTrainingCards, scene.pickCount);
        if (state.trainingRefreshRemaining < remaining) return { kind: 'training', selectedIndices: [], refresh: true,
            reason: 'この候補は選ばず、リフレッシュで更新するよ。今のデッキと候補を比べて、残りの更新回数を使う判断だよ。' };
        const used = new Set();
        const selectedIndices = decision.selected.map(card => {
            const index = scene.cards.findIndex((candidate, i) => !used.has(i) && (candidate.poolId && candidate.poolId === card.poolId ||
                String(candidate.cardNo) === String(card.cardNo) && !card.poolId));
            if (index < 0) throw new Error('CPUの選択を候補へ対応させられません');
            used.add(index); return index;
        });
        const reason = batchInspiration && decision.selected.length
            ? decision.selected.map(card => cpuTrainingAdvice(adviceRecord(source, scene, [card]), scene.turn).text).join('\n')
            : cpuTrainingAdvice(adviceRecord(source, scene, decision.selected), scene.turn).text;
        return { kind: 'training', selectedIndices, refresh: false, reason };
    }
    if (scene.kind === 'action') {
        policy.place();
        const placements = Object.fromEntries(Object.entries(state.player.placed).map(([slot, cards]) => [slot, cards.map(card => card.instanceId)]));
        const before = Object.fromEntries(STATS.map(key => [key, state.player[key]]));
        game.turnManager.executeActions(); resolveCpuEventEffects(state);
        const deltas = STATS.map(key => [key, state.player[key] - before[key]]).filter(([, value]) => value !== 0);
        const shortage = ['satisfaction', 'accounting'].filter(key => before[key] < 15 && state.player[key] > before[key]);
        const lead = shortage.length ? `${shortage.map(key => LABELS[key]).join('と')}の不足を補う配置を選ぶよ。` : '持っている札と残りターンを見て、この組み合わせを選ぶよ。';
        const changes = deltas.map(([key, value]) => `${LABELS[key]}${value > 0 ? '+' : ''}${value}`).join('、');
        return { kind: 'action', placements, selectedIds: Object.values(placements).flat(),
            reason: `${lead}${changes ? `この配置では${changes}を見込むよ。` : '今回はステータスの変化を見込まない配置だよ。'}` };
    }
    if (scene.kind === 'meeting') {
        if (scene.skipped) return { kind: 'meeting', selectedIds: [], reason: 'このターンは教室会議がないので、カードを削除しないよ。' };
        const owned = state.getOwnedCards(); policy.delete();
        const remaining = new Set(state.getOwnedCards().map(card => card.instanceId));
        const removed = owned.filter(card => !remaining.has(card.instanceId));
        return { kind: 'meeting', selectedIds: removed.map(card => card.instanceId),
            reason: cpuMeetingAdvice(adviceRecord(source, scene, removed), scene.turn).text };
    }
    throw new Error('視聴する場面の種類が不正です');
}
