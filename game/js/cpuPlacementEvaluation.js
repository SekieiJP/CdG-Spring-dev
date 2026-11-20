import { STATUS_KEYS, snapshotStats } from './actionResolver.js?v=20261122-0068';
import { CardManager } from './cardManager.js?v=20261122-0068';
import { getPlacementError } from './placementRules.js?v=20261122-0068';
import { createPublicActionKernel } from './cpu/pro-public-action-kernel.js?v=20261122-0068';
import { createTerminalExact } from './terminalPlacement.js?v=20261122-0068';

const PLACEMENT_TOKENS = ['passion', 'fatigue', 'inspiration', 'organize'];
const USEFUL_CAPS = {
    fresh: { experience: 30, enrollment: 30, satisfaction: 15, accounting: 18 },
    pro: { experience: 50, enrollment: 48, satisfaction: 35, accounting: 19 }
};

function isProductiveAddition(before, after, caps, hasMeeting) {
    if (STATUS_KEYS.some(axis => after.player[axis] < before.player[axis]) ||
        [...before.applied].some(card => !after.applied.has(card)) ||
        after.tokens.fatigue > before.tokens.fatigue ||
        ['passion', 'inspiration', 'organize'].some(token => after.tokens[token] < before.tokens[token])) return false;
    return STATUS_KEYS.some(axis => Math.min(after.player[axis], caps[axis]) > Math.min(before.player[axis], caps[axis])) ||
        after.tokens.passion - after.tokens.fatigue > before.tokens.passion - before.tokens.fatigue ||
        after.tokens.inspiration > before.tokens.inspiration ||
        (hasMeeting && after.tokens.organize > before.tokens.organize);
}

export function createPlacementEvaluation(rules, scorer) {
    const parser = new CardManager(null);
    const slots = rules.slots.map(slot => slot.id);
    const resolve = createPublicActionKernel(rules.turns, parser, { cacheSize: 4000 });
    const placementError = (state, card, slot) => getPlacementError(parser, state, card, slot);
    const score = player => scorer.calculateScore({ difficulty: rules.id, player }).displayScore;

    function evaluate(observation, plan) {
        const state = {
            difficulty: rules.id, turn: observation.turn, totalTurns: observation.totalTurns, config: rules,
            player: { ...snapshotStats(observation.stats), placed: Object.fromEntries(slots.map(slot => [slot, []])) },
            slots: rules.slots,
            tokens: Object.fromEntries(PLACEMENT_TOKENS.map(token => [token, observation.tokens[token] || 0]))
        };
        const applied = new Set();
        const used = new Set();
        for (const slot of slots) {
            for (const card of plan[slot]) {
                if (used.has(card) || placementError(state, card, slot)) return null;
                used.add(card);
                if (resolve(card, slot, state).applied) applied.add(card);
                state.player.placed[slot].push(card);
            }
        }
        return { plan, player: snapshotStats(state.player), tokens: state.tokens, applied, score: score(state.player) };
    }

    function* neighbors(observation, base, hand, replace) {
        const used = new Set(Object.values(base.plan).flat());
        const unused = hand.filter(card => !used.has(card));
        for (const slot of slots) {
            const list = base.plan[slot];
            const removals = replace ? list.map((_, index) => index) : [-1];
            for (const removal of removals) {
                const others = list.filter((_, index) => index !== removal);
                for (const card of unused) {
                    for (let at = 0; at <= others.length; at++) {
                        const row = [...others.slice(0, at), card, ...others.slice(at)];
                        const candidate = evaluate(observation, { ...base.plan, [slot]: row });
                        if (candidate?.applied.has(card)) yield candidate;
                    }
                }
            }
        }
    }

    function* productiveAdditions(observation, current, hand) {
        const hasMeeting = rules.turns[observation.turn].delete > 0 || current.tokens.organize > 0;
        for (const next of neighbors(observation, current, hand, false)) {
            if (isProductiveAddition(current, next, USEFUL_CAPS[rules.id], hasMeeting || next.tokens.organize > 0)) yield next;
        }
    }

    const terminal = createTerminalExact({
        rules, placementError, resolve, score: state => scorer.calculateScore(state), maxStates: 30_000
    });
    function terminalBest(observation, hand) {
        if (hand.length > 20) return null;
        const result = terminal.optimize(observation, hand);
        const plan = Object.fromEntries(slots.map(slot => [slot, []]));
        for (const { slot, cardIndex } of result.sequence) plan[slot].push(hand[cardIndex]);
        return { ...result, plan };
    }

    return { evaluate, neighbors, productiveAdditions, terminalBest };
}
