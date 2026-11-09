import { GameState } from './gameState.js?v=20261110-0065';
import { CardManager } from './cardManager.js?v=20261110-0065';
import { TurnManager } from './turnManager.js?v=20261110-0065';
import { ScoreManager } from './scoreManager.js?v=20261110-0065';
import { getDifficultyConfig } from './difficultyConfig.js?v=20261110-0065';
import { createEventState, getEventDefinition, getEventItem } from './eventManager.js?v=20261110-0065';
import { startReplayRecording, captureReplayBoundary, captureReplayTrainingChoice, completeReplayAction, finalizeReplayRecording } from './replayRecorder.js?v=20261110-0065';
import { prepareCpuEventTurn, finishCpuEventTraining, resolveCpuEventEffects } from './cpuEventRuntime.js?v=20261110-0065';

const CACHE_BUSTER = 'v20261110-0065';
const STATS = ['experience', 'enrollment', 'satisfaction', 'accounting'];
const resourceJobs = new Map();

export class ReplaySimulationError extends Error {}
const invalid = () => { throw new ReplaySimulationError('リプレイの操作記録が正しくありません'); };
const list = value => { if (!Array.isArray(value)) invalid(); return value; };
const integer = value => { if (!Number.isSafeInteger(value) || value < 0) invalid(); return value; };

function endingChecksum(score, player, deck) {
    const text = JSON.stringify([score.displayScore, ...STATS.map(key => player[key]), deck.map(card => Number(card.cardNo))]);
    let value = 2166136261;
    for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
    return value >>> 0;
}

function checkBuild(metadata, current = CACHE_BUSTER) {
    const saved = metadata?.buildVersion?.match(/^v(\d{8})-\d{4}$/);
    const running = String(current).match(/^v(\d{8})-\d{4}$/);
    if (!saved || !running || saved[1] !== running[1] || saved[1] !== CACHE_BUSTER.slice(1, 9)) {
        throw new ReplaySimulationError('このリプレイは現在のゲームと互換性がありません');
    }
}

export function operationReplayPacket(record) {
    if (record.viewingVersion !== 1 || record.metadata.buildVersion.slice(1, 9) !== CACHE_BUSTER.slice(1, 9)) return null;
    if (record.turns.some(turn => !Array.isArray(turn.operations) || !turn.operations.length)) invalid();
    const prefix = `${record.metadata.runId}:`;
    const ordinal = id => {
        if (typeof id !== 'string' || !id.startsWith(prefix)) invalid();
        const number = Number(id.slice(prefix.length)); if (!integer(number)) invalid(); return number;
    };
    const slots = getDifficultyConfig(record.metadata.difficulty).slots;
    const turns = record.turns.map(turn => [
        turn.operations.map(operation => [operation.refreshes, operation.selected]),
        slots.map(slot => turn.action.placed[slot.id].map(ordinal)),
        turn.action.before.player.hand.map(ordinal), turn.action.before.player.deck.map(ordinal),
        turn.meeting.deleted.map(event => ordinal(event.card.instanceId))
    ]);
    return [1, record.metadata, turns, endingChecksum(record.result.score, record.result.state.player, record.result.finalDeck)];
}

async function resources(difficulty) {
    if (resourceJobs.has(difficulty)) return resourceJobs.get(difficulty);
    const job = (async () => {
        const config = getDifficultyConfig(difficulty), cards = new CardManager(), scorer = new ScoreManager(null, { migrateHighScore: false });
        const loaded = await cards.loadCards(new URL(`../${config.csvPath}`, import.meta.url).href);
        const ranks = await scorer.loadRankData(new URL(`../${config.rankCsvPath}`, import.meta.url).href);
        if (!loaded || !ranks?.length) throw new ReplaySimulationError('復元用のカード・評価データを読み込めません');
        return { cards: cards.allCards, cardVersion: cards.dataVersion, ranks, rankVersion: scorer.dataVersion };
    })().catch(error => { resourceJobs.delete(difficulty); throw error; });
    resourceJobs.set(difficulty, job); return job;
}

export async function restoreOperationReplay(packet, { currentBuildVersion = CACHE_BUSTER, maxDecodedBytes = 8 * 1024 * 1024 } = {}) {
    if (!Array.isArray(packet) || packet.length !== 4 || packet[0] !== 1) invalid();
    const [, metadata, operations, expected] = packet;
    checkBuild(metadata, currentBuildVersion);
    if (!['fresh', 'pro'].includes(metadata.difficulty) || typeof metadata.seed !== 'string' ||
        typeof metadata.runId !== 'string' || !metadata.runId.length || metadata.runId.length > 128 ||
        typeof metadata.calcMode !== 'boolean' || metadata.totalTurns !== getDifficultyConfig(metadata.difficulty).turns.length ||
        !(metadata.eventId === null || typeof metadata.eventId === 'string') ||
        list(operations).length !== metadata.totalTurns || !Number.isInteger(expected) || expected < 0 || expected > 0xffffffff) invalid();
    const data = await resources(metadata.difficulty);
    const state = new GameState(); state.difficulty = metadata.difficulty;
    const cards = new CardManager(); cards.allCards = structuredClone(data.cards); cards.dataVersion = data.cardVersion; cards.rankVersion = data.rankVersion;
    const turns = new TurnManager(state, cards), scorer = new ScoreManager(null, { migrateHighScore: false });
    scorer.rankTable = structuredClone(data.ranks); scorer.dataVersion = data.rankVersion;
    turns.initializeGame({ seed: metadata.seed, runId: metadata.runId, source: 'replay' });
    state.calcMode = metadata.calcMode; state.startedAt = metadata.startedAt || null;
    const event = metadata.eventId ? getEventDefinition(metadata.eventId) : null;
    if (metadata.eventId && !event) throw new ReplaySimulationError('このイベントのリプレイを復元できません');
    if (event) state.event = createEventState(event, metadata.difficulty);
    startReplayRecording(state, { cardManager: cards, scoreManager: scorer, eventDefinition: event,
        eventItems: event?.items.map(getEventItem) || [], captureViewing: true });
    state.replayRecord.metadata = structuredClone(metadata); state.phase = 'training';
    const encoder = new TextEncoder();
    const checkSize = () => {
        if (encoder.encode(JSON.stringify(state.replayRecord)).byteLength > maxDecodedBytes) throw new ReplaySimulationError('リプレイデータが大きすぎます');
    };
    const id = ordinal => `${metadata.runId}:${integer(ordinal)}`;
    const reorder = (current, order) => {
        const ids = list(order).map(id);
        if (ids.length !== current.length || new Set(ids).size !== ids.length) invalid();
        const byId = new Map(current.map(card => [card.instanceId, card]));
        return ids.map(key => { const card = byId.get(key); if (!card) invalid(); return card; });
    };
    for (let turn = 0; turn < metadata.totalTurns; turn++) {
        const row = list(operations[turn]); if (row.length !== 5 || state.turn !== turn || state.phase !== 'training') invalid();
        const [training, placement, handOrder, deckOrder, deleted] = row; list(training); let choiceIndex = 0;
        const acquire = (rarity, pickCount, phaseTag, allowSkip, supplied = null) => {
            const instruction = list(training[choiceIndex++]); if (instruction.length !== 2) invalid();
            const refreshes = integer(instruction[0]), selected = list(instruction[1]);
            const drawCount = phaseTag === 'initial' ? 4 : 3;
            let candidates = state.calcMode ? [] : supplied || cards.drawTrainingCards(rarity, drawCount);
            if (refreshes > state.trainingRefreshRemaining || phaseTag === 'event' && refreshes) invalid();
            for (let i = 0; i < refreshes; i++) {
                if (!state.calcMode) candidates = cards.refreshTrainingCards(rarity, candidates, drawCount);
                state.trainingRefreshRemaining--;
            }
            state.currentTrainingCards = state.calcMode ? null : candidates;
            let chosen;
            if (state.calcMode) {
                chosen = selected.map(number => {
                    integer(number); const card = cards.allCards.find(card => Number(card.cardNo) === number && card.rarity === rarity);
                    if (!card) invalid(); return { ...card };
                });
            } else {
                if (new Set(selected).size !== selected.length) invalid();
                chosen = selected.map(index => { integer(index); if (!candidates[index]) invalid(); return { ...candidates[index] }; });
            }
            if (chosen.length > pickCount || !allowSkip && chosen.length !== pickCount) invalid();
            captureReplayBoundary(state, 'training-offer', { rarity, pickCount, allowSkip });
            captureReplayTrainingChoice(state, chosen, { rarity, pickCount, phaseTag, allowSkip,
                ...(state.calcMode ? {} : { candidates }) });
            chosen.forEach(card => state.addToDeck(card));
            captureReplayBoundary(state, 'training-choice', { selected: chosen.map(card => card.cardNo), allowSkip });
        };
        state.trainingSelectionMode = 'normal'; prepareCpuEventTurn({ gameState: state, cardManager: cards });
        if (state.event?.eventTraining) {
            acquire('SSR', 1, 'event', false, state.event.eventTraining.cards || null); finishCpuEventTraining(state);
        }
        const rarity = turns.getCurrentTurnConfig().training;
        acquire(turn === 0 ? 'R' : rarity, turn === 0 ? 2 : 1, turn === 0 ? 'initial' : 'main', false);
        if (state.calcMode && state.tokens.inspiration > 0) {
            state.trainingSelectionMode = 'inspiration'; acquire('SR', state.tokens.inspiration, 'inspiration', true); state.tokens.inspiration = 0;
        } else while (state.tokens.inspiration > 0) {
            state.trainingSelectionMode = 'inspiration'; acquire('SR', 1, 'inspiration', true); state.tokens.inspiration--;
        }
        if (choiceIndex !== training.length) invalid();
        state.trainingSelectionMode = 'normal'; state.currentTrainingCards = null;
        turns.advancePhase();
        if (state.calcMode) { state.player.deck.push(...state.player.hand); state.player.hand = []; }
        const slots = state.slotIds; if (list(placement).length !== slots.length) invalid();
        for (let s = 0; s < slots.length; s++) for (const ordinal of list(placement[s])) {
            const key = id(ordinal), from = state.calcMode ? state.player.deck : state.player.hand;
            const index = from.findIndex(card => card.instanceId === key); if (index < 0) invalid();
            const [card] = from.splice(index, 1); state.placeCard(card, slots[s]);
        }
        state.player.hand = reorder(state.player.hand, handOrder); state.player.deck = reorder(state.player.deck, deckOrder);
        turns.executeActions(); resolveCpuEventEffects(state); completeReplayAction(state);
        const deleteMax = turns.getCurrentDeleteMax(); turns.advancePhase();
        if (state.event) state.event.actionCompletion = null;
        if (state.phase === 'meeting') {
            if (list(deleted).length > deleteMax) invalid();
            for (const ordinal of deleted) {
                const card = state.player.deck.find(card => card.instanceId === id(ordinal));
                if (!card || !state.removeFromDeck(card)) invalid();
            }
            state.tokens.organize = 0; turns.advancePhase();
        } else if (list(deleted).length) invalid();
        checkSize();
    }
    const score = scorer.calculateScore(state);
    if (endingChecksum(score, state.player, state.getOwnedCards()) !== expected) {
        throw new ReplaySimulationError('操作記録から復元した結果が一致しません');
    }
    const record = finalizeReplayRecording(state, score, state.getOwnedCards());
    if (!record) invalid();
    record.profile = 'seed-operations';
    if (encoder.encode(JSON.stringify(record)).byteLength > maxDecodedBytes) throw new ReplaySimulationError('リプレイデータが大きすぎます');
    return JSON.parse(JSON.stringify(record));
}
