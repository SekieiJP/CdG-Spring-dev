import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerDifficulty, getDifficultyConfig } from '../../game/js/difficultyConfig.js?v=20260815-0052';
import { GameState } from '../../game/js/gameState.js?v=20260815-0052';
import { TurnManager } from '../../game/js/turnManager.js?v=20260815-0052';
import { CardManager } from '../../game/js/cardManager.js?v=20260815-0052';
import { SaveManager } from '../../game/js/saveManager.js?v=20260815-0052';
import { getPlacementError } from '../../game/js/placementRules.js?v=20260815-0052';

const base = getDifficultyConfig('pro');
registerDifficulty({ ...base, id: 'test-mode', name: '検証', turns: base.turns.slice(0, 6),
    slots: [...base.slots, { id: 'coach', name: '補助役', capacity: 1, persistent: true }], cardZones: ['reserve'] });
const card = name => ({ cardName: name, cardNo: name, effect: '体験+1', rarity: 'N', category: '教務' });

test('登録されていない難易度をFRESHとして再開しない', () => assert.throws(() => getDifficultyConfig('unknown')));

test('4番目の配置先・追加の所在・固有状態を保存し、6ターンで終了する', () => {
    const state = new GameState(); state.reset('test-mode');
    state.placeCard(card('持続'), 'coach'); state.player.zones.reserve.push(state.identifyCard(card('予備')));
    state.addToDeck(card('通常')); state.ruleState.counter = 2;
    state.returnAllToDeck();
    assert.equal(state.player.placed.coach.length, 1); assert.equal(state.getOwnedCards().length, 3);
    const save = new SaveManager(); const restored = new GameState();
    save.restoreGameState(restored, save.serializeGameState(state));
    assert.deepEqual(save.serializeGameState(restored), save.serializeGameState(state));
    restored.turn = 5; restored.phase = 'meeting';
    new TurnManager(restored, new CardManager()).advancePhase();
    assert.equal(restored.phase, 'end');
});

test('既存の並行配置を維持し、新しい配置先の容量は独立して判定する', () => {
    const state = new GameState(); state.reset('test-mode'); const cards = new CardManager();
    state.player.placed.leader.push(card('先')); state.player.placed.coach.push(card('持続'));
    const parallel = { ...card('並行'), effect: '体験+1、並行' };
    assert.equal(getPlacementError(cards, state, parallel, 'leader'), null);
    assert.match(getPlacementError(cards, state, parallel, 'coach'), /重ね/);
});

test('解決済みの行動を連打・再開してもカード効果を二重適用しない', () => {
    const state = new GameState(); state.phase = 'action'; state.placeCard(card('基本'), 'leader');
    const turn = new TurnManager(state, new CardManager()); const first = turn.executeActions();
    const value = state.player.experience;
    assert.equal(turn.executeActions(), first); assert.equal(state.player.experience, value);
    const restored = new GameState(); const save = new SaveManager(); save.restoreGameState(restored, save.serializeGameState(state));
    new TurnManager(restored, new CardManager()).executeActions();
    assert.equal(restored.player.experience, value);
});
