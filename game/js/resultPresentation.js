const METRICS = [
    { key: 'enrollmentDiff', label: '入退差', pointsKey: 'enrollmentDiffPoints', colors: ['--result-gold-top', '--result-gold-bottom'] },
    { key: 'withdrawal', label: '退塾 ↓', pointsKey: 'withdrawalPoints', colors: ['--result-red-top', '--result-red-bottom'] },
    { key: 'experience', label: '体験', pointsKey: 'mobilizationPoints', colors: ['--color-mobilization'] },
    { key: 'satisfaction', label: '満足', pointsKey: 'satisfactionPoints', colors: ['--color-response'] },
    { key: 'accounting', label: '経理', colors: ['--color-affairs'] },
    { key: 'enrollment', label: '入塾', colors: ['--color-teaching'] }
];

const RARITY_ORDER = { SSR: 0, SR: 1, R: 2, N: 3 };

export function resultMetrics(score) {
    return METRICS.map(metric => ({
        ...metric,
        value: metric.key === 'experience' ? score.experience ?? score.mobilization : score[metric.key],
        points: score.breakdown?.[metric.pointsKey],
        overflow: score.overflow?.[metric.key] ?? 0
    }));
}

export function sortResultDeck(cards) {
    return [...(cards || [])].sort((a, b) =>
        (RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9)
        || String(a.category || '').localeCompare(String(b.category || ''), 'ja'));
}

export function formatResultNumber(value) {
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? String(value) : '—';
}

export function formatResultPoints(value) {
    const number = formatResultNumber(value);
    return number === '—' ? number : `${Number(number) > 0 ? '+' : ''}${number}点`;
}

export function resultPrecisionText(score) {
    if (!score.splusBreakdown) return '';
    const total = Number(score.displayScore) - Number(score.points);
    return `精度加点 +${total.toFixed(1)}点`;
}

export function resultRulesEpoch(summary) {
    return String(summary.buildVersion || '').match(/\d{8}/)?.[0]
        || String(summary.rulesVersion || '').match(/\d{8}/)?.[0] || '—';
}
