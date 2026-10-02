/** 不変な結果だけを送信する。再プレイの状態やボタンには依存しない。 */
export class SubmissionQueue {
    constructor(repository, send, { attempts = 3, retryDelayMs = 2000, changed = () => {}, online = () => true, logger } = {}) {
        Object.assign(this, { repository, send, attempts, retryDelayMs, changed, online, logger });
        this.requestedPass = 0;
    }
    notify() {
        this.changed({ pending: this.repository.pending().length, activeId: this.activeId || null });
    }

    start() {
        this.requestedPass++;
        if (this.activeId && !this.repository.pending().some(row => row.resultId === this.activeId)) this.controller?.abort();
        this.notify();
        if (this.running) return this.running;
        this.running = this.drain().finally(() => {
            this.running = null;
            this.activeId = null;
            this.notify();
        });
        return this.running;
    }
    async drain() {
        const tried = new Set();
        let pass;
        do {
            pass = this.requestedPass;
            await this.flush(tried);
        } while (pass !== this.requestedPass);
    }
    async flush(tried) {
        while (this.online()) {
            const row = this.repository.pending().find(row => !tried.has(row.resultId));
            if (!row) return;
            tried.add(row.resultId);
            this.activeId = row.resultId;
            this.controller = new AbortController();
            this.notify();
            for (let attempt = 0; attempt < this.attempts; attempt++) {
                if (!this.repository.pending().some(item => item.resultId === row.resultId)) break;
                let result;
                try { result = await this.send(structuredClone(row.payload), this.controller.signal); }
                catch (error) { result = { ok: false, error: error.message }; }
                if (result.ok) {
                    this.repository.acknowledge(row.resultId);
                    this.changed({ result, resultId: row.resultId });
                    break;
                }
                this.repository.failed(row.resultId, result.error || '送信失敗');
                this.notify();
                if (attempt + 1 < this.attempts && !this.controller.signal.aborted && this.online()) {
                    await this.waitForRetry(this.controller.signal);
                } else {
                    if (!this.controller.signal.aborted) this.logger?.log('❌ スコア送信に失敗しました（端末に保留）。再プレイできます', 'warning');
                    break;
                }
            }
            this.activeId = null;
            this.notify();
        }
    }
    waitForRetry(signal) {
        if (signal.aborted) return Promise.resolve();
        return new Promise(resolve => {
            const finish = () => {
                clearTimeout(timer);
                signal.removeEventListener('abort', finish);
                resolve();
            };
            const timer = setTimeout(finish, this.retryDelayMs);
            signal.addEventListener('abort', finish, { once: true });
        });
    }
}
