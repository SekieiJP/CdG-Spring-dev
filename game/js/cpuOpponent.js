import { GameState } from './gameState.js?v=20261110-0065';
import { CardManager } from './cardManager.js?v=20261110-0065';
import { TurnManager } from './turnManager.js?v=20261110-0065';
import { ScoreManager } from './scoreManager.js?v=20261110-0065';
import { getDifficultyConfig } from './difficultyConfig.js?v=20261110-0065';
import * as acquisitionAdvisor from './acquisitionAdvisor.js?v=20261110-0065';
import * as formula from './proAcquisitionAdvisor.js?v=20261110-0065';
import * as researchModule from './cpu/pro-strategy-research.js?v=20261110-0065';
import { createCpuPolicyKernel } from './cpu/policyKernel.js?v=20261110-0065';
import { startReplayRecording, captureReplayBoundary, captureReplayTrainingChoice, completeReplayAction, finalizeReplayRecording } from './replayRecorder.js?v=20261110-0065';
import { createEventState, getEventDefinition, getEventItem } from './eventManager.js?v=20261110-0065';
import { prepareCpuEventTurn, finishCpuEventTraining, resolveCpuEventEffects } from './cpuEventRuntime.js?v=20261110-0065';

const dataJobs = new Map();
const policyAdvisor = {
    ...acquisitionAdvisor,
    createAdvisorObservation(state, cards, options) {
        const observation = acquisitionAdvisor.createAdvisorObservation(state, cards, options);
        // 固定方略の評価モデルは通常モード向け。イベントの実効果はゲーム状態側で解決する
        return observation.mode === 'normal' ? observation : { ...observation, mode: 'normal' };
    }
};

async function readData(name) {
    if (dataJobs.has(name)) return dataJobs.get(name);
    const url = new URL(`../data/cpu/${name}`, import.meta.url);
    const job = fetch(url).then(response => {
        if (!response.ok) throw new Error('あひる先生の方略データを読み込めません');
        return response.json();
    }).catch(error => { dataJobs.delete(name); throw error; });
    dataJobs.set(name, job); return job;
}

export async function createCpuEngine({ difficulty, seed, resources = null }) {
    if (!['fresh', 'pro'].includes(difficulty)) throw new Error('CPUの難易度が不正です');
    const state = new GameState(); state.difficulty = difficulty;
    const cardManager = new CardManager(null);
    const turnManager = new TurnManager(state, cardManager);
    const scoreManager = new ScoreManager(null, { migrateHighScore: false });
    const config = getDifficultyConfig(difficulty);
    if (resources) {
        cardManager.allCards = structuredClone(resources.cards);
        cardManager.dataVersion = resources.cardVersion;
        scoreManager.rankTable = structuredClone(resources.ranks);
        scoreManager.dataVersion = resources.rankVersion;
    } else {
        const cardsLoaded = await cardManager.loadCards(new URL(`../${config.csvPath}`, import.meta.url).href);
        const ranksLoaded = await scoreManager.loadRankData(new URL(`../${config.rankCsvPath}`, import.meta.url).href);
        if (!cardsLoaded || !ranksLoaded?.length) throw new Error('CPU用のカード・ランクデータを読み込めません');
    }
    cardManager.rankVersion = scoreManager.dataVersion;
    turnManager.initializeGame({ seed: String(seed), source: 'cpu' });
    let research = null, valueModel = null;
    if (difficulty === 'pro') {
        research = resources?.research || await readData('pro-policy-v1.json');
        const data = resources?.valueModel || await readData('pro-public-value-v1.json');
        valueModel = data.model || data;
        const parse = cardManager.parseEffect, cache = new Map();
        cardManager.parseEffect = function (text) {
            if (!cache.has(text)) cache.set(text, parse.call(this, text));
            return cache.get(text);
        };
    }
    const game = { gameState: state, cardManager, turnManager, scoreManager };
    const policy = createCpuPolicyKernel(game, { difficulty, acquisitionAdvisor: policyAdvisor, formula, researchModule, research, valueModel });
    return { game, policy };
}

export async function createCpuReplay({ difficulty, seed, onProgress = () => {}, resources = null, eventId = null, captureViewing = false }) {
    const { game, policy } = await createCpuEngine({ difficulty, seed, resources });
    const { gameState: state, cardManager, turnManager, scoreManager } = game;
    const eventDefinition = eventId ? getEventDefinition(eventId) : null;
    if (eventId && !eventDefinition) throw new Error('このイベントのお手本プレイには対応していません');
    if (eventDefinition) state.event = createEventState(eventDefinition, difficulty);
    state.recordStartTime();
    startReplayRecording(state, { cardManager, scoreManager, eventDefinition,
        eventItems: eventDefinition?.items.map(getEventItem) || [], captureViewing });
    const acquire = (rarity, pickCount, drawCount, phaseTag, allowSkip, supplied = null) => {
        const candidates = supplied || cardManager.drawTrainingCards(rarity, drawCount);
        state.currentTrainingCards = candidates;
        captureReplayBoundary(state, 'training-offer', { rarity, pickCount, allowSkip });
        const refreshRemaining = state.trainingRefreshRemaining;
        if (phaseTag === 'event') state.trainingRefreshRemaining = 0;
        const decision = policy.training({ rarity, candidates, pickCount, drawCount, phaseTag, allowSkip });
        if (phaseTag === 'event') state.trainingRefreshRemaining = refreshRemaining;
        state.currentTrainingCards = decision.candidates;
        captureReplayTrainingChoice(state, decision.selected, { rarity, pickCount, allowSkip, phaseTag });
        decision.selected.forEach(card => state.addToDeck({ ...card }));
        captureReplayBoundary(state, 'training-choice', { selected: decision.selected.map(card => card.cardNo), allowSkip });
    };
    state.phase = 'training';
    while (state.turn < state.totalTurns) {
        const turn = state.turn, rarity = turnManager.getCurrentTurnConfig().training;
        state.trainingSelectionMode = 'normal';
        const eventCards = prepareCpuEventTurn(game);
        if (eventCards) {
            acquire('SSR', 1, 3, 'event', false, eventCards);
            finishCpuEventTraining(state);
        }
        acquire(turn === 0 ? 'R' : rarity, turn === 0 ? 2 : 1, turn === 0 ? 4 : 3, turn === 0 ? 'initial' : 'main', false);
        let inspiration = state.tokens.inspiration || 0;
        while (inspiration > 0) {
            state.trainingSelectionMode = 'inspiration';
            acquire('SR', 1, 3, 'inspiration', true);
            state.tokens.inspiration = --inspiration;
        }
        state.trainingSelectionMode = 'normal'; state.currentTrainingCards = null;
        turnManager.advancePhase(); policy.place(); turnManager.executeActions();
        resolveCpuEventEffects(state);
        completeReplayAction(state); turnManager.advancePhase();
        if (state.event) state.event.actionCompletion = null;
        if (state.phase === 'meeting') { policy.delete(); turnManager.advancePhase(); }
        onProgress(state.turn);
    }
    const record = finalizeReplayRecording(state, scoreManager.calculateScore(state), state.getOwnedCards());
    if (!record) throw new Error('あひる先生のプレイ記録を確定できませんでした');
    record.metadata.cpuPolicy = difficulty === 'pro' ? 'fixed-pro-v1' : 'reach@fresh_stable';
    return record;
}
