const EVENT_TYPES = new Set(['offer', 'refresh', 'acquire', 'draw', 'delete', 'resolve']);
const STATUS_KEYS = ['experience', 'enrollment', 'satisfaction', 'accounting'];
const cardManagers = new WeakMap();

export function bindReplayCardManager(state, cardManager) {
    cardManagers.set(state, cardManager);
}

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
        record.turns.push({ turn: state.turn, training: [], choices: [], operations: [], events: [], checkpoints: [], completed: false });
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

export function snapshotReplayState(state, { decision = false } = {}) {
    const record = state.replayRecord;
    decision = decision && record.captureViewing === true;
    state.ensureCardIdentities?.();
    const cards = list => (list || []).map(card => rememberCard(record, card));
    const groups = value => Object.fromEntries(Object.entries(value || {}).map(([key, list]) => [key, cards(list)]));
    const manager = cardManagers.get(state);
    const trainingPool = decision && manager && ['start', 'training'].includes(state.phase) ? {
        decks: groups(manager.trainingDecks), discards: groups(manager.trainingDiscards)
    } : null;
    return {
        turn: state.turn,
        phase: state.phase,
        nextInstanceId: state.nextInstanceId,
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
        ...(decision ? { offerHistory: record.turns.flatMap(item => item.events.filter(event => ['offer', 'refresh'].includes(event.type))
            .map(event => ({ ...structuredClone(event), turn: item.turn }))) } : {}),
        randomState: state.rng.snapshot(),
        ...(trainingPool ? { trainingPool } : {})
    };
}

export function startReplayRecording(state, { cardManager, scoreManager, eventDefinition = null, eventItems = [], captureViewing = false } = {}) {
    if (state.turn !== 0 || !['start', 'training'].includes(state.phase)) return false;
    if (state.difficulty === 'int') {
        state.replayRecord = null;
        return false;
    }
    if (cardManager) bindReplayCardManager(state, cardManager);
    const config = state.config;
    state.replayRecord = {
        schema: 1, complete: false, viewingVersion: 1, captureViewing,
        operationsRefreshRemaining: state.trainingRefreshRemaining ?? 0,
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

export function captureReplayTrainingChoice(state, selected, options = {}) {
    const turn = currentTurn(state);
    if (!turn || turn.completed) return;
    const record = state.replayRecord, manager = cardManagers.get(state);
    const eventTraining = state.event?.eventTraining;
    const phaseTag = options.phaseTag || (eventTraining ? 'event' : state.trainingSelectionMode === 'inspiration' ? 'inspiration' : state.turn === 0 ? 'initial' : 'main');
    const rarity = options.rarity || (eventTraining ? 'SSR' : phaseTag === 'inspiration' ? 'SR' : state.config.turns[state.turn].training);
    const pickCount = options.pickCount ?? (phaseTag === 'initial' ? 2 : 1);
    const allowSkip = options.allowSkip ?? phaseTag === 'inspiration';
    let candidates = options.candidates || eventTraining?.cards || state.currentTrainingCards || [];
    if (state.calcMode && !options.candidates) {
        candidates = (manager?.allCards || []).filter(card => card.rarity === rarity)
            .flatMap(card => Array.from({ length: Math.max(1, pickCount) }, (_, i) => ({ ...card, poolId: `manual:${card.cardNo}:${i}` })));
    }
    const chosen = (selected || []).filter(card => card && !card.__skip);
    if (!chosen.length && !allowSkip) return;
    const used = new Set();
    const selectedIndices = chosen.map(card => {
        const index = candidates.findIndex((candidate, i) => !used.has(i) && (card.poolId && candidate.poolId === card.poolId ||
            String(candidate.cardNo) === String(card.cardNo) && (!card.poolId || state.calcMode)));
        used.add(index); return index;
    });
    if (selectedIndices.includes(-1)) { record.invalid = true; return; }
    const refreshes = record.operationsRefreshRemaining - (state.trainingRefreshRemaining ?? 0);
    if (!Number.isInteger(refreshes) || refreshes < 0) { record.invalid = true; return; }
    record.operationsRefreshRemaining = state.trainingRefreshRemaining ?? 0;
    (turn.operations ||= []).push({ phaseTag, refreshes,
        selected: state.calcMode ? chosen.map(card => Number(card.cardNo)) : selectedIndices });
    if (!record.captureViewing) return;
    const before = snapshotReplayState(state, { decision: true });
    before.currentTrainingCards = candidates.map(card => rememberCard(record, card));
    (turn.choices ||= []).push({ before, rarity, pickCount, allowSkip, phaseTag, selectedIndices,
        allowRefresh: !state.calcMode && phaseTag !== 'event' });
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
    const snapshot = snapshotReplayState(state, { decision: kind === 'action-start' || kind === 'meeting-start' });
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
    if (!record?.complete || !['fresh', 'pro'].includes(record.metadata?.difficulty) ||
        record.metadata?.runId !== state.runId || !hasCompleteTurns(record) ||
        !record.result?.score || !Array.isArray(record.result.finalDeck) || record.result.state?.phase !== 'end') return null;
    return structuredClone(record);
}
