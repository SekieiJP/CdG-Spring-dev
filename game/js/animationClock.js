/** 待機だけを省略する。効果適用・保存・次フェーズ処理は通常と同じ経路を通る。 */
export class AnimationClock {
    constructor() { this.waiters = new Set(); this.active = false; }
    start() { this.active = true; this.skipRemaining = false; this.skipCurrent = false; }
    beginCard() { this.skipCurrent = false; }
    skipCard() { if (this.active) { this.skipCurrent = true; this.flush(); } }
    skipTurn() { if (this.active) { this.skipRemaining = true; this.flush(); } }
    flush() { for (const finish of [...this.waiters]) finish(); }
    finish() { this.flush(); this.active = false; this.skipCurrent = false; this.skipRemaining = false; }
    wait(ms) {
        if (this.active && (this.skipCurrent || this.skipRemaining)) return Promise.resolve();
        return new Promise(resolve => {
            const finish = () => { clearTimeout(timer); this.waiters.delete(finish); resolve(); };
            const timer = setTimeout(finish, ms); this.waiters.add(finish);
        });
    }
}
