/** 期間限定イベントの定義と、保存可能な実行状態を管理する。 */
export const EVENT_REGISTRY = {
    'summer-cup-2026-post-obon': {
        eventId: 'summer-cup-2026-post-obon',
        name: 'お盆明け、講習の前に講習！26夏期杯',
        // このリリースの公開日。終了は排他的境界。
        startsAt: '2026-08-14T00:00:00+09:00',
        endsAt: '2026-09-24T00:00:00+09:00',
        items: ['press-coverage', 'idea-chemistry', 'spring-homework']
    }
};

export const CURRENT_EVENT_ID = 'summer-cup-2026-post-obon';

export const EVENT_ITEMS = {
    'press-coverage': {
        itemId: 'press-coverage', name: '新聞取材', image: 'data/event-mode/新聞取材.png',
        difficulties: ['fresh', 'pro'], acquisitionTiming: 'ゲーム開始時', judgmentTiming: 'アクションカードの効果解決後', activationTiming: '教室行動フェーズ終了時',
        condition: '動員カテゴリカードを3枚以上使用', effect: { type: 'status', status: 'experience', amount: 2 }, limitType: 'turn', limitCount: 1,
        description: 'アクションカード配置後、このターンに動員カテゴリカードを3枚以上使用している場合、教室行動フェーズ終了時に、体験+2［ターン中1回］'
    },
    'idea-chemistry': {
        itemId: 'idea-chemistry', name: 'アイデアの化学反応', image: 'data/event-mode/アイデアの化学反応.png',
        difficulties: ['fresh', 'pro'], acquisitionTiming: 'ゲーム開始時', judgmentTiming: '各ターン開始後、研修前', activationTiming: '判定直後',
        condition: '所持カード枚数が10枚以上', effect: { type: 'training', rarity: 'SSR', count: 1 }, limitType: 'game', limitCount: 1,
        description: 'ターン開始後、所持カード枚数が10枚以上の場合、ランダムなSSRカード3枚のうち1枚を選択して獲得［ゲーム中1回］'
    },
    'spring-homework': {
        itemId: 'spring-homework', name: '春休みの宿題', image: 'data/event-mode/春休みの宿題.png',
        difficulties: ['fresh', 'pro'], acquisitionTiming: '3月下旬ターン開始時', judgmentTiming: 'アクションカードの効果解決後', activationTiming: '最終ターンの教室行動フェーズ終了時',
        condition: '教務カテゴリカードを3枚以上使用', effect: { type: 'status', status: 'enrollment', amount: 3 }, limitType: 'turn', limitCount: 1,
        description: 'アクションカード配置後、このターンに教務カテゴリカードを3枚以上使用している場合、最終ターンの教室行動フェーズ終了時、入塾+3［ターン中1回］'
    }
};

export function getCurrentEvent(now = new Date()) {
    const event = EVENT_REGISTRY[CURRENT_EVENT_ID];
    if (!event) return null;
    const time = now.getTime();
    return time >= Date.parse(event.startsAt) && time < Date.parse(event.endsAt) ? event : null;
}

export function getEventDefinition(eventId) { return EVENT_REGISTRY[eventId] || null; }
export function getEventItem(itemId) { return EVENT_ITEMS[itemId] || null; }

export function createEventState(event, difficulty) {
    const items = {};
    event.items.forEach((itemId, acquisitionOrder) => {
        const item = EVENT_ITEMS[itemId];
        if (!item || !item.difficulties.includes(difficulty)) return;
        items[itemId] = {
            acquired: false, acquiredTurn: null, acquisitionOrder, usageTotal: 0,
            usageThisTurn: 0, triggerCountThisTurn: 0, conditionState: {},
            activationReservations: [], resolvedActivationCount: 0
        };
    });
    return { enabled: true, eventId: event.eventId, eventName: event.name, items, eventTraining: null, presentation: null };
}

export function isEventActive(gameState) { return !!gameState?.event?.enabled && !!getEventDefinition(gameState.event.eventId); }
export function getItemState(gameState, itemId) { return gameState.event?.items?.[itemId] || null; }
export function getOwnedCardCount(gameState) {
    const placed = Object.values(gameState.player.placed || {}).flatMap(v => Array.isArray(v) ? v : (v ? [v] : []));
    return gameState.player.deck.length + gameState.player.hand.length + placed.length;
}
