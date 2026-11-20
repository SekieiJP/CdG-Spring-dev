import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { runAhiruBrowser } from './ahiru-browser.mjs';

const count = Number(process.argv[2] || 300);
const workers = Number(process.argv[3] || 6);
if (!Number.isInteger(count) || count < 1 || !Number.isInteger(workers) || workers < 1) {
    throw new Error('開始数と並行数は正の整数で指定してください');
}
const port = 18168;
const origin = 'http://127.0.0.1:' + port;
const seedPrefix = 'cdg-0068-pro-calibration';
const axes = ['experience', 'enrollment', 'satisfaction', 'accounting'];
const output = path.resolve('solver/local-runs/pro-calibration-0068-' + count);
await mkdir(output, { recursive: true });
const journal = path.join(output, 'games.ndjson');
await writeFile(journal, '', { flag: 'wx' });
const server = spawn(process.execPath, ['scripts/test-server.mjs'], {
    env: { ...process.env, CDG_TEST_PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit']
});

let browser, next = 0, completed = 0;
const records = new Array(count);
try {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.once('exit', () => reject(Error('検証サーバーを起動できません')));
        server.stdout.once('data', resolve);
    });
    browser = await chromium.launch({ headless: true });
    async function collect() {
        const context = await browser.newContext({ serviceWorkers: 'block' });
        try {
            await context.route('**/*', route => {
                const url = route.request().url();
                if (url === origin + '/calibration') return route.fulfill({ contentType: 'text/html', body: '<!doctype html>' });
                return url.startsWith(origin + '/') ? route.continue() : route.abort();
            });
            const page = await context.newPage();
            await page.goto(origin + '/calibration');
            for (;;) {
                const index = next++;
                if (index >= count) break;
                const data = await page.evaluate(async ({ seed, axes }) => {
                    window.BUILD_VERSION = 'v20261122-0068';
                    const [{ createCpuReplay }, { validateBattleReplay }] = await Promise.all([
                        import('/js/cpuOpponent.js?v=20261122-0068'), import('/js/battleReplay.js?v=20261122-0068')
                    ]);
                    const record = validateBattleReplay(await createCpuReplay({ difficulty: 'pro', seed, captureViewing: true }));
                    const definitions = new Map(record.definitions.cards.map(card => [card.definitionId, card]));
                    const card = reference => {
                        const raw = typeof reference === 'string' ? record.instances[reference] : definitions.get(reference.definitionId);
                        const { cardNo, cardName, category, rarity, effect, acquiredTurn } = raw;
                        return { cardNo, cardName, category, rarity, effect, acquiredTurn };
                    };
                    const turns = record.definitions.turns.map(({ recommended, recommendedStatus, training, delete: deletion }) =>
                        ({ recommended, recommendedStatus, training, deletion }));
                    const stats = value => Object.fromEntries(axes.map(axis => [axis, value[axis]]));
                    const observation = (before, { pickCount = 1, allowSkip = false } = {}) => ({
                        difficulty: 'pro', mode: 'normal', turn: before.turn, totalTurns: turns.length,
                        stats: stats(before.player), tokens: before.tokens, turns, pickCount, allowSkip,
                        owned: before.player.deck.map(card),
                        candidates: (before.currentTrainingCards || []).map(card)
                    });
                    const decisions = [];
                    for (const turn of record.turns) {
                        const choice = turn.choices.find(entry => ['initial', 'main'].includes(entry.phaseTag));
                        if (!choice) throw new Error('取得判断の記録がありません');
                        decisions.push({ phase: 'acquisition', observation: observation(choice.before, choice),
                            action: { indices: choice.selectedIndices } });
                        if (turn.meetingStart && turn.turn < turns.length - 1) {
                            const before = turn.meetingStart;
                            decisions.push({ phase: 'deletion', observation: observation(before),
                                deleteMax: turns[turn.turn].deletion + (before.tokens.organize || 0),
                                action: { cardNos: turn.meeting.deleted.map(event => event.card.cardNo) } });
                        }
                    }
                    return { decisions, score: record.result.score.displayScore, stats: stats(record.result.score),
                        cardVersion: record.metadata.cardVersion, rankVersion: record.metadata.rankVersion };
                }, { seed: seedPrefix + ':' + index, axes });
                assert.equal(data.decisions.filter(row => row.phase === 'acquisition').length, 8);
                records[index] = data;
                await appendFile(journal, JSON.stringify({ index, ...data }) + '\n');
                if (++completed % 20 === 0 || completed === count) console.log('PRO ' + completed + '/' + count);
            }
        } finally {
            await context.close();
        }
    }
    await Promise.all(Array.from({ length: Math.min(workers, count) }, collect));
} finally {
    await browser?.close();
    server.kill();
}

if (count >= 250) {
    const { cardVersion, rankVersion } = records[0];
    const publicInput = { rows: [] };
    const teachers = { outcomes: [], labels: [] };
    for (const [gameId, record] of records.entries()) {
        assert.equal(record.cardVersion, cardVersion);
        assert.equal(record.rankVersion, rankVersion);
        teachers.outcomes.push({ gameId, score: record.score, stats: record.stats });
        for (const [index, { action, ...decision }] of record.decisions.entries()) {
            const rowId = gameId + ':' + index;
            publicInput.rows.push({ rowId, gameId, ...decision });
            teachers.labels.push({ rowId, action });
        }
    }
    const sha = bytes => createHash('sha256').update(bytes).digest('hex');
    const versions = { cardVersion, rankVersion };
    assert.equal(cardVersion, 'sha256:' + sha(await readFile('game/data/cards_pro.csv')));
    const fitted = await runAhiruBrowser({ difficulty: 'pro', publicInput, teachers, versions }, {
        port: 19168, modulePath: '/solver/browser/ahiru-calibration.js', exportName: 'fitAhiruCalibration'
    });
    const data = {
        schema: 1, difficulty: 'pro', status: 'development-calibration-not-yet-validated', axes,
        sourceGames: fitted.sourceGames, ...versions, sourceActor: 'fixed-pro-v1', sourceSeedPrefix: seedPrefix,
        sourcePublicSha256: sha(JSON.stringify(publicInput)),
        interpretation: '現行カード表で完走した固定方略の最終値と、取得・削除時の投影との差の分位値。',
        phases: fitted.phases
    };
    await writeFile(path.join(output, 'pro-projection-calibration.json'), JSON.stringify(data, null, 2) + '\n');
    console.log(JSON.stringify({ sourceGames: data.sourceGames, support: fitted.support, output }));
}
