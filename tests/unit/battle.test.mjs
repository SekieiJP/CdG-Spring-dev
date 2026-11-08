import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { createCpuReplay } from '../../game/js/cpuOpponent.js?v=20261107-0063';
import { GameState } from '../../game/js/gameState.js?v=20261107-0063';
import { ScoreManager } from '../../game/js/scoreManager.js?v=20261107-0063';
import { SaveManager } from '../../game/js/saveManager.js?v=20261107-0063';
import { buildScorePayload } from '../../game/js/scoreSubmitter.js?v=20261107-0063';
import { cpuTrainingAdvice } from '../../game/js/battleAdvice.js?v=20261107-0063';
import { validateBattleReplay, opponentSnapshot, opponentDeck, opponentFrames, interimScore,
    compareBattleScores, battleSummary } from '../../game/js/battleReplay.js?v=20261107-0063';

globalThis.window = { BUILD_VERSION: 'v20261107-0061' };
globalThis.fetch = async url => new Response(await readFile(fileURLToPath(new URL(url))));

function canonical(event) {
    const result = { turn: event.turn, type: event.type };
    if (event.type === 'resolve') {
        for (const key of ['staff', 'beforeStats', 'afterStats', 'beforeTokens', 'afterTokens', 'applied', 'skippedReason']) result[key] = event[key] ?? null;
        result.cardNo = Number(event.cardNo);
    } else if (['offer', 'refresh', 'draw'].includes(event.type)) {
        Object.assign(result, { rarity: event.rarity ?? null, requested: event.requested ?? null, cards: event.cards.map(card => Number(card.cardNo)) });
    } else result.cardNo = Number(event.card.cardNo);
    return result;
}
let freshRecord;
test('PROの固定V1は基準3プレイの取得・抽選・配置解決・削除・最終得点を再現する', { timeout: 120000 }, async () => {
    const fixture = JSON.parse(await readFile(new URL('../fixtures/cpu-pro-v1-golden.json', import.meta.url)));
    assert.ok(fixture.games.some(game => game.inspiration));
    for (const game of fixture.games) {
        const replay = await createCpuReplay({ difficulty: 'pro', seed: game.seed });
        assert.deepEqual(replay.result.score, game.score, game.seed);
        const events = replay.turns.flatMap(turn => turn.events.map(event => ({ turn: turn.turn, ...event }))).map(canonical);
        assert.deepEqual(events, game.events, game.seed);
        validateBattleReplay(replay);
    }
});

test('固定モデルと8個の方略モジュールを記録した版のまま配信する', async () => {
    const provenance = JSON.parse(await readFile(new URL('../../game/data/cpu/provenance.json', import.meta.url)));
    const sha = bytes => createHash('sha256').update(bytes).digest('hex');
    assert.equal(sha(await readFile(new URL('../../game/data/cpu/pro-public-value-v1.json', import.meta.url))), provenance.modelSha256);
    for (const [name, hash] of Object.entries(provenance.modules)) {
        assert.equal(sha(await readFile(new URL(`../../game/js/cpu/${name}`, import.meta.url))), hash);
    }
    assert.equal(sha(await readFile(new URL('../../game/js/cpu/policyKernel.js', import.meta.url))), provenance.kernelSha256);
});

test('FRESHの独立したCPUを完走でき、再生時は現在ターンのカードを山札としてまとめる', async () => {
    freshRecord = await createCpuReplay({ difficulty: 'fresh', seed: 'battle-fresh-reproducible' });
    validateBattleReplay(freshRecord);
    const battle = { kind: 'cpu', opponent: freshRecord, sameSeed: false };
    const snapshot = opponentSnapshot(battle, 0, 'action');
    assert.deepEqual(snapshot, freshRecord.turns[0].actionStart);
    const cards = opponentDeck(battle, 0, 'action');
    assert.equal(cards.length, snapshot.player.hand.length + snapshot.player.deck.length);
    const expected = [...snapshot.player.deck, ...snapshot.player.hand].map(id => freshRecord.instances[id].cardName);
    assert.deepEqual(cards.map(card => card.cardName), expected);
    assert.notDeepEqual(snapshot.player, freshRecord.result.state.player);
    assert.ok(opponentFrames(freshRecord, 0).length > 0);
    const source = JSON.stringify(freshRecord);
    const player = new GameState(); player.reset('pro'); player.updateStatus('experience', 100);
    assert.equal(JSON.stringify(freshRecord), source);
});

test('CPUのセリフは取得予定の効果を伝え、未解決配置・未来の結果を読まずに選ぶ', async () => {
    const record = structuredClone(freshRecord || await createCpuReplay({ difficulty: 'fresh', seed: 'battle-speech' }));
    record.definitions.cards.push(
        { cardNo: '901', cardName: '体験を補う確認札', rarity: 'R', category: '動員', effect: '体験+4。' },
        { cardNo: '902', cardName: '経理を補う確認札', rarity: 'R', category: '庶務', effect: '経理+4。' }
    );
    const choice = record.turns[0].training.find(boundary => boundary.kind === 'training-choice');
    choice.selected = ['901'];
    const experience = cpuTrainingAdvice(record, 0);
    assert.match(experience.text, /体験/);
    choice.selected = ['902'];
    const accounting = cpuTrainingAdvice(record, 0);
    assert.match(accounting.text, /経理/);
    for (const speech of [experience, accounting]) {
        assert.match(speech.text, /ね$|よ$/);
        assert.doesNotMatch(speech.text, /よう|確認札/);
        assert.ok(Array.from(speech.text).length <= 25);
    }
    const snapshot = JSON.stringify(record);
    cpuTrainingAdvice(record, 0);
    assert.equal(JSON.stringify(record), snapshot);
    record.turns[0].action = null; record.turns[0].actionStart = null;
    record.turns.splice(1); record.result = null;
    assert.deepEqual(cpuTrainingAdvice(record, 0), accounting);
});

test('暫定退塾の基準は1から15へ増え、最終ターンの得点は本来の得点に一致する', async () => {
    const manager = new ScoreManager(null, { migrateHighScore: false });
    for (const difficulty of ['fresh', 'pro']) {
        await manager.loadRankData(new URL(difficulty === 'fresh' ? '../../game/data/rankFresh.csv' : '../../game/data/rankPro.csv', import.meta.url).href);
        const state = { difficulty, event: null, turn: 0, player: { experience: 20, enrollment: 16, satisfaction: 5, accounting: 7 } };
        for (let turn = 0; turn < 8; turn++) {
            const score = interimScore(manager, state, state.player, turn);
            assert.equal(score.withdrawal, Math.max(2 * turn + 1 - 5, 0) + Math.max(2 * turn + 1 - 7, 0));
            assert.equal(score.enrollmentDiff, 16 - score.withdrawal);
        }
        assert.deepEqual(interimScore(manager, state, state.player, 7), manager.calculateScore(state));
    }
});

test('勝敗は最終スコア、入退差、退塾、体験、満足、経理の順で比較する', () => {
    const base = { displayScore: 8, enrollmentDiff: 12, withdrawal: 0, experience: 20, satisfaction: 15, accounting: 15 };
    assert.equal(compareBattleScores(base, base), 'draw');
    for (const [key, delta] of [['displayScore', .1], ['enrollmentDiff', 1], ['withdrawal', -1], ['experience', 1], ['satisfaction', 1], ['accounting', 1]]) {
        assert.equal(compareBattleScores({ ...base, [key]: base[key] + delta }, base), 'win');
        assert.equal(compareBattleScores(base, { ...base, [key]: base[key] + delta }), 'lose');
    }
    assert.equal(compareBattleScores({ ...base, enrollmentDiff: 13, withdrawal: 10 }, base), 'win');
    assert.equal(compareBattleScores({ ...base, withdrawal: 1, experience: 1000 }, base), 'lose');
});

test('中断には相手と公開済み演出位置を保持し、同一シードでも履歴用の勝敗を作れる', async () => {
    const replay = freshRecord || await createCpuReplay({ difficulty: 'fresh', seed: 'battle-save' });
    const state = new GameState(); state.reset('fresh');
    state.battle = { schema: 1, kind: 'replay', sameSeed: true, opponent: replay, animation: { turn: 0, cursor: 1, done: false } };
    const saves = new SaveManager();
    const serialized = JSON.parse(JSON.stringify(saves.serializeGameState(state)));
    const restored = new GameState(); saves.restoreGameState(restored, serialized);
    assert.deepEqual(restored.battle, serialized.battle);
    const stored = [];
    globalThis.localStorage = { getItem: () => null, setItem: (...args) => stored.push(args) };
    const manager = new ScoreManager(null, { migrateHighScore: false });
    assert.equal(manager.saveHighScore(replay.result.score, 'fresh', restored), false);
    assert.equal(stored.length, 0);
    const summary = battleSummary(restored, replay.result.score);
    assert.equal(summary.outcome, 'draw');
    assert.equal(summary.sameSeed, true);
    assert.deepEqual(summary.opponentScore, replay.result.score);
    assert.equal(summary.opponent, undefined);
});

test('対戦の送信は自分の結果だけを含み、現行GASのモード検証を通過する', async () => {
    const replay = freshRecord || await createCpuReplay({ difficulty: 'fresh', seed: 'battle-gas' });
    const receiver = vm.createContext({});
    vm.runInContext(await readFile(new URL('../../gas/scoreReceiver.gs', import.meta.url), 'utf8'), receiver);
    globalThis.document = { cookie: '' };
    globalThis.localStorage = { getItem: () => null, setItem() {} };
    for (const kind of ['replay', 'cpu']) {
        const state = new GameState(); state.reset('fresh'); state.recordStartTime();
        state.battle = { kind, sameSeed: kind === 'replay', opponent: replay };
        const payload = buildScorePayload(state, replay.result.score, replay.result.finalDeck);
        assert.equal(receiver.validatePayload(payload), null);
        assert.equal(payload.mode, '通常');
        assert.equal(payload.battleKind, kind);
        assert.equal(payload.opponent, undefined);
        assert.equal(payload.opponentScore, undefined);
        assert.deepEqual(payload.finalDeck, replay.result.finalDeck.map(card => card.cardName));
    }
});

