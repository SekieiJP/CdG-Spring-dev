import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnimationClock } from '../../game/js/animationClock.js?v=20260815-0052';
test('現在のカードだけ省略し、次のカードの待機を維持する', async () => {
    const clock = new AnimationClock(); clock.start(); clock.beginCard();
    const pending = clock.wait(10000); clock.skipCard(); await pending;
    await clock.wait(10000); assert.equal(clock.waiters.size, 0);
    clock.beginCard(); const next = clock.wait(10000); assert.equal(clock.waiters.size, 1);
    clock.finish(); await next;
});
test('まとめて省略しても次ターンの通常速度へ戻る', async () => {
    const clock = new AnimationClock(); clock.start(); clock.skipTurn(); clock.beginCard();
    await clock.wait(10000); assert.equal(clock.waiters.size, 0);
    clock.finish(); clock.start(); const next = clock.wait(10000); assert.equal(clock.waiters.size, 1);
    clock.finish(); await next;
});
