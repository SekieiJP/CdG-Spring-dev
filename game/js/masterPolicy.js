import { CardManager } from './cardManager.js?v=20261122-0069';
import { GameState } from './gameState.js?v=20261122-0069';
import { snapshotStats, resolveCardAction } from './actionResolver.js?v=20261122-0069';
import { getPlacementError } from './placementRules.js?v=20261122-0069';

const compareInstances = (a, b) => a.instanceId.localeCompare(b.instanceId);

// 山札順・研修プール・ゲームの乱数を方策へ渡さない
export function observeMaster(turns) {
    const state = turns.gameState;
    if (state.difficulty !== 'int' || state.calcMode) throw new Error('通常プレイのMASTER専用です');
    const day = turns.getCurrentTurnConfig();
    const common = {
        turn: state.turn, config: state.config, stats: snapshotStats(state.player), tokens: { ...state.tokens },
        owned: state.getOwnedCards().sort(compareInstances), refreshes: state.trainingRefreshRemaining
    };
    if (state.phase === 'action' && !state.pendingAction) {
        return { ...common, kind: 'place', hand: [...state.player.hand, ...Object.values(state.player.placed).flat()] };
    }
    if (state.phase === 'meeting') {
        const cards = turns.getMeetingDeleteCandidates().sort(compareInstances);
        const limit = state.meetingContext?.turn === state.turn ? state.meetingContext.deleteMax : turns.getCurrentDeleteMax();
        return { ...common, kind: 'delete', cards, min: Math.min(cards.length, day.delete), max: Math.min(cards.length, limit) };
    }
    if (state.phase === 'training') {
        const offer = turns.getTrainingOfferConfig();
        if (offer && Array.isArray(state.currentTrainingCards)) {
            return { ...common, kind: 'acquire', cards: [...state.currentTrainingCards], offer };
        }
    }
    if (state.phase === 'outing') {
        const outing = state.ruleState.int.outing;
        if (!outing) return { ...common, kind: 'outing', options: day.outingOptions };
        const offer = day.outingOptions.find(option => option.id === outing.place);
        if (outing.stage === 'card') return { ...common, kind: 'acquire', cards: [...outing.candidates], offer };
        if (outing.stage === 'staff') return { ...common, kind: 'staff', card: outing.selectedCard };
    }
    return null;
}

class PolicyCards extends CardManager {
    constructor(catalog) {
        super();
        this.allCards = catalog;
        this.parsed = new Map();
    }
    parseEffect(effect) {
        if (!this.parsed.has(effect)) this.parsed.set(effect, super.parseEffect(effect));
        return this.parsed.get(effect);
    }
}

const accountingCards = new Set([5, 15, 16, 17, 36, 37, 38, 39, 41, 50]);
const premiumRecruiting = new Set([18, 19, 21, 22, 42, 43, 45]);
const strongMoney = new Set([16, 37, 38, 39, 41, 50]);
const recruiting = new Set([7, 8, 18, 19, 21, 22, 23, 42, 43, 44, 45, 48, 51]);
// 添字はcards_pro.csvのcardNo。状態に応じた補正前の取得価値
const quality = [
    0, 2, 2, 1, 1, 2, 4, 6, 5, 4, 4, 4, 4, 7, 5, 5, 6, 5,
    7, 8, 5, 8, 8, 8, 6, 6, 7, 7, 5, 4, 8, 7, 6, 5, 5, 4, 5, 7, 6, 7, 5, 7,
    10, 7, 8, 11, 8, 8, 9, 4, 11, 8
];

function combinations(n, k) {
    if (k < 0 || k > n) return 0;
    let count = 1;
    for (let i = 1; i <= k; i++) count = count * (n - i + 1) / i;
    return count;
}

// 提示前は公開カタログから異なる種類が等確率で出ると仮定する。上位pickCount枚に入る確率で重み付けする
function expectedPicks(values, offerCount, pickCount) {
    const sorted = values.sort((a, b) => b - a);
    const n = sorted.length, draw = Math.min(n, offerCount);
    const total = combinations(n, draw);
    return sorted.reduce((sum, value, index) => {
        let selected = 0;
        for (let better = 0; better < Math.min(pickCount, draw); better++) {
            selected += combinations(index, better) * combinations(n - index - 1, draw - better - 1);
        }
        return sum + value * selected / total;
    }, 0);
}

export function createMasterPolicy({ catalog, scorer, strategy = 'v2', beamWidth = 10 }) {
    if (!['v1', 'v2'].includes(strategy) || !Number.isSafeInteger(beamWidth) || beamWidth < 1) {
        throw new Error('方策名または探索幅が不正です');
    }
    if (!scorer.rankTable?.length) throw new Error('MASTERの評価表が必要です');
    const cards = new PolicyCards(catalog);
    const revised = strategy === 'v2';

    function cardValue(card, obs, others) {
        const id = Number(card.cardNo);
        let value = quality[id] ?? 4;
        const owns = set => others.some(item => set.has(Number(item.cardNo)));
        const cash = obs.stats.accounting;
        if (accountingCards.has(id)) {
            const need = !owns(strongMoney) && cash < 16;
            value += need ? (strongMoney.has(id) ? 6 : 3.5) : cash >= 17 ? -2 : 0;
        }
        if (recruiting.has(id) && !owns(recruiting)) value += 3;
        if (id === 50 && cash < 14) value += 3;
        if ([32, 33, 34, 48, 51].includes(id) && obs.stats.satisfaction < 13) value += 1;
        if (id === 51 && cash < 7) value -= 5;
        if (id === 43 && cash < 10) value -= 3;
        if (revised) {
            if (premiumRecruiting.has(id)) value += obs.stats.experience < obs.turn * 5 + 6 ? 3.5 : 1;
            if (id === 42 || id === 45) value += 2;
            if (id === 50 && cash < 13 && !owns(strongMoney)) value += 6;
            if ([21, 22, 42, 45].includes(id)) value += 1.5;
            if (id === 43 && cash < 14) value -= 2;
        }
        if (others.some(item => item.cardNo === card.cardNo)) value -= 1.2;
        return value;
    }

    function evaluator(obs) {
        const left = obs.config.turns.slice(obs.turn + 1).filter(day => day.type === 'class').length;
        const target = obs.config.withdrawalBase;
        const hasIncome = obs.owned.some(card => strongMoney.has(Number(card.cardNo)));
        const incomeWeight = revised ? (hasIncome ? 1.2 : 2.4) : 1.3;
        const futureIncome = revised ? (hasIncome ? 1.25 : 0.55) : 1.3;
        return sim => {
            const { experience, enrollment, satisfaction, accounting } = sim.player;
            const { passion, fatigue, inspiration, organize } = sim.tokens;
            const lead = Math.min(Math.max(0, experience - enrollment), 10);
            const growth = Math.min(experience, 84) * (revised ? 0.8 : 0.68) + Math.min(enrollment, 70) * 0.98
                + (left > 2 ? lead * (revised ? 0.5 : 0.32) : 0);
            const cash = Math.min(accounting, target) * incomeWeight
                + Math.min(accounting, target + Math.min(left, 4)) * 0.18;
            const satisfactionValue = Math.min(satisfaction, target) * 1.05 + Math.min(satisfaction, 40) * 0.22;
            const shortage = Math.max(0, target - accounting - left * futureIncome)
                + Math.max(0, target - satisfaction - left * 1.8);
            const tokens = left ? (passion - fatigue) * 1.1 + inspiration * 1.4 + organize * 0.35 : 0;
            const smooth = growth + cash + satisfactionValue + tokens - shortage * 4;
            if (!left) return scorer.calculateScore(sim).displayScore * 100 + smooth * 0.01;
            return smooth;
        };
    }

    function simulate(obs) {
        return { player: { ...obs.stats }, tokens: { ...obs.tokens }, turn: obs.turn,
            totalTurns: obs.config.turns.length, difficulty: 'int', config: obs.config, slots: obs.config.slots,
            updateStatus: GameState.prototype.updateStatus };
    }

    function resolve(sim, card, staff, day) {
        const next = { ...sim, player: { ...sim.player }, tokens: { ...sim.tokens } };
        const result = resolveCardAction(cards, next, card, staff, day);
        return result.applied ? next : null;
    }

    function headquarters(obs, card, evaluate = evaluator(obs)) {
        const sim = simulate(obs);
        const choices = obs.config.slots.map(({ id }) => {
            const next = resolve(sim, card, id, obs.config.turns[obs.turn]);
            return { staff: id, value: next ? evaluate(next) - evaluate(sim) : -Infinity };
        });
        return choices.sort((a, b) => b.value - a.value)[0];
    }

    function outing(obs) {
        if (!revised) {
            const option = obs.options.find(item => item.id === 'headquarters') ?? obs.options[0];
            return { kind: 'outing', place: option.id };
        }
        const evaluate = evaluator(obs);
        const estimates = obs.options.map(option => {
            const values = catalog.filter(card => card.rarity === option.rarity).map(card => {
                if (option.id === 'headquarters') return Math.max(0, headquarters(obs, card, evaluate).value);
                const futureUses = obs.turn === 2 ? 1.2 : 1.2 * 0.78;
                return Math.max(0, cardValue(card, obs, obs.owned) - 4.5) * futureUses;
            });
            return { place: option.id, value: expectedPicks(values, option.offerCount, option.pickCount) };
        });
        return { kind: 'outing', place: estimates.sort((a, b) => b.value - a.value)[0].place };
    }

    function acquire(obs) {
        const { offer, owned } = obs;
        const selected = [];
        let worst = Infinity;
        const count = Math.min(offer.pickCount, obs.cards.length);
        for (let pick = 0; pick < count; pick++) {
            const others = owned.concat(selected.map(index => obs.cards[index]));
            const choices = obs.cards.flatMap((card, index) => {
                if (selected.includes(index)) return [];
                const value = offer.id === 'headquarters' ? headquarters(obs, card).value : cardValue(card, obs, others);
                return [{ index, value }];
            });
            const best = choices.sort((a, b) => b.value - a.value)[0];
            selected.push(best.index);
            worst = Math.min(worst, best.value);
        }
        if (count && obs.refreshes > 0 && !offer.allowSkip) {
            const threshold = offer.id === 'headquarters' ? 7 : offer.rarity === 'SSR' ? 10 : offer.rarity === 'R' ? 5 : 7;
            const keepOpening = revised && obs.turn === 0 && selected.some(index =>
                [18, 19, 21, 22, 23, 37, 39, 41].includes(Number(obs.cards[index].cardNo)));
            if (!keepOpening && worst < threshold) return { kind: 'refresh' };
        }
        if (offer.allowSkip && worst < 6) selected.length = 0;
        return { kind: 'acquire', indices: selected };
    }

    function deletion(obs) {
        const remaining = [...obs.owned];
        const pool = [...obs.cards];
        const ids = [];
        while (ids.length < obs.max) {
            const ranked = pool.map(card => ({ card, value: cardValue(card, obs, remaining.filter(item => item.instanceId !== card.instanceId)) }));
            const { card, value } = ranked.sort((a, b) => a.value - b.value)[0];
            if (ids.length >= obs.min && (remaining.length <= 5 || value >= 6)) break;
            ids.push(card.instanceId);
            pool.splice(pool.indexOf(card), 1);
            remaining.splice(remaining.findIndex(item => item.instanceId === card.instanceId), 1);
        }
        return { kind: 'delete', ids };
    }

    function placement(obs) {
        const { hand, config, turn } = obs;
        const slots = config.slots;
        const day = config.turns[turn];
        const placed = Object.fromEntries(slots.map(slot => [slot.id, []]));
        const root = simulate(obs);
        const evaluate = evaluator(obs);
        const initial = { sim: root, placed, moves: [], used: new Set(), value: evaluate(root) };
        let beam = [initial];
        const teaching = new Map(slots.map(({ id }) => [id, config.rules.getSpringTeachingCard(root, cards, id)]));
        function prune(nodes) {
            nodes.sort((a, b) => b.value - a.value || a.moves.length - b.moves.length);
            const seen = new Set();
            return nodes.filter(node => {
                // 同じカード集合でも、解決順によって能力値・講習の教務条件が異なる
                const key = [Array.from(node.used).sort().join(','), ...Object.values(node.sim.player),
                    ...Object.values(node.sim.tokens), ...slots.map(slot => node.placed[slot.id].length)].join('/');
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            }).slice(0, beamWidth);
        }
        for (const slot of slots) {
            const ends = [];
            let layer = beam;
            while (layer.length) {
                const next = [];
                for (const node of layer) {
                    const stack = node.placed[slot.id];
                    const auto = teaching.get(slot.id);
                    const finished = auto && !stack.length ? resolve(node.sim, auto, slot.id, day) : node.sim;
                    const finalSlot = slot === slots.at(-1);
                    if (!finalSlot || !config.rules.getActionValidationError({ ...root, player: { placed: node.placed } })) {
                        ends.push({ ...node, sim: finished, value: evaluate(finished) });
                    }
                    for (let i = 0; i < hand.length; i++) {
                        if (node.used.has(i) || getPlacementError(cards, root, hand[i], slot.id, node.placed)) continue;
                        const sim = resolve(node.sim, hand[i], slot.id, day);
                        if (!sim) continue;
                        const used = new Set(node.used).add(i);
                        const nextPlaced = { ...node.placed, [slot.id]: [...stack, hand[i]] };
                        const moves = [...node.moves, { id: hand[i].instanceId, staff: slot.id }];
                        next.push({ sim, used, placed: nextPlaced, moves, value: evaluate(sim) });
                    }
                }
                layer = prune(next);
            }
            beam = prune(ends);
        }
        return { kind: 'place', moves: beam[0]?.moves ?? [] };
    }

    return function decide(obs) {
        switch (obs.kind) {
        case 'acquire': return acquire(obs);
        case 'place': return placement(obs);
        case 'delete': return deletion(obs);
        case 'staff': return { kind: 'staff', staff: headquarters(obs, obs.card).staff };
        case 'outing': return outing(obs);
        default: throw new Error('未知のMASTER判断種別');
        }
    };
}
