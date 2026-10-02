import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../../game/js/gameState.js';
import { CardManager } from '../../game/js/cardManager.js';
import { TurnManager } from '../../game/js/turnManager.js';

const makeCard = effect => ({ category: '動員', cardName: '検証', effect });

test('配置制限違反・空効果の予測も無効になり、おすすめが加算されない', () => {
    const state = new GameState(); const turn = new TurnManager(state, new CardManager());
    for (const effect of ['【講師】体験+5', '']) {
        const result = turn.resolveCardAction(makeCard(effect), 'leader');
        assert.equal(result.applied, false);
        assert.equal(result.recommendedApplied, false);
    }
    assert.equal(state.player.experience, 0);
});

test('おすすめの+1でコスト不足を回避させず、無効ならボーナスも付けない', () => {
    const state = new GameState(); const cards = new CardManager(); const turn = new TurnManager(state, cards);
    const result = turn.resolveCardAction(makeCard('体験-1、満足+8'), 'leader');
    assert.equal(result.applied, false); assert.equal(result.recommendedApplied, false);
    assert.equal(state.player.experience, 0); assert.equal(state.player.satisfaction, 3);
});

test('条件はおすすめを加える前に判定し、後続のカードは前カードの結果で判定する', () => {
    const state = new GameState(); const turn = new TurnManager(state, new CardManager());
    const first = turn.resolveCardAction(makeCard('体験+2、〈体験3以上〉満足+9'), 'leader');
    assert.equal(first.afterStats.experience, 3); assert.equal(first.afterStats.satisfaction, 3);
    const second = turn.resolveCardAction(makeCard('〈体験3以上〉満足+9'), 'teacher');
    assert.equal(second.afterStats.satisfaction, 12);
});

test('残りターン条件を含む解決は本体と探索用の状態で一致する', () => {
    const state = new GameState(); state.turn = 6;
    const turn = new TurnManager(state, new CardManager());
    const simulation = new GameState(); simulation.turn = state.turn;
    const candidate = { category: '応対', cardName: '残り', effect: '〈残り3ターン以上〉満足+10' };
    assert.deepEqual(turn.resolveCardAction(candidate, 'leader', simulation), turn.resolveCardAction(candidate, 'leader'));
    assert.equal(state.player.satisfaction, 3);
});
