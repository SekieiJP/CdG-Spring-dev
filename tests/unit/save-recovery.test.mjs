import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../../game/js/gameState.js?v=20260815-0051';
import { CardManager } from '../../game/js/cardManager.js?v=20260815-0051';
import { SaveManager } from '../../game/js/saveManager.js?v=20260815-0051';

const card = (no, name) => ({ category: '動員', rarity: 'R', cardNo: String(no), cardName: name, effect: '体験+1', topEffect: '' });
const roundTrip = value => JSON.parse(JSON.stringify(value));

test('保存は上8桁だけで互換判定し、全難易度で同じ保存キーを使う', () => {
    globalThis.window = { BUILD_VERSION: 'v20260815-0100' };
    const manager = new SaveManager();
    assert.equal(manager.isVersionMatch({ buildVersion: 'v20260815-0050' }), true);
    assert.equal(manager.isVersionMatch({ buildVersion: 'v20260816-0100' }), false);
    assert.equal(manager.isVersionMatch({ buildVersion: 'unknown' }), false);
    assert.equal(SaveManager.SAVE_KEY, 'cdg_save_data');
});

test('中断後も削除履歴、配置、トークン、研修の使用済みプールを引き継ぐ', () => {
    const state = new GameState();
    state.reset('pro');
    state.turn = 3; state.phase = 'training';
    state.discardedCards = ['削除済み'];
    state.trainingRefreshRemaining = 2; state.trainingRefreshPhaseStartRemaining = 3;
    state.tokens.organize = 1;
    state.player.placed.teacher = [card(1, '配置済み')];
    const cards = new CardManager();
    cards.allCards = [card(2, '候補A'), card(3, '候補B')];
    cards.initTrainingPool();
    state.currentTrainingCards = cards.drawTrainingCards('R', 2);
    const save = new SaveManager();
    const saved = roundTrip({ state: save.serializeGameState(state), decks: save.serializeTrainingDecks(cards), discards: save.serializeTrainingDiscards(cards) });
    const restored = new GameState(); const restoredCards = new CardManager();
    save.restoreGameState(restored, saved.state);
    save.restoreTrainingDecks(restoredCards, saved.decks, saved.discards);
    assert.deepEqual(save.serializeGameState(restored), save.serializeGameState(state));
    assert.deepEqual(restoredCards.trainingDiscards, cards.trainingDiscards);
    restoredCards.trainingDecks.R = [];
    assert.deepEqual(new Set(restoredCards.drawTrainingCards('R', 2).map(c => c.cardName)), new Set(['候補A', '候補B']));
});

test('リフレッシュはコピー／再開後の候補も1枚ずつ永久除外する', () => {
    const cards = new CardManager(); cards.allCards = [card(2, 'A'), card(3, 'B')]; cards.initTrainingPool();
    const offered = roundTrip(cards.drawTrainingCards('R', 2));
    const ids = new Set(offered.map(c => c.poolId));
    cards.refreshTrainingCards('R', offered, 2);
    assert.equal([...cards.trainingDecks.R, ...cards.trainingDiscards.R].length, 2);
    assert.equal(cards.trainingDiscards.R.some(c => ids.has(c.poolId)), false);
});

test('旧形式のセーブも不足項目を空の履歴として再開する', () => {
    const save = new SaveManager(); const old = save.serializeGameState(new GameState());
    delete old.discardedCards; delete old.trainingRefreshPhaseStartRemaining;
    const state = new GameState(); state.discardedCards = ['前ゲーム']; state.currentTrainingCards = [card(1, '前候補')];
    save.restoreGameState(state, roundTrip(old));
    assert.deepEqual(state.discardedCards, []); assert.equal(state.currentTrainingCards, null);
    const cards = new CardManager(); save.restoreTrainingDecks(cards, {});
    assert.deepEqual(cards.trainingDiscards, { R: [], SR: [], SSR: [] });
});
