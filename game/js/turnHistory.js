export const HISTORY_TYPES = new Set(['acquire', 'place', 'unplace', 'delete']);

/** 評価ログの3000件上限とは別に、送信する操作履歴を保持する。 */
export function toHistoryEvent(event) {
    const { card = {} } = event;
    return { turn: event.turn, phase: event.phase, type: event.type,
        card: { cardNo: card.cardNo, cardName: card.cardName, instanceId: card.instanceId },
        ...(event.staff ? { staff: event.staff } : {}) };
}

export function snapshotTurnHistory(state) {
    return structuredClone(state.turnHistory ?? (state.playRecord?.events || [])
        .filter(event => HISTORY_TYPES.has(event.type)).map(toHistoryEvent));
}
