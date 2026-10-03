import { CardManager } from './cardManager.js?v=20260815-0054';

/** 公開情報だけを使う、乱数・未来試行を持たない取得評価。検証後に固定した重み。 */
export const ADVISOR_VERSION = 'fresh-formula-v1';
export const PROFILES = Object.freeze({
    balanced: { experience: 2.2, enrollment: 3.0, satisfaction: 2.3, accounting: 2.5, threshold: 7, precision: 2, risk: 1.2, future: .65 },
    safety: { experience: 2.0, enrollment: 2.8, satisfaction: 3.1, accounting: 3.3, threshold: 9, precision: 1, risk: 1.7, future: .55 },
    reach: { experience: 2.8, enrollment: 3.5, satisfaction: 1.9, accounting: 2.1, threshold: 6, precision: 3, risk: .8, future: .8 },
    supply: { experience: 2.3, enrollment: 3.2, satisfaction: 2.5, accounting: 2.7, threshold: 12, precision: 2, risk: 1.3, future: .75 }
});
for (const weights of Object.values(PROFILES)) Object.freeze(weights);
export const DEFAULT_PROFILE = 'reach';
const KEYS = ['experience', 'enrollment', 'satisfaction', 'accounting'];
const NAMES = { experience: '体験', enrollment: '入塾', satisfaction: '満足', accounting: '経理', threshold: 'S条件への補完', precision: 'S到達後の得点', risk: '発動・コストの難しさ' };
const parser = new CardManager(null);
const parsedCache = new Map();
const clamp = (v, low = 0, high = 1) => Math.max(low, Math.min(high, v));
const parsed = card => {
    const text = card.effect || '';
    if (!parsedCache.has(text)) parsedCache.set(text, parser.parseEffect(text));
    return parsedCache.get(text);
};
const identity = card => ({ cardNo: card.cardNo, definitionId: card.definitionId || `card:${card.cardNo}`, cardName: card.cardName,
    category: card.category, rarity: card.rarity, effect: card.effect || '', acquiredTurn: card.acquiredTurn });

/** whitelistで投影し、隠れた順序・seed・個体IDを計算へ渡さない。 */
export function createAdvisorObservation(state, candidates, { pickCount = 1, allowSkip = false } = {}) {
    const owned = state.getOwnedCards ? state.getOwnedCards() : [...(state.player.deck || []), ...(state.player.hand || []),
        ...Object.values(state.player.placed || {}).flat(), ...Object.values(state.player.zones || {}).flat()];
    return { schema: 1, difficulty: state.difficulty, mode: state.calcMode ? 'calculator' : state.event?.enabled ? 'event' : 'normal',
        turn: state.turn, totalTurns: state.totalTurns || 8,
        stats: Object.fromEntries(KEYS.map(key => [key, Number(state.player[key] || 0)])),
        tokens: Object.fromEntries(['passion','fatigue','inspiration','organize'].map(key => [key, Number(state.tokens?.[key] || 0)])),
        owned: owned.map(identity).sort((a,b) => Number(a.cardNo) - Number(b.cardNo) || a.effect.localeCompare(b.effect)),
        candidates: candidates.map(identity), pickCount, allowSkip,
        offers: (state.playRecord?.events || []).filter(event => event.type === 'offer').map(event => ({ rarity: event.rarity, cards: event.cards.map(identity) })),
        turns: (state.config?.turns || []).map(({ recommended, recommendedStatus, training, delete: deletion }) => ({ recommended, recommendedStatus, training, deletion })) };
}

function conditionChance(condition, slot, current, forecast, observation, future) {
    const context = { player: current, turn: observation.turn, totalTurns: observation.totalTurns };
    if (condition.type === 'staff' || condition.type === 'remainingTurns' || condition.type === 'unknown') return Number(parser.evaluateCondition(condition, slot, context));
    const now = Number(parser.evaluateCondition(condition, slot, context));
    if (condition.type === 'status') {
        const end = forecast[condition.status];
        const start = current[condition.status];
        const reach = condition.comparison === 'gte'
            ? clamp((end - condition.value + 1) / Math.max(1, end - start + 1))
            : clamp((condition.value - start + 1) / Math.max(1, end - start + 1));
        return now * (1 - future) + reach * future;
    }
    return now * (1 - future) + Number(parser.evaluateCondition(condition, slot, { ...context, player: forecast })) * future;
}

function vector(card, observation, forecast, weights) {
    const effect = parsed(card);
    const slots = effect.staffRestrictions.length ? effect.staffRestrictions : ['leader','teacher','staff'];
    let best;
    for (const slot of slots) {
        const delta = Object.fromEntries(KEYS.map(key => [key, 0]));
        let risk = 0, token = 0;
        const add = (effects, probability) => {
            for (const item of effects) {
                if (item.type === 'change') { delta[item.status] += item.value * probability; if (item.value < 0) risk += -item.value * probability; }
                if (item.type === 'set') delta[item.status] += (item.value - observation.stats[item.status]) * probability;
                if (item.type === 'token') token += ({ passion: 1.4, fatigue: -1.4, inspiration: 1.2, organize: .8 })[item.token] || 0;
            }
        };
        add(effect.baseEffects, 1);
        for (const block of effect.conditionalBlocks) {
            const chance = conditionChance(block.condition, slot, observation.stats, forecast, observation, weights.future);
            add(block.effects, chance); risk += 1 - chance;
        }
        if ([...effect.baseEffects,...effect.conditionalBlocks.flatMap(block=>block.effects)].some(item=>item.type==='change' && item.value<0)) {
            const now = parser.simulateCardEffect(card,slot,observation.stats,null,observation);
            const later = parser.simulateCardEffect(card,slot,forecast,null,observation);
            const future = observation.totalTurns - observation.turn <= 1 ? 0 : weights.future;
            const affordability = Number(now.applied) * (1-future) + Number(later.applied) * future;
            for (const key of KEYS) delta[key] *= affordability;
            token *= affordability;
            risk += 1-affordability;
        }
        // 期待値上も配置先競合を割り引く。効果値の合計のみで専任カードを過大評価しない。
        const availability = slots.length === 1 ? .82 : 1;
        for (const key of KEYS) delta[key] *= availability;
        const value = KEYS.reduce((sum, key) => sum + delta[key] * weights[key], 0) + token - risk * weights.risk;
        if (!best || value > best.value) best = { delta, risk, token, value, slot };
    }
    return best;
}

function project(cards, observation, weights, forecast) {
    const remaining = Math.max(1, observation.totalTurns - observation.turn);
    const draw = Math.max(0, 4 + observation.tokens.passion - observation.tokens.fatigue);
    const uses = remaining * Math.min(1, draw / Math.max(1, cards.length)) * .75;
    const sums = Object.fromEntries(KEYS.map(key => [key, 0]));
    for (const card of cards) {
        const output = vector(card, observation, forecast, weights);
        for (const key of KEYS) sums[key] += output.delta[key];
    }
    const end = Object.fromEntries(KEYS.map(key => [key, Math.max(0, observation.stats[key] + sums[key] * uses)]));
    end.enrollment = Math.min(end.enrollment, end.experience);
    return { end, uses };
}
const withdrawal = stats => Math.max(0,15-stats.satisfaction) + Math.max(0,15-stats.accounting);
function potential(stats) {
    const diff = stats.enrollment - withdrawal(stats);
    const chance = clamp(stats.experience / 12) * clamp(diff / 12) * clamp((4 - withdrawal(stats)) / 3);
    return { chance, precision: chance * (.5 * clamp((stats.experience - 12) / 18) + 1.5 * clamp((diff - 12) / 18)) };
}
function combinations(n, count, start = 0, prefix = []) {
    if (!count) return [prefix];
    const result = [];
    for (let i=start;i<=n-count;i++) result.push(...combinations(n,count-1,i+1,[...prefix,i]));
    return result;
}

export function recommendAcquisition(observation, { profile = DEFAULT_PROFILE, ablation = null } = {}) {
    if (observation.difficulty !== 'fresh' || observation.mode !== 'normal') return null;
    if (!PROFILES[profile]) throw new Error(`未知の取得評価: ${profile}`);
    if (ablation && !Object.hasOwn(NAMES,ablation)) throw new Error(`未知の評価特徴: ${ablation}`);
    const weights = PROFILES[profile];
    const before = project(observation.owned, observation, weights, observation.stats);
    const forecast = before.end;
    const baseline = potential(forecast);
    const alternatives = combinations(observation.candidates.length, Math.min(observation.pickCount, observation.candidates.length));
    if (observation.allowSkip) alternatives.push([]);
    const evaluations = alternatives.map(indices => {
        const cards = indices.map(index => observation.candidates[index]);
        const after = project([...observation.owned,...cards], observation, weights, forecast);
        const features = {};
        for (const key of KEYS) {
            const target = key === 'experience' || key === 'enrollment' ? 12 : 15;
            const buffer = key === 'satisfaction' || key === 'accounting' ? 1 : 0;
            const useful = value => Math.min(value,target+buffer) + .12 * Math.max(0,value-target-buffer);
            features[key] = useful(after.end[key]) - useful(forecast[key]);
        }
        const goal = potential(after.end);
        features.threshold = goal.chance - baseline.chance;
        features.precision = goal.precision - baseline.precision;
        features.risk = -cards.reduce((sum,card) => sum + vector(card,observation,forecast,weights).risk,0) * .1;
        const contributions = Object.fromEntries(Object.entries(features).map(([key,value]) => [key, key === ablation ? 0 : value * weights[key]]));
        const score = Object.values(contributions).reduce((sum,value) => sum+value,0);
        const reasons = Object.entries(contributions).filter(([,value]) => value > .001).sort((a,b) => b[1]-a[1]).slice(0,2).map(([key]) => NAMES[key]);
        return { indices, cardNos: cards.map(card=>card.cardNo), skip: !indices.length, score, features, contributions,
            forecast: after.end, reasons: reasons.length ? reasons : [indices.length ? '既存デッキとの補完' : 'デッキの希釈を避ける'] };
    }).sort((a,b) => b.score-a.score || a.indices.join(',').localeCompare(b.indices.join(',')));
    return { version: ADVISOR_VERSION, profile, ablation, recommended: evaluations[0] || null, evaluations };
}
