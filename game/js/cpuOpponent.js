import { GameState } from './gameState.js?v=20261107-0063';
import { CardManager } from './cardManager.js?v=20261107-0063';
import { TurnManager } from './turnManager.js?v=20261107-0063';
import { ScoreManager } from './scoreManager.js?v=20261107-0063';
import { getDifficultyConfig } from './difficultyConfig.js?v=20261107-0063';
import * as acquisitionAdvisor from './acquisitionAdvisor.js?v=20261107-0063';
import * as formula from './proAcquisitionAdvisor.js?v=20261107-0063';
import * as researchModule from './cpu/pro-strategy-research.js?v=20261107-0063';
import { createCpuPolicyKernel } from './cpu/policyKernel.js?v=20261107-0063';
import { startReplayRecording, captureReplayBoundary, completeReplayAction, finalizeReplayRecording } from './replayRecorder.js?v=20261107-0063';

async function readData(name) {
    const url = new URL(`../data/cpu/${name}`, import.meta.url);
    const response = await fetch(url);
    if (!response.ok) throw new Error('あひる先生の方略データを読み込めません');
    return response.json();
}

export async function createCpuReplay({ difficulty, seed, onProgress = () => {}, resources = null }) {
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
    turnManager.initializeGame({ seed: String(seed), source: 'cpu' }); state.recordStartTime();
    startReplayRecording(state, { cardManager, scoreManager });
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
    const policy = createCpuPolicyKernel(game, { difficulty, acquisitionAdvisor, formula, researchModule, research, valueModel });
    const acquire = (rarity, pickCount, drawCount, phaseTag, allowSkip) => {
        const candidates = cardManager.drawTrainingCards(rarity, drawCount);
        state.currentTrainingCards = candidates;
        captureReplayBoundary(state, 'training-offer', { rarity, pickCount, allowSkip });
        const decision = policy.training({ rarity, candidates, pickCount, drawCount, phaseTag, allowSkip });
        state.currentTrainingCards = decision.candidates;
        decision.selected.forEach(card => state.addToDeck({ ...card }));
        captureReplayBoundary(state, 'training-choice', { selected: decision.selected.map(card => card.cardNo), allowSkip });
    };
    state.phase = 'training';
    while (state.turn < state.totalTurns) {
        const turn = state.turn, rarity = turnManager.getCurrentTurnConfig().training;
        state.trainingSelectionMode = 'normal';
        acquire(turn === 0 ? 'R' : rarity, turn === 0 ? 2 : 1, turn === 0 ? 4 : 3, turn === 0 ? 'initial' : 'main', false);
        let inspiration = state.tokens.inspiration || 0;
        while (inspiration > 0) {
            state.trainingSelectionMode = 'inspiration';
            acquire('SR', 1, 3, 'inspiration', true);
            state.tokens.inspiration = --inspiration;
        }
        state.trainingSelectionMode = 'normal'; state.currentTrainingCards = null;
        turnManager.advancePhase(); policy.place(); turnManager.executeActions();
        completeReplayAction(state); turnManager.advancePhase();
        if (state.phase === 'meeting') { policy.delete(); turnManager.advancePhase(); }
        onProgress(state.turn);
    }
    const record = finalizeReplayRecording(state, scoreManager.calculateScore(state), state.getOwnedCards());
    if (!record) throw new Error('あひる先生のプレイ記録を確定できませんでした');
    record.metadata.cpuPolicy = difficulty === 'pro' ? 'fixed-pro-v1' : 'reach@fresh_stable';
    return record;
}
