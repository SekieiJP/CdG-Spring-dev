import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import '../game/js/difficultyExtensions.js';
import { GameState } from '../game/js/gameState.js';
import { CardManager } from '../game/js/cardManager.js';
import { TurnManager } from '../game/js/turnManager.js';
import { ScoreManager } from '../game/js/scoreManager.js';
import { getPlacementError } from '../game/js/placementRules.js';
import { observeMaster, createMasterPolicy } from './master-policy.mjs';

export async function loadMasterRules() {
    const state = new GameState();
    state.reset('int');
    const data = path => readFile(new URL('../game/' + path, import.meta.url), 'utf8');
    const cards = new CardManager();
    cards.parseCSV(await data(state.config.csvPath));
    assert.ok(cards.allCards.length);
    const scorer = new ScoreManager(null, { migrateHighScore: false });
    const csv = await data(state.config.rankCsvPath);
    assert.ok(await scorer.loadRankData('data:text/csv,' + encodeURIComponent(csv)));
    return { catalog: cards.allCards, scorer };
}

function checkSubset(selected, allowed, min, max) {
    assert.ok(Array.isArray(selected) && selected.length >= min && selected.length <= max, '選択枚数');
    assert.equal(new Set(selected).size, selected.length, '同一個体の重複');
    for (const item of selected) assert.ok(allowed.includes(item), '候補外の選択');
}

export function playMaster(seed, { catalog, scorer }, decide, trace = null) {
    const state = new GameState();
    state.difficulty = 'int';
    const cards = new CardManager();
    cards.allCards = catalog;
    const turns = new TurnManager(state, cards);
    turns.initializeGame({ seed, runId: 'master' });
    state.playRecord = null;
    turns.advancePhase();
    const counts = {};
    function ask() {
        const obs = observeMaster(turns);
        assert.ok(obs, '判断が必要な局面');
        const answer = decide(obs);
        counts[answer.kind] = (counts[answer.kind] || 0) + 1;
        if (trace) {
            const listed = obs.cards ?? obs.hand ?? (obs.card ? [obs.card] : []);
            trace({ turn: state.turn, day: turns.getCurrentTurnConfig().name, kind: obs.kind, stats: obs.stats,
                tokens: obs.tokens, refreshes: obs.refreshes, offer: obs.offer,
                cards: listed.map(card => ({ id: card.instanceId, no: card.cardNo })), answer });
        }
        return answer;
    }

    function acquire(offer, outing = null) {
        let candidates = outing?.candidates ?? cards.drawTrainingOffer(offer);
        for (;;) {
            state.currentTrainingCards = candidates;
            const move = ask();
            if (move.kind !== 'refresh') {
                assert.equal(move.kind, 'acquire');
                const required = Math.min(offer.pickCount, candidates.length);
                checkSubset(move.indices, candidates.map((_, i) => i),
                    offer.allowSkip && !move.indices.length ? 0 : required, required);
                const selected = move.indices.map(index => candidates[index]);
                if (outing) {
                    for (const card of selected) assert.ok(turns.selectOutingCard(card));
                    assert.ok(turns.confirmOutingCards(), '外出先のカード確定');
                } else {
                    for (const card of selected) state.addToDeck(card);
                    state.currentTrainingCards = null;
                }
                break;
            }
            assert.ok(state.trainingRefreshRemaining > 0 && candidates.length > 0, 'リフレッシュ条件');
            candidates = cards.refreshTrainingCards(offer.rarity, candidates, offer.offerCount);
            state.trainingRefreshRemaining--;
            if (outing) outing.candidates = candidates;
        }
    }

    try {
        while (state.phase !== 'end') {
            switch (state.phase) {
            case 'training': {
                const offer = turns.getTrainingOfferConfig({ mode: 'normal' });
                if (offer) acquire(offer);
                while (state.tokens.inspiration > 0) {
                    state.trainingSelectionMode = 'inspiration';
                    acquire(turns.getTrainingOfferConfig());
                    state.tokens.inspiration--;
                }
                state.trainingSelectionMode = 'normal';
                turns.advancePhase();
                break;
            }
            case 'outing': {
                const move = ask();
                assert.equal(move.kind, 'outing');
                const option = turns.getOutingConfig().outingOptions.find(item => item.id === move.place);
                assert.ok(option);
                const result = turns.beginOuting(option.id);
                assert.ok(result);
                if (result.stage === 'card') acquire(option, state.ruleState.int.outing);
                if (state.ruleState.int.outing?.stage === 'staff') {
                    const choice = ask();
                    assert.equal(choice.kind, 'staff');
                    assert.ok(turns.selectOutingStaff(choice.staff));
                }
                break;
            }
            case 'action': {
                const plan = ask();
                assert.equal(plan.kind, 'place');
                assert.ok(Array.isArray(plan.moves), '配置列が必要です');
                for (const { id, staff } of plan.moves) {
                    const card = state.player.hand.find(item => item.instanceId === id);
                    assert.ok(card, '手札外の配置');
                    assert.equal(getPlacementError(cards, state, card, staff), null);
                    state.removeFromHand(card);
                    state.placeCard(card, staff);
                }
                assert.equal(turns.getActionValidationError(), null);
                turns.executeActions();
                turns.advancePhase();
                break;
            }
            case 'meeting': {
                const move = ask();
                assert.equal(move.kind, 'delete');
                const ids = turns.getMeetingDeleteCandidates().map(card => card.instanceId);
                checkSubset(move.ids, ids, Math.min(ids.length, turns.getCurrentTurnConfig().delete),
                    Math.min(ids.length, turns.getCurrentDeleteMax()));
                for (const id of move.ids) {
                    const card = turns.getMeetingDeleteCandidates().find(item => item.instanceId === id);
                    assert.ok(turns.deleteMeetingCard(card));
                }
                state.tokens.organize = 0;
                turns.advancePhase();
                break;
            }
            default: throw new Error('未知のフェーズ ' + state.phase);
            }
        }
    } catch (cause) {
        throw new Error([seed, state.turn, state.phase, cause.message].join(' / '), { cause });
    }
    assert.equal(state.turn, state.totalTurns);
    return { score: scorer.calculateScore(state), counts };
}

export function summarize(scores) {
    assert.ok(scores.length > 0 && scores.every(Number.isFinite));
    const sum = scores.reduce((a, b) => a + b, 0);
    const mean = sum / scores.length;
    const low = scores.filter(score => (score + 4) * scores.length <= sum).length;
    const histogram = {};
    for (const score of scores) histogram[score] = (histogram[score] || 0) + 1;
    return { games: scores.length, mean, threshold: mean - 4, low, rate: low / scores.length, histogram };
}

async function candidateFactory(modulePath) {
    return modulePath ? (await import(pathToFileURL(resolve(modulePath)).href)).createMasterPolicy : createMasterPolicy;
}

async function main(args) {
    const rules = await loadMasterRules();
    if (args[0] === '--trace') {
        const [, seed, strategy = 'v2', modulePath] = args;
        assert.ok(seed, '追跡するシードが必要です');
        const events = [];
        const factory = await candidateFactory(modulePath);
        const decide = modulePath ? factory(rules) : factory({ ...rules, strategy });
        const result = playMaster(seed, rules, decide, event => events.push(event));
        console.log(JSON.stringify({ seed, strategy, events, ...result }, null, 2));
        return;
    }
    const [split = 'development', n = '100', first = '0', modulePath] = args;
    const games = Number(n), start = Number(first);
    assert.ok(Number.isSafeInteger(start) && start >= 0 && Number.isSafeInteger(games) && games > 0);
    const baseline = modulePath ? 'v2' : 'v1';
    const candidate = modulePath ? 'candidate' : 'v2';
    const createCandidate = await candidateFactory(modulePath);
    const policies = {
        [baseline]: createMasterPolicy({ ...rules, strategy: baseline }),
        [candidate]: createCandidate(rules)
    };
    const scores = {}, results = {};
    for (const [name, decide] of Object.entries(policies)) {
        const values = [], actions = {};
        for (let i = 0; i < games; i++) {
            const seed = 'master/' + split + '/' + (start + i);
            const { score, counts } = playMaster(seed, rules, decide);
            values.push(score.displayScore);
            for (const [kind, count] of Object.entries(counts)) actions[kind] = (actions[kind] ?? 0) + count;
        }
        scores[name] = values;
        const summary = summarize(values);
        const lowSeedExamples = values.flatMap((v, i) => v <= summary.threshold ? [start + i] : []).slice(0, 10);
        results[name] = { ...summary, actions, lowSeedExamples };
    }
    const gain = results[candidate].mean - results[baseline].mean;
    const differences = scores[candidate].map((score, i) => score - scores[baseline][i]);
    const paired = { gain, wins: differences.filter(d => d > 0).length, ties: differences.filter(d => d === 0).length,
        losses: differences.filter(d => d < 0).length };
    const accepted = gain > 0 && results[candidate].rate <= 0.05;
    console.log(JSON.stringify({ split, start, games, baseline, candidate, results, paired, accepted }, null, 2));
    if (!accepted) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main(process.argv.slice(2));
