import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnimationClock } from '../../game/js/animationClock.js?v=20260815-0060';
test('現在のカードだけ省略し、次のカードの待機を維持する', async () => {
    const clock = new AnimationClock(); clock.start(); clock.beginCard();
    const pending = clock.wait(10000); clock.skipCard(); await pending;
    await clock.wait(10000); assert.equal(clock.waiters.size, 0);
    clock.beginCard(); const next = clock.wait(10000); assert.equal(clock.waiters.size, 1);
    clock.finish(); await next;
});
test('1枚の省略を次ターンへ持ち越さず、全体省略の入口を持たない', async () => {
    const clock = new AnimationClock(); clock.start(); clock.beginCard(); clock.skipCard();
    await clock.wait(10000); assert.equal(clock.waiters.size, 0);
    clock.finish(); clock.start(); const next = clock.wait(10000); assert.equal(clock.waiters.size, 1);
    assert.equal(clock.skipTurn, undefined);
    clock.finish(); await next;
});
