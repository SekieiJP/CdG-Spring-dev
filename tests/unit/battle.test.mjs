import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { gzipSync, gunzipSync } from 'node:zlib';
import { encodeReplay, decodeReplay, REPLAY_PREFIX, COMPACT_REPLAY_PREFIX } from '../../game/js/replayCodec.js?v=20261107-0064';
import { createCpuReplay } from '../../game/js/cpuOpponent.js?v=20261107-0064';
import { GameState } from '../../game/js/gameState.js?v=20261107-0064';
import { ScoreManager } from '../../game/js/scoreManager.js?v=20261107-0064';
import { SaveManager } from '../../game/js/saveManager.js?v=20261107-0064';
import { buildScorePayload } from '../../game/js/scoreSubmitter.js?v=20261107-0064';
import { cpuTrainingAdvice, cpuMeetingAdvice } from '../../game/js/battleAdvice.js?v=20261107-0064';
import { validateBattleReplay, opponentSnapshot, opponentDeck, opponentFrames, interimScore,
    compareBattleScores, battleSummary } from '../../game/js/battleReplay.js?v=20261107-0064';

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
test('短縮リプレイは全ターンの公開状態・演出・得点を保ち、元の記録を変更しない', async () => {
    const record = freshRecord || await createCpuReplay({ difficulty: 'fresh', seed: 'sekiei-compact-replay' });
    const before = JSON.stringify(record), text = await encodeReplay(record);
    assert.ok(text.startsWith(COMPACT_REPLAY_PREFIX));
    assert.ok(text.length < REPLAY_PREFIX.length + gzipSync(before).toString('base64url').length);
    assert.throws(() => new URL(text), TypeError);
    const restored = validateBattleReplay(await decodeReplay(text, { currentBuildVersion: 'v20261107-0064' }));
    assert.equal(JSON.stringify(record), before);
    assert.deepEqual(restored.metadata, record.metadata);
    assert.deepEqual(restored.result.score, record.result.score);
    assert.deepEqual(restored.result.finalDeck, record.result.finalDeck);
    const originalBattle = { opponent: record }, restoredBattle = { opponent: restored };
    for (let turn = 0; turn < record.turns.length; turn++) {
        for (const phase of ['training', 'action', 'meeting']) {
            assert.deepEqual(opponentSnapshot(restoredBattle, turn, phase).player, opponentSnapshot(originalBattle, turn, phase).player);
            assert.deepEqual(opponentDeck(restoredBattle, turn, phase), opponentDeck(originalBattle, turn, phase));
        }
        assert.deepEqual(opponentFrames(restored, turn), opponentFrames(record, turn));
    }
});

test('URLとして小文字化された旧形式の先頭を受け付け、本文の大小文字は変更しない', async () => {
    const record = freshRecord || await createCpuReplay({ difficulty: 'fresh', seed: 'sekiei-url-replay' });
    const original = REPLAY_PREFIX + gzipSync(JSON.stringify(record)).toString('base64url');
    const normalizedAsURL = new URL(original).href;
    assert.ok(normalizedAsURL.startsWith('cdgr1:'));
    assert.deepEqual(await decodeReplay(normalizedAsURL), JSON.parse(JSON.stringify(record)));
    await assert.rejects(decodeReplay(original.toLowerCase()), /壊れて|形式/);
    const compact = await encodeReplay(record);
    assert.deepEqual(await decodeReplay(compact.replace(/^CDGR2\./, 'cdgr2.')), await decodeReplay(compact));
});

test('短縮形式の参照切れと、参照展開によるサイズ超過を拒否する', async () => {
    const record = freshRecord || await createCpuReplay({ difficulty: 'fresh', seed: 'sekiei-bounded-replay' });
    const text = await encodeReplay(record);
    const unpacked = gunzipSync(Buffer.from(text.slice(COMPACT_REPLAY_PREFIX.length), 'base64url'));
    await assert.rejects(decodeReplay(text, { maxDecodedBytes: unpacked.length + 1 }), /大きすぎ/);
    const packet = JSON.parse(unpacked);
    packet[5] = packet[4].length;
    await assert.rejects(decodeReplay(COMPACT_REPLAY_PREFIX + gzipSync(JSON.stringify(packet)).toString('base64url')), /壊れて/);
});

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

test('会議のセリフは実際に削除する札と会議開始時点の見通しだけで説明する', async () => {
    const record = structuredClone(freshRecord || await createCpuReplay({ difficulty: 'fresh', seed: 'battle-meeting-speech' }));
    const turn = record.turns[2];
    record.instances['meeting-accounting'] = { cardNo: '901', instanceId: 'meeting-accounting', cardName: '会議の経理確認札',
        rarity: 'N', category: '庶務', effect: '経理+1。', acquiredTurn: 0 };
    record.instances['meeting-experience'] = { cardNo: '902', instanceId: 'meeting-experience', cardName: '会議の体験確認札',
        rarity: 'N', category: '動員', effect: '体験+1。', acquiredTurn: 0 };
    turn.meetingStart.player = { experience: 80, enrollment: 40, satisfaction: 40, accounting: 40,
        deck: ['meeting-experience', 'meeting-accounting'], hand: [], placed: {}, zones: {} };
    turn.meeting.deleted = [{ type: 'delete', card: { instanceId: 'meeting-accounting' } }];
    const accounting = cpuMeetingAdvice(record, 2);
    assert.match(accounting.text, /経理は足りそう。庶務を1枚/);
    turn.meeting.deleted[0].card.instanceId = 'meeting-experience';
    const experience = cpuMeetingAdvice(record, 2);
    assert.match(experience.text, /体験は足りそう。動員を1枚/);
    for (const speech of [accounting, experience]) {
        assert.ok(Array.from(speech.text).length <= 25);
        assert.match(speech.text, /ね$|よ$/);
        assert.doesNotMatch(speech.text, /確認札/);
    }
    const source = JSON.stringify(record);
    cpuMeetingAdvice(record, 2);
    assert.equal(JSON.stringify(record), source);
    turn.meetingStart.player.deck.reverse();
    Object.defineProperty(record, 'result', { get() { throw new Error('最終結果は参照できません'); } });
    Object.defineProperty(turn.meeting, 'after', { get() { throw new Error('削除後の実状態は参照できません'); } });
    record.turns.splice(3);
    assert.deepEqual(cpuMeetingAdvice(record, 2), experience);
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

