import { STATUS_KEYS } from './actionResolver.js?v=20261122-0070';
import { freshAdviceScore } from './ahiruFreshGoals.js?v=20261122-0070';
import { PROFILES as FRESH_PROFILES } from './freshAcquisitionAdvisor.js?v=20261122-0070';
import { projectProDeck, withdrawal } from './proAcquisitionAdvisor.js?v=20261122-0070';

export const FORECAST_MODEL = 'draw-forecast-v1';

export function evaluateForecast(observation, cards, conditions = observation.stats) {
    const weights = FRESH_PROFILES.reach;
    const { end, draw, outputs } = projectProDeck(observation, { weights, cards, forecast: conditions });
    const turnsLeft = observation.totalTurns - observation.turn;
    const size = outputs.length;
    const sampleFactor = size > 1 ? turnsLeft * draw * Math.max(0, size - draw) / (size - 1) : 0;

    // そのターンの手札は非復元抽出。有限母集団の分散で、少数の札に依存した伸びを割り引く
    const cautious = Object.fromEntries(STATUS_KEYS.map(axis => {
        const average = outputs.reduce((sum, output) => sum + output.delta[axis], 0) / Math.max(1, size);
        const variance = outputs.reduce((sum, output) => sum + (output.delta[axis] - average) ** 2, 0) / Math.max(1, size);
        const spread = Math.sqrt(sampleFactor * variance);
        return [axis, Math.max(0, end[axis] - 0.65 * spread)];
    }));
    cautious.enrollment = Math.min(cautious.experience, cautious.enrollment);

    function value(stats) {
        const churn = withdrawal(stats);
        const rounded = Object.fromEntries(STATUS_KEYS.map(axis => [axis, Math.floor(stats[axis])]));
        const score = freshAdviceScore(rounded);
        return score.smoothPoints
            - 0.3 * Math.max(0, churn - 1)
            - 0.16 * Math.max(0, 12 - score.enrollmentDiff)
            - 0.08 * Math.max(0, 12 - stats.experience);
    }

    const mean = value(end);
    const downside = value(cautious);
    return { end, cautious, mean, downside, value: 0.6 * mean + 0.4 * downside };
}

export function chooseFreshForecastAcquisition(observation, advice, original = advice?.recommended?.indices) {
    if (observation.mode !== 'normal' || !original || advice.evaluations.length < 2) return null;
    const baseline = advice.evaluations.findIndex(row =>
        row.indices.length === original.length && original.every(index => row.indices.includes(index)));
    if (baseline === -1) return null;
    const forecasts = advice.evaluations.map(row => evaluateForecast(observation,
        [...observation.owned, ...row.indices.map(index => observation.candidates[index])], row.forecast));
    const preferred = forecasts[baseline];
    const alternative = advice.evaluations
        .map((row, index) => ({ row, forecast: forecasts[index], score: row.score + 3.2 * (forecasts[index].value - forecasts[0].value) }))
        .sort((a, b) => b.score - a.score)
        .find(({ forecast }) => forecast.downside >= preferred.downside + 0.6 &&
            forecast.mean >= preferred.mean - 0.35);
    return alternative?.row || null;
}
