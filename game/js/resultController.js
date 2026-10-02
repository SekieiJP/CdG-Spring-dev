import { ResultRepository } from './resultRepository.js?v=20260815-0053';
import { SubmissionQueue } from './submissionQueue.js?v=20260815-0053';
import { buildScorePayload, submitPayload } from './scoreSubmitter.js?v=20260815-0053';

/** 完了した結果の保存・履歴表示・通信を、進行中のゲームから分離する。 */
export class ResultController {
    constructor(ui) {
        this.ui = ui;
        this.repository = new ResultRepository({
            getItem: key => localStorage.getItem(key),
            setItem: (key, value) => localStorage.setItem(key, value)
        });
        this.queue = new SubmissionQueue(this.repository,
            (payload, signal) => submitPayload(payload, ui.logger, { signal }), {
                online: () => navigator.onLine !== false,
                logger: ui.logger,
                changed: update => this.onQueueChange(update)
            });
    }

    init() {
        window.addEventListener('online', () => this.queue.start());
        window.addEventListener('offline', () => this.renderStatus());
        window.addEventListener('storage', event => { if (event.key === ResultRepository.KEY || event.key === null) this.queue.start(); });
        this.queue.start();
    }

    record(score, finalDeck) {
        const state = this.ui.gameState;
        const payload = buildScorePayload(state, score, finalDeck, {
            rulesVersion: state.config.rulesVersion,
            cardVersion: this.ui.cardManager.dataVersion,
            rankVersion: this.ui.scoreManager.dataVersion
        });
        const summary = this.repository.commit({
            resultId: payload.resultId, startedAt: payload.startedAt, completedAt: payload.completedAt,
            difficulty: payload.difficulty, difficultyName: state.config.name, mode: payload.mode,
            buildVersion: payload.buildVersion, rulesVersion: payload.rulesVersion,
            cardVersion: payload.cardVersion, rankVersion: payload.rankVersion,
            score: structuredClone(score),
            finalDeck: finalDeck.map(({ cardNo, cardName, rarity, category }) => ({ cardNo, cardName, rarity, category }))
        }, payload);
        this.currentId = summary.resultId;
        this.renderComparison(summary);
        this.renderStatus();
        this.queue.start();
        return summary;
    }

    onQueueChange(update) {
        if (update.result?.ok && update.result.versionMatch === false && this.warnedVersion !== update.result.currentVersion) {
            this.warnedVersion = update.result.currentVersion;
            try { localStorage.setItem('cdg_version_updated', 'true'); } catch { /* 警告は画面にも表示する */ }
            this.ui.logger?.log(`⚠️ 新しいバージョンがあります（最新: ${update.result.currentVersion || '最新'}）`, 'info');
            this.ui.showFloatNotification('新しいバージョンがあります。再読み込みをおすすめします', 'warning');
        }
        this.renderStatus();
        this.updateRetryButton();
        const overlay = document.getElementById('result-history-overlay');
        if (overlay) {
            const rows = new Map(this.repository.history().map(row => [row.resultId, row]));
            for (const status of overlay.querySelectorAll('[data-history-status]')) status.textContent = this.statusText(rows.get(status.dataset.historyStatus));
        }
    }

    statusText(row) {
        if (this.repository.storageError) return '履歴をこの画面で保持しています。再読み込みすると失われる可能性があります。';
        if (!row) return '履歴はこの端末に残っていません';
        if (row?.submission === 'sent') return 'スコア送信済み';
        if (row?.submission === 'outside-queue') return '履歴に保存済み（送信待ちの上限から除外）';
        if (row?.resultId === this.queue.activeId) return 'スコア送信中。もう一度プレイできます';
        return '履歴に保存済み。通信が戻ると再送します';
    }

    renderStatus() {
        if (!this.currentId) return;
        const status = document.getElementById('result-submission-status');
        if (status) status.textContent = this.statusText(this.repository.find(this.currentId));
    }

    comparisonText(summary) {
        const previous = this.repository.previous(summary);
        if (!previous) return '同じ難易度・モード・ルール／カード環境の前回結果はありません';
        const delta = Number(summary.score.displayScore) - Number(previous.score.displayScore);
        return `同じ環境の前回: ${previous.score.displayScore}pt → 今回: ${summary.score.displayScore}pt（${delta >= 0 ? '+' : ''}${Number(delta.toFixed(2))}pt）`;
    }

    renderComparison(summary) {
        const element = document.getElementById('result-comparison');
        if (element) element.textContent = this.comparisonText(summary);
    }

    updateRetryButton() {
        const button = document.getElementById('retry-score-submissions');
        if (!button) return;
        const count = this.repository.pending().length;
        button.disabled = count === 0 || !!this.queue.running;
        button.textContent = `送信待ちを再送（${count}/5件）`;
    }

    showHistory() {
        const existing = document.getElementById('result-history-overlay');
        existing?.remove();
        const overlay = this.ui.createInfoOverlay('プレイ履歴（直近50ゲーム）');
        overlay.id = 'result-history-overlay';
        const content = overlay.querySelector('.info-overlay-content');
        const retry = document.createElement('button');
        retry.id = 'retry-score-submissions';
        retry.className = 'btn-secondary';
        retry.addEventListener('click', async () => { await this.queue.start(); this.showHistory(); });
        content.appendChild(retry);

        const rows = this.repository.history().reverse();
        if (!rows.length) {
            const empty = document.createElement('p');
            empty.textContent = 'まだ完了したゲームはありません';
            content.appendChild(empty);
        }
        const escape = value => this.ui._escapeHTML(String(value ?? ''));
        for (const row of rows) {
            const details = document.createElement('details');
            details.className = 'result-history-entry';
            details.innerHTML = `<summary>${escape(row.difficultyName || row.difficulty)} · ${escape(row.mode)} · ${escape(row.score.displayScore)}pt / ${escape(row.score.rank.grade)}<br><small>${escape(new Date(row.completedAt).toLocaleString('ja-JP'))}</small></summary>
                <p data-history-status="${escape(row.resultId)}">${escape(this.statusText(row))}</p>
                <p>${escape(this.comparisonText(row))}</p>
                <p>体験 ${escape(row.score.experience)} / 入塾 ${escape(row.score.enrollment)} / 満足 ${escape(row.score.satisfaction)} / 経理 ${escape(row.score.accounting)}</p>
                <p>最終デッキ（${row.finalDeck.length}枚）: ${row.finalDeck.map(card => escape(`${card.cardNo || ''} ${card.cardName}`.trim())).join('、')}</p>
                <p class="history-versions">コード: ${escape(row.buildVersion)}<br>ルール: ${escape(row.rulesVersion)}<br>カード: ${escape(row.cardVersion)}<br>ランク: ${escape(row.rankVersion)}</p>`;
            content.appendChild(details);
        }
        document.body.appendChild(overlay);
        this.updateRetryButton();
    }
}
