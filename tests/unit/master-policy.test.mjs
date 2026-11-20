import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../../game/js/gameState.js';
import { CardManager } from '../../game/js/cardManager.js';
import { TurnManager } from '../../game/js/turnManager.js';
import { getPlacementError } from '../../game/js/placementRules.js';
import { createMasterPolicy, observeMaster } from '../../solver/master-policy.mjs';
import { loadMasterRules, playMaster, summarize } from '../../solver/master-benchmark.mjs';

const rules = await loadMasterRules();
const decide = createMasterPolicy(rules);
function game() {
    const state = new GameState();
    state.difficulty = 'int';
    const cards = new CardManager();
    cards.allCards = rules.catalog;
    const turns = new TurnManager(state, cards);
    turns.initializeGame({ seed: 'master-test', runId: 'master-test' });
    return { state, cards, turns };
}

test('下振れは各方策の未丸めの平均を使い、境界に一致したゲームも数える', () => {
    assert.equal(summarize([6, 11, 11, 11, 11]).low, 1);
    assert.equal(summarize([6, 11, 11, 11, 10]).low, 0);
});

test('山札を並べ替え、乱数を進めても同じ公開局面の判断は変わらない', () => {
    const { state, turns } = game();
    state.turn = 2;
    state.phase = 'outing';
    const before = observeMaster(turns);
    const snapshot = state.rng.snapshot();
    const first = decide(before);
    assert.deepEqual(state.rng.snapshot(), snapshot);
    state.player.deck.reverse();
    state.rng.next('deck');
    assert.deepEqual(observeMaster(turns), before);
    assert.deepEqual(decide(observeMaster(turns)), first);
});

test('講習の途中配置から同名カードを区別して合法な完成配置を返す', () => {
    const { state, cards, turns } = game();
    state.turn = 6;
    state.phase = 'action';
    for (const no of [42, 42, 21, 21, 50]) state.addToHand({ ...cards.getCardByNo(no) });
    const previous = state.player.hand.pop();
    state.placeCard(previous, 'teacher');
    const before = structuredClone(state.player);
    const plan = decide(observeMaster(turns));
    assert.deepEqual(state.player, before);
    state.removePlacedCard(previous, 'teacher');
    state.addToHand(previous);
    for (const { id, staff } of plan.moves) {
        const card = state.player.hand.find(item => item.instanceId === id);
        assert.ok(card);
        assert.equal(getPlacementError(cards, state, card, staff), null);
        state.removeFromHand(card);
        state.placeCard(card, staff);
    }
    assert.equal(turns.getActionValidationError(), null);
    turns.executeActions();
    assert.ok(Object.values(state.player.placed).flat().some(card => card.category === '教務'));
});

test('外出先の不足提示・本部の担当者・講習中の削除上限を扱う', () => {
    const { state, cards, turns } = game();
    state.turn = 2;
    state.phase = 'outing';
    state.trainingRefreshRemaining = 0;
    turns.beginOuting('bookstore');
    state.ruleState.int.outing.candidates.length = 1;
    const move = decide(observeMaster(turns));
    assert.deepEqual(move, { kind: 'acquire', indices: [0] });
    turns.selectOutingCard(state.ruleState.int.outing.candidates[0]);
    assert.ok(turns.confirmOutingCards());
    state.turn = 5;
    state.phase = 'outing';
    turns.beginOuting('headquarters');
    state.ruleState.int.outing.candidates = [{ ...cards.getCardByNo(46) }];
    turns.selectOutingCard(state.ruleState.int.outing.candidates[0]);
    turns.confirmOutingCards();
    const staff = decide(observeMaster(turns));
    assert.ok(turns.selectOutingStaff(staff.staff).action.applied);
    state.turn = 6;
    state.phase = 'meeting';
    const discarded = state.player.deck.shift();
    state.ruleState.int.springDiscard = [discarded];
    state.meetingContext = { turn: 6, deleteMax: 1 };
    state.tokens.organize = 0;
    const scene = observeMaster(turns);
    assert.ok(scene.cards.some(card => card.instanceId === discarded.instanceId));
    assert.equal(scene.max, 1);
    assert.ok(decide(scene).ids.length <= 1);
});

test('評価器は候補外の取得と必須削除の見送りを失敗として扱う', () => {
    for (const [kind, illegal] of [
        ['acquire', { kind: 'acquire', indices: [0, 99] }],
        ['delete', { kind: 'delete', ids: [] }]
    ]) {
        assert.throws(() => playMaster('master-test', rules, obs => obs.kind === kind ? illegal : decide(obs)),
            /master-test \/ 0 \/ (training|meeting)/);
    }
});
