import assert from 'node:assert/strict';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { loadMasterRules, playMaster } from './master-benchmark.mjs';
import { createMasterPolicy } from './master-policy.mjs';

const grid = [{}];
for (const springReserve of [0.5, 0.9, 1.25, 1.65, 2.2]) {
    for (const latePoints of [0, 0.75, 1.5, 2.5]) {
        grid.push({ springReserve, latePoints });
    }
}
grid.push({ latePoints: 2.5 }, { springReserve: 1.25, latePoints: 1.5, experienceBias: 1 },
    { springReserve: 0.9, latePoints: 1.5, experienceBias: 1 },
    { springReserve: 1.25, latePoints: 1.5, experienceBias: -1 });

function summarize(scores, base) {
    const count = scores.length;
    const total = scores.reduce((sum, score) => sum + score, 0);
    const mean = total / count;
    const low = scores.filter(score => (score + 2) * count <= total).length;
    const high = scores.filter(score => score >= 16).length;
    return { count, mean, low, lowRate: low / count, threshold: mean - 2, high, highRate: high / count,
        commonLow: scores.filter(score => score <= base).length };
}

if (isMainThread) {
    const [split = 'tuning', countArg = '1000', ...choices] = process.argv.slice(2);
    const count = Number(countArg);
    assert.ok(Number.isSafeInteger(count) && count > 0);
    const options = choices.length ? [{}, ...choices.map(value => JSON.parse(value))] : grid;
    const workers = Array.from({ length: Math.min(count, 6) }, (_, first) => new Worker(new URL(import.meta.url), {
        workerData: { first, count, split, options, stride: Math.min(count, 6) }
    }));
    const scoreRows = await Promise.all(workers.map(handle => new Promise((resolve, reject) => {
        handle.once('message', resolve);
        handle.once('error', reject);
        handle.once('exit', code => { if (code) reject(Error('worker exit ' + code)); });
    })));
    const baseline = summarize(scoreRows.flatMap(row => row[0]));
    console.log(JSON.stringify({ split, count, rows: options.map((configuration, index) => {
        const stats = summarize(scoreRows.flatMap(row => row[index]), baseline.threshold);
        return { configuration, ...stats, improved: stats.mean > baseline.mean &&
            stats.lowRate < baseline.lowRate && stats.highRate > baseline.highRate };
    }).sort((a, b) => b.mean - a.mean) }, null, 2));
} else {
    const { first, count, split, options, stride } = workerData;
    const rules = await loadMasterRules();
    const rows = options.map(options => {
        const decide = createMasterPolicy({ ...rules, ...options });
        const scores = [];
        for (let index = first; index < count; index += stride) {
            scores.push(playMaster('master/0070/' + split + '/' + index, rules, decide).score.displayScore);
        }
        return scores;
    });
    parentPort.postMessage(rows);
}
