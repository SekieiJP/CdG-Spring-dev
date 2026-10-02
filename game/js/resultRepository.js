/** 詳細ログとは分けた、履歴50件・送信待ち5件の端末内保存。 */
export class ResultRepository {
    static KEY = 'cdg_results_v1';
    static HISTORY_LIMIT = 50;
    static PENDING_LIMIT = 5;
    constructor(storage) {
        this.storage = storage;
        this.memory = { history: [], pending: [] };
        this.storageError = null;
    }

    read() {
        // 書き込みに失敗した後は、古い保存内容で画面内の新しい結果を上書きしない。
        if (!this.storageError) {
            try {
                const saved = JSON.parse(this.storage.getItem(ResultRepository.KEY) || 'null');
                if (Array.isArray(saved?.history) && Array.isArray(saved.pending)) this.memory = saved;
                else if (saved === null) this.memory = { history: [], pending: [] };
            } catch (error) { this.storageError = error.message; }
        }
        return structuredClone(this.memory);
    }

    write(data) {
        this.memory = structuredClone(data);
        try {
            this.storage.setItem(ResultRepository.KEY, JSON.stringify(data));
            this.storageError = null;
        } catch (error) { this.storageError = error.message; }
    }

    history() { return this.read().history; }
    pending() { return this.read().pending; }
    find(resultId) { return this.history().find(row => row.resultId === resultId) || null; }

    commit(summary, payload) {
        const data = this.read();
        const existing = data.history.find(item => item.resultId === summary.resultId);
        if (existing) return existing;
        const row = { ...structuredClone(summary), submission: 'pending' };
        data.history.push(row);
        data.history = data.history.slice(-ResultRepository.HISTORY_LIMIT);
        data.pending.push({ resultId: summary.resultId, payload: structuredClone(payload), attempts: 0, lastError: null });
        // 未送信が少なくても、6ゲーム以上前の結果は送信待ちから外す。
        const recentIds = new Set(data.history.slice(-ResultRepository.PENDING_LIMIT).map(item => item.resultId));
        const removed = data.pending.filter(item => !recentIds.has(item.resultId));
        data.pending = data.pending.filter(item => recentIds.has(item.resultId));
        for (const pending of removed) {
            const historyRow = data.history.find(item => item.resultId === pending.resultId);
            if (historyRow) historyRow.submission = 'outside-queue';
        }
        this.write(data);
        return structuredClone(row);
    }

    failed(resultId, error) {
        const data = this.read();
        const row = data.pending.find(item => item.resultId === resultId);
        if (row) {
            row.attempts++;
            row.lastError = error;
            this.write(data);
        }
    }

    acknowledge(resultId) {
        const data = this.read();
        data.pending = data.pending.filter(item => item.resultId !== resultId);
        const row = data.history.find(item => item.resultId === resultId);
        if (row) row.submission = 'sent';
        this.write(data);
    }

    previous(summary) {
        const history = this.history();
        const index = history.findIndex(row => row.resultId === summary.resultId);
        return (index < 0 ? history : history.slice(0, index)).reverse().find(row => row.resultId !== summary.resultId &&
            ['difficulty', 'mode', 'rulesVersion', 'cardVersion', 'rankVersion'].every(key => row[key] === summary[key])) || null;
    }
}
