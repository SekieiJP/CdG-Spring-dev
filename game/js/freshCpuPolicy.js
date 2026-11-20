import { createAdvisorObservation, recommendAcquisition } from './acquisitionAdvisor.js?v=20261122-0069';
import { chooseFreshForecastAcquisition, evaluateForecast } from './freshOutcomeForecast.js?v=20261122-0069';
import { withdrawal } from './proAcquisitionAdvisor.js?v=20261122-0069';
import { createPlacementEvaluation } from './cpuPlacementEvaluation.js?v=20261122-0069';

function recoverResources(evaluator, observation, current, hand) {
    if (observation.turn < 2 || withdrawal(current.player) <= 1) return current;
    const future = outcome => evaluateForecast({
        ...observation, turn: observation.turn + 1, stats: outcome.player, tokens: outcome.tokens
    }, observation.owned);
    const baseline = future(current);
    if (withdrawal(baseline.cautious) <= 1) return current;
    let best = current;
    let bestValue = baseline.value;
    const currentChurn = withdrawal(current.player);
    for (const alternative of evaluator.neighbors(observation, current, hand, true)) {
        if (withdrawal(alternative.player) >= currentChurn ||
            alternative.applied.size < current.applied.size ||
            alternative.tokens.fatigue > current.tokens.fatigue) continue;
        const result = future(alternative);
        if (result.mean < baseline.mean - 0.35 || result.downside < baseline.downside + 0.35) continue;
        if (result.value > bestValue) {
            best = alternative;
            bestValue = result.value;
        }
    }
    return best;
}

function refinePlacement(evaluator, observation, plan, hand) {
    const before = evaluator.evaluate(observation, plan);
    if (!before) throw new Error('基準の配置を評価できません');
    const lastTurn = observation.turn === observation.totalTurns - 1;
    if (lastTurn) {
        const best = evaluator.terminalBest(observation, hand);
        if (!best || best.score.displayScore < before.score) return plan;
        if (best.score.displayScore > before.score || before.applied.size < Object.values(plan).flat().length) {
            return best.plan;
        }
        return plan;
    }

    const appliedPlan = Object.fromEntries(Object.entries(plan).map(([slot, cards]) =>
        [slot, cards.filter(card => before.applied.has(card))]));
    let current = { ...before, plan: appliedPlan };
    current = recoverResources(evaluator, observation, current, hand);
    for (;;) {
        let best = null;
        for (const candidate of evaluator.productiveAdditions(observation, current, hand)) {
            if (!best || candidate.score > best.score ||
                (candidate.score === best.score && withdrawal(candidate.player) < withdrawal(best.player))) best = candidate;
        }
        if (!best) return current.plan;
        current = best;
    }
}

export function createFreshForecastCpuPolicy(game, baseline) {
    const { gameState: state, scoreManager } = game;
    const evaluator = createPlacementEvaluation(state.config, scoreManager);
    const rankTable = scoreManager.rankTable;
    return {
        ...baseline,
        training(round) {
            const choice = baseline.training(round);
            if (state.event?.enabled) return choice;
            const observation = createAdvisorObservation(state, choice.candidates, {
                pickCount: round.pickCount, allowSkip: round.allowSkip, rankTable
            });
            const original = choice.selected.map(card => choice.candidates.indexOf(card));
            observation.mode = 'normal';
            const alternative = chooseFreshForecastAcquisition(observation, recommendAcquisition(observation), original);
            return alternative ? { ...choice, selected: alternative.indices.map(i => choice.candidates[i]) } : choice;
        },
        place() {
            if (state.event?.enabled) return baseline.place();
            const hand = [...state.player.hand];
            const observation = createAdvisorObservation(state, [], { rankTable });
            const previous = baseline.place();
            const plan = state.player.placed;
            const choice = refinePlacement(evaluator, observation, plan, hand);
            if (state.slotIds.every(slot => choice[slot].length === plan[slot].length &&
                choice[slot].every((card, index) => card === plan[slot][index]))) return previous;
            for (const slot of state.slotIds) {
                for (const card of [...plan[slot]]) state.removePlacedCard(card, slot);
            }
            state.player.hand = hand;
            const placements = [];
            for (const slot of state.slotIds) {
                for (const card of choice[slot]) {
                    state.placeCard(card, slot);
                    state.removeFromHand(card);
                    placements.push({ cardName: card.cardName, slot });
                }
            }
            return placements;
        }
    };
}
