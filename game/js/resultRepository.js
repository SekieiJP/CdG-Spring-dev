/** 詳細ログとは分けた、履歴50件・送信待ち5件の端末内保存。 */
export class ResultRepository {
    static KEY = 'cdg_results_v1';
    static HISTORY_LIMIT = 50;
    static FAVORITE_LIMIT = 49;
    static PENDING_LIMIT = 5;
    constructor(storage) {
        this.storage = storage;
        this.memory = { history: [], pending: [], recentResultIds: [] };
        this.storageError = null;
    }

    read() {
        // 書き込みに失敗した後は、古い保存内容で画面内の新しい結果を上書きしない。
        if (!this.storageError) {
            try {
                const saved = JSON.parse(this.storage.getItem(ResultRepository.KEY) || 'null');
                if (Array.isArray(saved?.history) && Array.isArray(saved.pending)) {
                    this.memory = { ...saved, recentResultIds: Array.isArray(saved.recentResultIds)
                        ? saved.recentResultIds : saved.history.slice(-ResultRepository.PENDING_LIMIT).map(row => row.resultId) };
                } else if (saved === null) this.memory = { history: [], pending: [], recentResultIds: [] };
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
    favoriteCount() { return this.history().filter(row => row.favorite === true).length; }

    setFavorite(resultId, favorite) {
        const data = this.read();
        const row = data.history.find(item => item.resultId === resultId);
        if (!row) return { ok: false, error: '履歴が見つかりません' };
        const next = Boolean(favorite);
        if (next && row.favorite !== true && data.history.filter(item => item.favorite === true).length >= ResultRepository.FAVORITE_LIMIT) {
            return { ok: false, error: 'お気に入りは49件までです。追加するには別の履歴のお気に入りを解除してください' };
        }
        row.favorite = next;
        this.write(data);
        return { ok: true, row: structuredClone(row) };
    }

    setReplay(resultId, text) {
        const data = this.read();
        const row = data.history.find(item => item.resultId === resultId);
        if (!row) return null;
        row.replayText = text;
        delete row.replayPending;
        this.write(data);
        return structuredClone(row);
    }

    commit(summary, payload, { submit = true } = {}) {
        const data = this.read();
        const existing = data.history.find(item => item.resultId === summary.resultId);
        if (existing) return existing;
        if (submit && data.recentResultIds.includes(summary.resultId)) {
            return { ...structuredClone(summary), favorite: false,
                submission: data.pending.some(item => item.resultId === summary.resultId) ? 'pending' : 'sent' };
        }
        const row = { ...structuredClone(summary), favorite: false, submission: submit ? 'pending' : 'local' };
        data.history.push(row);
        while (data.history.length > ResultRepository.HISTORY_LIMIT) {
            const index = data.history.findIndex(item => item.favorite !== true);
            if (index === -1) break;
            data.history.splice(index, 1);
        }
        if (!submit) {
            this.write(data);
            return structuredClone(row);
        }
        data.pending.push({ resultId: summary.resultId, payload: structuredClone(payload), attempts: 0, lastError: null });
        // お気に入り保護で保持履歴と実際の直近ゲームがずれるため、送信期限を別に保持する
        data.recentResultIds = [...data.recentResultIds, summary.resultId].slice(-ResultRepository.PENDING_LIMIT);
        const recentIds = new Set(data.recentResultIds);
        const removed = data.pending.filter(item => !recentIds.has(item.resultId));
        data.pending = data.pending.filter(item => recentIds.has(item.resultId));
        for (const pending of removed) {
            const historyRow = data.history.find(item => item.resultId === pending.resultId);
            if (historyRow) historyRow.submission = historyRow.submission === 'history-pending' ? 'history-outside-queue' : 'outside-queue';
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

    deferHistory(resultId) {
        const data = this.read();
        const row = data.history.find(item => item.resultId === resultId);
        if (!row) return;
        row.submission = data.pending.some(item => item.resultId === resultId) ? 'history-pending' : 'history-outside-queue';
        this.write(data);
    }

    previous(summary) {
        const history = this.history();
        const index = history.findIndex(row => row.resultId === summary.resultId);
        return (index < 0 ? history : history.slice(0, index)).reverse().find(row => row.resultId !== summary.resultId &&
            ['difficulty', 'mode', 'rulesVersion', 'cardVersion', 'rankVersion'].every(key => row[key] === summary[key])) || null;
    }
}
