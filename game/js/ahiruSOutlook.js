import { STATUS_KEYS, snapshotStats } from './actionResolver.js?v=20261122-0070';
import { getDifficultyConfig } from './difficultyConfig.js?v=20261122-0070';
import { getFreshSGoals, scoreFreshStats } from './ahiruFreshGoals.js?v=20261122-0070';
import { getProSGoals } from './ahiruProGoals.js?v=20261122-0070';
import { projectProDeck, proGoal } from './proAcquisitionAdvisor.js?v=20261122-0070';
import { S_MODELS } from './ahiruSModel.js?v=20261122-0070';

const LABELS = { experience: '体験', enrollment: '入塾', satisfaction: '満足', accounting: '経理' };
const TOKENS = ['passion', 'fatigue', 'inspiration', 'organize'];
const comparableCard = (a, b) => Number(a.cardNo) - Number(b.cardNo) || (a.effect || '').localeCompare(b.effect || '');

export function outlookObservation(state, rankTable) {
    return { difficulty: state.difficulty, turn: state.turn, stats: snapshotStats(state.player), rankTable,
        tokens: state.tokens, owned: state.getOwnedCards(), mode: state.event?.enabled ? 'event' : 'normal' };
}

export function sOutlookFeatures(observation, phase) {
    const { difficulty, rankTable, stats, turn } = observation;
    const goals = difficulty === 'fresh' ? getFreshSGoals(rankTable) : getProSGoals(rankTable);
    if (!goals?.routes.length) return null;
    const turns = getDifficultyConfig(difficulty).turns;
    const next = turn + Number(phase === 'meeting');
    const forecastTurns = turns.filter(day => day.type !== 'outing');
    const forecastTurn = turns.slice(0, next).filter(day => day.type !== 'outing').length;
    const remaining = forecastTurns.length - forecastTurn;
    const owned = [...observation.owned].sort(comparableCard);
    const tokens = Object.fromEntries(TOKENS.map(token => [token, observation.tokens?.[token] || 0]));
    if (phase === 'action') { tokens.passion = 0; tokens.fatigue = 0; }
    const forecast = { ...observation, tokens, owned, turns: forecastTurns,
        turn: forecastTurn, totalTurns: forecastTurns.length };
    const first = projectProDeck(forecast);
    const { end, draw, engine } = projectProDeck(forecast, { forecast: first.end });
    const ratio = (axis, value) => Math.min(2, value / Math.max(1, goals.sThresholds[axis]));
    const deficits = route => STATUS_KEYS.map(axis => Math.max(0, route[axis] - end[axis]) / Math.max(1, route[axis]));
    const closest = goals.routes.map(route => ({ route, shortages: deficits(route) }))
        .sort((a, b) => a.shortages.reduce((sum, x) => sum + x, 0) -
            b.shortages.reduce((sum, x) => sum + x, 0))[0];
    const weakest = Math.max(...closest.shortages);
    const shortfall = weakest > 0 ? STATUS_KEYS[closest.shortages.indexOf(weakest)]
        : [...STATUS_KEYS].sort((a, b) => end[a] / Math.max(1, closest.route[a]) - end[b] / Math.max(1, closest.route[b]))[0];
    const features = [remaining / forecastTurns.length,
        ...STATUS_KEYS.map(axis => ratio(axis, stats[axis])),
        ...STATUS_KEYS.map(axis => ratio(axis, end[axis])),
        Math.min(1, owned.length / 20), draw / 6, engine / Math.max(1, remaining),
        Number(phase === 'action'), Number(phase === 'outing')];
    return { features, shortfall, remaining, goal: goals.targetPoints };
}

export function applySModel(features, model) {
    const z = features.reduce((sum, value, index) =>
        sum + model.weights[index] * (value - model.centers[index]) / model.scales[index], model.bias);
    return 1 / (1 + Math.exp(-z));
}

export function estimateSOutlook(observation, phase) {
    const model = S_MODELS[observation.difficulty];
    const scene = sOutlookFeatures(observation, phase);
    if (!scene || !model) return null;
    const probability = scene.remaining ? applySModel(scene.features, model) : Number(
        (observation.difficulty === 'fresh' ? scoreFreshStats(observation.stats, { event: observation.mode === 'event' }).points
            : proGoal(observation.stats, observation.rankTable).points) >= scene.goal
    );
    return { probability, tone: probability >= 0.85 ? 'green' : probability <= 0.4 ? 'red' : 'yellow',
        shortfall: scene.shortfall };
}

export function withSOutlook(status, outlook) {
    if (!status || !outlook) return status;
    const label = LABELS[outlook.shortfall];
    const warning = outlook.tone === 'red' ? `${label}が不足。 ` : `${label}が不足気味。 `;
    const alreadyWarns = status.text.includes(`${label}が不足`) || status.text.includes(`${label}が心配`);
    const text = outlook.tone === 'green' || alreadyWarns ? status.text
        : Array.from(warning + status.text).length <= 25 ? warning + status.text : warning.trim();
    return { ...status, tone: outlook.tone, text, outlook };
}
