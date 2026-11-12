import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CardManager } from '../../game/js/cardManager.js?v=20261110-0066';
import { GameState } from '../../game/js/gameState.js?v=20261110-0066';
import { ScoreManager } from '../../game/js/scoreManager.js?v=20261110-0066';
import { buildScorePayload } from '../../game/js/scoreSubmitter.js?v=20261110-0066';

async function game(difficulty = 'pro') {
    const state = new GameState(); state.reset(difficulty, { seed: 'sekiei-training-sequence' });
    const manager = new CardManager(); manager.gameState = state;
    manager.parseCSV(await readFile(new URL(`../../game/data/cards_${difficulty}.csv`, import.meta.url), 'utf8'));
    manager.initTrainingPool();
    return { state, manager };
}
const identities = cards => cards.map(card => card.poolId);

test('リフレッシュは次の同レアリティ研修の候補を引き、発想研修も同じSRの順序を使う', async () => {
    const a = await game(), b = await game();
    assert.deepEqual(a.manager.trainingDecks, b.manager.trainingDecks);
    a.state.turn = b.state.turn = 1;
    const firstA = a.manager.drawTrainingCards('SR', 3), firstB = b.manager.drawTrainingCards('SR', 3);
    a.state.addToDeck({ ...firstA[0] }); b.state.addToDeck({ ...firstB[1] });
    const refreshed = a.manager.refreshTrainingCards('SR', firstA, 3);
    b.state.turn = 5;
    assert.deepEqual(identities(refreshed), identities(b.manager.drawTrainingCards('SR', 3)));
    a.state.trainingSelectionMode = 'inspiration'; b.state.turn = 6;
    assert.deepEqual(identities(a.manager.drawTrainingCards('SR', 3)), identities(b.manager.drawTrainingCards('SR', 3)));
    assert.ok(a.manager.trainingDecks.SR.length > 0);
});

test('同名の個体を次の提示へ繰り越し、全個体を引くまで再シャッフルしない', () => {
    const manager = new CardManager(); let randomCalls = 0;
    manager.random = () => { randomCalls++; return 0.5; };
    const cards = ['A', 'A', 'B', 'B', 'C', 'C'].map((cardName, i) => ({ cardName, rarity: 'R', poolId: String(i) }));
    manager.trainingDecks.R = cards.slice(); manager.trainingDiscards = { R: [] };
    assert.deepEqual(identities(manager.drawTrainingCards('R', 3)), ['0', '2', '4']);
    assert.deepEqual(identities(manager.drawTrainingCards('R', 3)), ['1', '3', '5']);
    assert.equal(randomCalls, 0);
    const next = manager.drawTrainingCards('R', 3);
    assert.equal(next.length, 3); assert.equal(new Set(next.map(c => c.cardName)).size, 3);
    assert.ok(randomCalls > 0);
    manager.trainingDecks.R = cards.slice(0, 2); manager.trainingDiscards.R = [];
    const before = randomCalls;
    assert.deepEqual(identities(manager.drawTrainingCards('R', 3)), ['0']);
    assert.equal(randomCalls, before);
    assert.deepEqual(identities(manager.drawTrainingCards('R', 1)), ['1']);
});

test('CPU同一シードは自己ベストと送信の対象とし、リプレイ同一シードだけ自己ベストから除く', () => {
    const storage = new Map();
    globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) };
    globalThis.document = { cookie: '' };
    const manager = new ScoreManager(); const state = new GameState();
    const score = manager.calculateScore(state);
    state.battle = { kind: 'replay', sameSeed: true };
    assert.equal(manager.saveHighScore(score, 'fresh', state), false);
    assert.equal(storage.size, 0);
    state.battle = { kind: 'cpu', sameSeed: true };
    assert.equal(manager.saveHighScore(score, 'fresh', state), true);
    const payload = buildScorePayload(state, score, []);
    assert.equal(payload.battleKind, 'cpu'); assert.equal(payload.sameSeed, true);
    assert.equal(payload.displayScore, score.displayScore);
});
