const EVENT_TYPES = new Set(['offer', 'refresh', 'acquire', 'draw', 'delete', 'resolve']);
const STATUS_KEYS = ['experience', 'enrollment', 'satisfaction', 'accounting'];

function activeRecord(state) {
    const record = state?.replayRecord;
    return record?.schema === 1 && !record.complete && record.metadata?.runId === state.runId &&
        Array.isArray(record.turns) && Array.isArray(record.definitions?.cards) && record.instances ? record : null;
}

function currentTurn(state) {
    const record = activeRecord(state);
    if (!record || !Number.isInteger(state.turn) || state.turn < 0 || state.turn >= record.metadata.totalTurns) return null;
    if (!record.turns[state.turn]) {
        if (state.turn !== record.turns.length || (state.turn > 0 && !record.turns[state.turn - 1]?.completed)) {
            record.invalid = true;
            return null;
        }
        record.turns.push({ turn: state.turn, training: [], events: [], checkpoints: [], completed: false });
    }
    return record.turns[state.turn];
}

function rememberCard(record, card) {
    const definitionId = card.definitionId || `card:${card.cardNo || `${card.rarity}:${card.cardName}`}`;
    if (!record.definitions.cards.some(item => item.definitionId === definitionId)) {
        record.definitions.cards.push({ ...structuredClone(card), definitionId });
    }
    if (card.instanceId) {
        record.instances[card.instanceId] = structuredClone({ ...card, definitionId });
        return card.instanceId;
    }
    return { definitionId, ...(card.poolId ? { poolId: card.poolId } : {}) };
}

export function snapshotReplayState(state) {
    const record = state.replayRecord;
    state.ensureCardIdentities?.();
    const cards = list => (list || []).map(card => rememberCard(record, card));
    const groups = value => Object.fromEntries(Object.entries(value || {}).map(([key, list]) => [key, cards(list)]));
    return {
        turn: state.turn,
        phase: state.phase,
        player: {
            ...Object.fromEntries(STATUS_KEYS.map(key => [key, state.player[key]])),
            deck: cards(state.player.deck), hand: cards(state.player.hand),
            placed: groups(state.player.placed), zones: groups(state.player.zones)
        },
        tokens: structuredClone(state.tokens || {}),
        ruleState: structuredClone(state.ruleState || {}),
        event: structuredClone(state.event || null),
        eventCardUsage: structuredClone(state.eventCardUsage || {}),
        currentTrainingCards: state.currentTrainingCards ? cards(state.currentTrainingCards) : null,
        trainingSelectionMode: state.trainingSelectionMode || 'normal',
        trainingRefreshRemaining: state.trainingRefreshRemaining ?? 0,
        trainingRefreshPhaseStartRemaining: state.trainingRefreshPhaseStartRemaining ?? 0,
        discardedCards: [...(state.discardedCards || [])],
        randomState: state.rng.snapshot()
    };
}

export function startReplayRecording(state, { cardManager, scoreManager, eventDefinition = null, eventItems = [] } = {}) {
    if (state.turn !== 0 || !['start', 'training'].includes(state.phase)) return false;
    const config = state.config;
    state.replayRecord = {
        schema: 1, complete: false,
        metadata: {
            buildVersion: globalThis.window?.BUILD_VERSION || 'unknown',
            rulesVersion: config.rulesVersion || String(globalThis.window?.BUILD_VERSION || '').slice(1, 9),
            cardVersion: cardManager?.dataVersion || null,
            rankVersion: scoreManager?.dataVersion || null,
            difficulty: state.difficulty, calcMode: !!state.calcMode,
            ...(state.battle ? { battleKind: state.battle.kind, sameSeed: state.battle.sameSeed } : {}),
            eventId: state.event?.enabled ? state.event.eventId : null,
            seed: String(state.rng.seed), totalTurns: state.totalTurns, runId: state.runId,
            startedAt: state.startedAt || null
        },
        definitions: {
            cards: (cardManager?.allCards || []).map(card => ({ ...structuredClone(card),
                definitionId: card.definitionId || `card:${card.cardNo || `${card.rarity}:${card.cardName}`}` })),
            ranks: structuredClone(scoreManager?.rankTable || []),
            event: structuredClone(eventDefinition), eventItems: structuredClone(eventItems),
            turns: structuredClone(config.turns), slots: structuredClone(config.slots),
            scoringModel: config.scoringModel
        },
        instances: {}, initial: null, turns: [], result: null
    };
    state.replayRecord.initial = snapshotReplayState(state);
    currentTurn(state);
    return true;
}

export function recordReplayEvent(state, type, data) {
    if (!EVENT_TYPES.has(type)) return;
    const turn = currentTurn(state);
    if (!turn || turn.completed) return;
    turn.events.push({ sequence: turn.events.length, type, phase: state.phase, ...structuredClone(data) });
}

export function captureReplayBoundary(state, kind, detail = {}) {
    const turn = currentTurn(state);
    if (!turn || turn.completed) return;
    const snapshot = snapshotReplayState(state);
    if (kind === 'action-start') {
        turn.actionStart ||= snapshot;
    } else if (kind === 'meeting-start') {
        turn.meetingStart ||= snapshot;
    }
    const boundary = { kind, ...structuredClone(detail), state: snapshot };
    const list = state.phase === 'training' ? turn.training : turn.checkpoints;
    if (JSON.stringify(list.at(-1)) !== JSON.stringify(boundary)) list.push(boundary);
}

export function beginReplayAction(state) {
    const turn = currentTurn(state);
    if (!turn || turn.completed) return;
    if (turn.action) {
        state.replayRecord.invalid = true;
        return;
    }
    const before = snapshotReplayState(state);
    turn.action = { before, placed: structuredClone(before.player.placed), cardEffects: {}, eventEffects: [], after: null };
}

export function captureReplayAction(state, actionInfo) {
    const turn = currentTurn(state);
    if (!turn?.action) return;
    turn.action.cardEffects = structuredClone(actionInfo.cardEffects);
    turn.action.cardsAfter = snapshotReplayState(state);
}

export function captureReplayEventEffect(state, { itemId, reservationId = null, beforeStats, afterStats, actual, usageTotal }) {
    const turn = currentTurn(state);
    if (!turn?.action) return;
    const key = reservationId || `${itemId}:${state.turn}:${usageTotal}`;
    if (turn.action.eventEffects.some(effect => effect.key === key)) return;
    turn.action.eventEffects.push({ key, itemId, reservationId, beforeStats: structuredClone(beforeStats),
        afterStats: structuredClone(afterStats), actual, state: snapshotReplayState(state) });
}

export function completeReplayAction(state) {
    const turn = currentTurn(state);
    if (!turn?.action || !turn.action.cardsAfter) return;
    if (state.event?.enabled && state.event.actionCompletion?.status !== 'ready') return;
    turn.action.after ||= snapshotReplayState(state);
}

export function completeReplayTurn(state) {
    const turn = currentTurn(state);
    if (!turn || turn.completed) return;
    if (!turn.actionStart || !turn.action?.after) {
        state.replayRecord.invalid = true;
        return;
    }
    turn.meeting = { after: snapshotReplayState(state),
        deleted: structuredClone(turn.events.filter(event => event.type === 'delete')),
        skipped: !turn.meetingStart };
    turn.completed = true;
}

function hasCompleteTurns(record) {
    return record?.schema === 1 && !record.invalid && record.initial?.turn === 0 &&
        Number.isInteger(record.metadata?.totalTurns) && record.metadata.totalTurns > 0 &&
        Array.isArray(record.turns) && record.turns.length === record.metadata.totalTurns &&
        Array.from(record.turns).every((turn, index) => turn?.turn === index && turn.completed === true &&
            turn.actionStart?.player && turn.action?.before?.player && turn.action.placed &&
            turn.action.cardEffects && Array.isArray(turn.action.eventEffects) && turn.action.cardsAfter?.player &&
            turn.action.after?.player && turn.meeting?.after?.player);
}

export function finalizeReplayRecording(state, score, finalDeck) {
    const record = state.replayRecord;
    if (!record || record.metadata?.runId !== state.runId || state.phase !== 'end' ||
        state.turn !== state.totalTurns || !hasCompleteTurns(record)) return null;
    if (!record.complete) {
        record.result = { score: structuredClone(score), finalDeck: structuredClone(finalDeck), state: snapshotReplayState(state) };
        record.complete = true;
    }
    return getCompletedReplay(state);
}

export function getCompletedReplay(state) {
    const record = state?.replayRecord;
    if (!record?.complete || record.metadata?.runId !== state.runId || !hasCompleteTurns(record) ||
        !record.result?.score || !Array.isArray(record.result.finalDeck) || record.result.state?.phase !== 'end') return null;
    return structuredClone(record);
}
