import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RandomSource } from '../../game/js/randomSource.js?v=20260815-0052';
import { GameState } from '../../game/js/gameState.js?v=20260815-0052';
import { CardManager } from '../../game/js/cardManager.js?v=20260815-0052';
import { TurnManager } from '../../game/js/turnManager.js?v=20260815-0052';
import { SaveManager } from '../../game/js/saveManager.js?v=20260815-0052';
import { aggregateRecords, comparePaired } from '../../solver/card-evaluation.mjs';

test('乱数系列を分け、中断した位置から同じ乱数列を再開する', () => {
    const first = new RandomSource('seed'); const second = new RandomSource('seed');
    for (let i = 0; i < 30; i++) first.next('training');
    assert.equal(first.next('deck'), second.next('deck'));
    const restored = RandomSource.restore(first.snapshot());
    assert.deepEqual(Array.from({ length: 5 }, () => first.next('training')), Array.from({ length: 5 }, () => restored.next('training')));
});

test('予測は実プレイの乱数と評価ログを消費しない', () => {
    const state = new GameState(); state.reset('pro', { seed: 'seed' }); state.startRecording();
    const turn = new TurnManager(state, new CardManager()); const before = state.rng.snapshot();
    const simulation = turn.createSimulationState(); simulation.rng.next('deck');
    turn.resolveCardAction({ cardName: '試験', effect: '体験+5', category: '動員' }, 'leader', simulation);
    assert.deepEqual(state.rng.snapshot(), before); assert.equal(state.playRecord.events.length, 0);
});

test('候補・取得・ドロー・有効解決と版を分けて集計する', () => {
    const state = new GameState(); state.reset('pro', { seed: 'report' });
    const cards = new CardManager(); const turn = new TurnManager(state, cards);
    cards.allCards = [{ cardNo: '06', cardName: '条件札', category: '動員', rarity: 'R', effect: '〈満足10以上〉体験+5。経理-10' }];
    state.startRecording({ cardVersion: 'test-v1', catalog: cards.allCards }); cards.initTrainingPool();
    const offered = cards.drawTrainingCards('R', 1); state.addToDeck(offered[0]); state.drawCards(1);
    state.placeCard(state.player.hand[0], 'leader'); turn.executeActions();
    const save = new SaveManager(); const restored = new GameState(); save.restoreGameState(restored, save.serializeGameState(state));
    assert.deepEqual(restored.rng.snapshot(), state.rng.snapshot());
    const record = state.exportPlayRecord(); record.result = { score: { displayScore: 7 }, finalDeck: state.getOwnedCards() };
    const row = aggregateRecords([record])[0].cards[0];
    assert.equal(row.offered, 1); assert.equal(row.acquired, 1); assert.equal(row.drawn, 1);
    assert.equal(row.costFailures, 1); assert.equal(row.conditionsMatched, 0); assert.equal(row.applied, 0);
    assert.equal(row.ownedScores.mean, 7); assert.equal(row.usedScores.n, 0);
});

test('差し替え比較はseed・戦略・難易度が同じ完了ゲームを対にする', () => {
    const record = (seed, score, strategy = 'beam') => ({ metadata: { seed, strategy, difficulty: 'pro' }, result: { score: { displayScore: score } } });
    const comparison = comparePaired([record('a', 8), record('b', 9)], [record('a', 10), record('b', 11, 'other')]);
    assert.equal(comparison.paired, 1); assert.equal(comparison.differences.mean, 2);
});
