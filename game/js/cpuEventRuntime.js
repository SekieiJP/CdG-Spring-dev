import { getEventItem, getOwnedCardCount, recordItemConditionMetTurn } from './eventManager.js?v=20261110-0065';
import { captureReplayEventEffect } from './replayRecorder.js?v=20261110-0065';

export function prepareCpuEventTurn({ gameState: state, cardManager }) {
    const event = state.event;
    if (!event?.enabled) return null;
    event.preparing = true; event.preparedTurn = state.turn;
    for (const [id, item] of Object.entries(event.items)) {
        item.usageThisTurn = 0; item.triggerCountThisTurn = 0;
        const due = state.turn === 0 && ['press-coverage', 'idea-chemistry'].includes(id) || state.turn === 4 && id === 'spring-homework';
        if (due && !item.acquired) { item.acquired = true; item.acquiredTurn = state.turn; }
    }
    const idea = event.items['idea-chemistry'];
    if (idea?.acquired && idea.usageTotal < 1 && !event.eventTraining && getOwnedCardCount(state) >= 10) {
        recordItemConditionMetTurn(idea, state.turn);
        if (state.calcMode) event.eventTraining = { itemId: 'idea-chemistry', calc: true };
        else {
            const cards = cardManager.drawTrainingCards('SSR', 3);
            if (new Set(cards.map(card => card.cardName)).size === 3) {
                event.eventTraining = { itemId: 'idea-chemistry', cards: cards.map(card => ({ ...card })), selectedCardName: null };
            }
        }
    }
    event.preparing = false;
    return event.eventTraining?.cards || null;
}

export function finishCpuEventTraining(state) {
    const item = state.event.items['idea-chemistry'];
    item.usageTotal++; item.usageThisTurn++;
    state.event.eventTraining = null; state.currentTrainingCards = null;
}

export function resolveCpuEventEffects(state) {
    if (!state.event?.enabled) return;
    state.event.actionCompletion = { turn: state.turn, status: 'resolving' };
    const { items } = state.event, usage = state.eventCardUsage || {};
    const apply = (id, item, reservation = null) => {
        const beforeStats = Object.fromEntries(['experience', 'enrollment', 'satisfaction', 'accounting'].map(key => [key, state.player[key]]));
        const definition = getEventItem(id);
        item.usageTotal++; item.usageThisTurn++;
        const actual = state.updateStatus(definition.effect.status, definition.effect.amount);
        if (reservation) reservation.effectApplied = true;
        const afterStats = Object.fromEntries(Object.keys(beforeStats).map(key => [key, state.player[key]]));
        captureReplayEventEffect(state, { itemId: id, reservationId: reservation?.reservationId, beforeStats, afterStats, actual, usageTotal: item.usageTotal });
        state.event.presentation = null;
    };
    const press = items['press-coverage'];
    if (press?.acquired && press.triggerCountThisTurn < 1 && (usage['動員'] || 0) >= 3) {
        press.triggerCountThisTurn++; recordItemConditionMetTurn(press, state.turn);
        apply('press-coverage', press);
    }
    const homework = items['spring-homework'];
    if (homework?.acquired && homework.triggerCountThisTurn < 1 && (usage['教務'] || 0) >= 3) {
        homework.triggerCountThisTurn++; recordItemConditionMetTurn(homework, state.turn);
        homework.activationReservations.push({ reservationId: `spring-homework-${state.turn}-${homework.activationReservations.length}`,
            conditionTurn: state.turn, creationOrder: homework.activationReservations.length, activationTiming: 'final-action-end', status: 'pending' });
    }
    if (state.turn === state.totalTurns - 1 && homework?.acquired) {
        for (const reservation of homework.activationReservations.filter(row => row.status === 'pending').sort((a, b) => a.creationOrder - b.creationOrder)) {
            reservation.status = 'resolving'; apply('spring-homework', homework, reservation);
            reservation.effectApplied = true; reservation.status = 'resolved'; homework.resolvedActivationCount++;
        }
    }
    state.event.actionCompletion.status = 'ready';
}
