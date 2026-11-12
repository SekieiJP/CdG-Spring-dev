import { validateReplayRecord } from './replayCodec.js?v=20261110-0066';
import { getDifficultyConfig } from './difficultyConfig.js?v=20261110-0066';

export const BATTLE_STATS = ['experience', 'enrollment', 'satisfaction', 'accounting'];

export function validateBattleReplay(record) {
    validateReplayRecord(record);
    if (!['fresh', 'pro'].includes(record.metadata.difficulty) ||
        record.metadata.totalTurns !== getDifficultyConfig(record.metadata.difficulty).turns.length ||
        !record.instances || !Array.isArray(record.definitions?.cards) || !Array.isArray(record.definitions?.ranks)) {
        throw new Error('対戦に必要なカード・ランク情報がありません');
    }
    const validCard = card => card && ['cardName', 'rarity', 'category', 'effect'].every(key => typeof card[key] === 'string');
    if (Object.values(record.instances).some(card => !validCard(card)) ||
        record.result.finalDeck.some(card => !validCard(card)) ||
        record.definitions.eventItems != null && !Array.isArray(record.definitions.eventItems)) {
        throw new Error('リプレイのカード情報が不正です');
    }
    const check = snapshot => {
        if (!snapshot?.player || BATTLE_STATS.some(key => !Number.isFinite(snapshot.player[key]) || snapshot.player[key] < 0)) {
            throw new Error('リプレイのステータスが不正です');
        }
        const player = snapshot.player;
        if (!Array.isArray(player.deck) || !Array.isArray(player.hand) || !player.placed ||
            Object.values(player.placed).some(cards => !Array.isArray(cards)) || Object.values(player.zones || {}).some(cards => !Array.isArray(cards))) {
            throw new Error('リプレイのカード所在が不正です');
        }
        for (const id of snapshotCards(snapshot)) {
            if (typeof id !== 'string' || !record.instances[id]?.cardName) throw new Error('リプレイのカード情報が不足しています');
        }
    };
    check(record.initial);
    for (const turn of record.turns) {
        check(turn.actionStart); check(turn.action.before); check(turn.action.after); check(turn.meeting.after);
        for (const [slot, ids] of Object.entries(turn.action.placed)) {
            if (!Array.isArray(ids) || ids.some(id => !record.instances[id]?.cardName) ||
                ids.length !== (turn.action.cardEffects[slot]?.cards.length || 0)) throw new Error('リプレイの配置情報が不足しています');
        }
        for (const info of Object.values(turn.action.cardEffects)) {
            if (!Array.isArray(info.cards)) throw new Error('カード演出の情報が不足しています');
            for (const card of info.cards) for (const stats of [card.beforeStats, card.afterStats]) {
                if (BATTLE_STATS.some(key => !Number.isFinite(stats?.[key]))) throw new Error('カード演出の数値が不正です');
            }
        }
        for (const effect of turn.action.eventEffects) {
            for (const stats of [effect.beforeStats, effect.afterStats]) {
                if (BATTLE_STATS.some(key => !Number.isFinite(stats?.[key]))) throw new Error('塾アイテム演出の数値が不正です');
            }
        }
    }
    check(record.result.state);
    const score = record.result.score;
    if (['displayScore', 'withdrawal', 'mobilization', 'enrollmentDiff', ...BATTLE_STATS].some(key => !Number.isFinite(score[key])) ||
        typeof score.rank?.grade !== 'string' || typeof score.rank?.name !== 'string' ||
        ['mobilizationPoints', 'withdrawalPoints', 'enrollmentDiffPoints', ...(record.metadata.difficulty === 'pro' ? ['satisfactionPoints'] : [])].some(key => !Number.isFinite(score.breakdown?.[key])) ||
        score.splusBreakdown != null && ['expBonus', 'diffBonus'].some(key => !Number.isFinite(score.splusBreakdown[key])) ||
        score.overflow != null && ['experience', 'enrollmentDiff', 'satisfaction'].some(key => !Number.isFinite(score.overflow[key]))) {
        throw new Error('リプレイの最終評価が不足しています');
    }
    return record;
}

export function snapshotCards(snapshot) {
    const player = snapshot.player;
    return [...(player.deck || []), ...(player.hand || []), ...Object.values(player.placed || {}).flat(),
        ...Object.values(player.zones || {}).flat()];
}

export function opponentSnapshot(battle, turn, phase) {
    const record = battle.opponent;
    if (phase === 'end' || turn >= record.turns.length) return record.result.state;
    const current = record.turns[turn];
    if (phase === 'meeting') return current.meetingStart || current.action.after;
    if (battle.animation?.turn === turn && battle.animation.done) return current.action.after;
    return current.actionStart;
}

export function opponentDeck(battle, turn, phase) {
    const snapshot = opponentSnapshot(battle, turn, phase);
    return snapshotCards(snapshot).map(id => structuredClone(battle.opponent.instances[id]));
}

export function opponentFrames(record, turnIndex) {
    const turn = record.turns[turnIndex];
    const frames = [];
    for (const [slot, ids] of Object.entries(turn.action.placed)) {
        const effects = turn.action.cardEffects[slot]?.cards || [];
        ids.forEach((id, index) => {
            const effect = effects[index];
            if (effect) frames.push({ type: 'card', slot, card: record.instances[id],
                before: effect.beforeStats, after: effect.afterStats, skipped: effect.skippedReason });
        });
    }
    for (const effect of turn.action.eventEffects) {
        const item = record.definitions.eventItems?.find(item => item.itemId === effect.itemId || item.id === effect.itemId);
        frames.push({ type: 'event', card: { cardName: item?.name || '塾アイテム', effect: item?.description || '' },
            before: effect.beforeStats, after: effect.afterStats });
    }
    return frames;
}

export function interimScore(scoreManager, state, stats, turn = state.turn) {
    const x = Math.min(15, Math.max(1, 2 * (turn + 1) - 1));
    const manager = Object.assign(Object.create(scoreManager), { logger: null });
    manager.calculateWithdrawal = () => Math.max(x - stats.satisfaction, 0) + Math.max(x - stats.accounting, 0);
    return manager.calculateScore({ difficulty: state.difficulty, player: { ...stats }, event: state.event });
}

export function compareBattleScores(player, opponent) {
    const values = score => [score.displayScore, score.enrollmentDiff, -score.withdrawal,
        score.experience, score.satisfaction, score.accounting];
    const left = values(player), right = values(opponent);
    for (let index = 0; index < left.length; index++) {
        if (!Number.isFinite(left[index]) || !Number.isFinite(right[index])) throw new Error('勝敗を判定する得点情報が不足しています');
        if (left[index] !== right[index]) return left[index] > right[index] ? 'win' : 'lose';
    }
    return 'draw';
}

export function battleSummary(state, score) {
    const battle = state.battle;
    if (!battle) return null;
    const result = battle.opponent.result;
    return { kind: battle.kind, opponentName: battle.kind === 'cpu' ? 'あひる先生' : 'リプレイの教室',
        sameSeed: battle.sameSeed, outcome: compareBattleScores(score, result.score),
        opponentScore: structuredClone(result.score),
        opponentFinalDeck: result.finalDeck.map(({ cardNo, cardName, rarity, category }) => ({ cardNo, cardName, rarity, category })) };
}
