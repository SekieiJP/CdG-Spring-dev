import { ResultRepository } from './resultRepository.js?v=20261107-0061';
import { SubmissionQueue } from './submissionQueue.js?v=20261107-0061';
import { buildScorePayload, submitPayload } from './scoreSubmitter.js?v=20261107-0061';
import { getCompletedReplay } from './replayRecorder.js?v=20261107-0061';
import { encodeReplay } from './replayCodec.js?v=20261107-0061';

/** 完了した結果の保存・履歴表示・通信を、進行中のゲームから分離する。 */
export class ResultController {
    constructor(ui) {
        this.ui = ui;
        this.replayJobs = new Map();
        this.replayMessages = new Map();
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
        window.addEventListener('storage', event => {
            if (event.key === ResultRepository.KEY || event.key === null) {
                this.queue.start();
                this.renderReplayControls();
                this.preparePendingReplays();
            }
        });
        document.getElementById('result-favorite')?.addEventListener('click', () => this.toggleFavorite(this.currentId));
        document.getElementById('result-replay-copy')?.addEventListener('click', () => this.copyReplay(this.currentId));
        this.queue.start();
        this.preparePendingReplays();
    }

    record(score, finalDeck) {
        const state = this.ui.gameState;
        const payload = buildScorePayload(state, score, finalDeck, {
            rulesVersion: state.config.rulesVersion,
            cardVersion: this.ui.cardManager.dataVersion,
            rankVersion: this.ui.scoreManager.dataVersion
        });
        const existing = this.repository.find(payload.resultId);
        const replayPending = existing ? null : getCompletedReplay(state);
        const summary = this.repository.commit({
            resultId: payload.resultId, startedAt: payload.startedAt, completedAt: payload.completedAt,
            difficulty: payload.difficulty, difficultyName: state.config.name, mode: payload.mode,
            buildVersion: payload.buildVersion, rulesVersion: payload.rulesVersion,
            cardVersion: payload.cardVersion, rankVersion: payload.rankVersion,
            score: structuredClone(score),
            finalDeck: finalDeck.map(({ cardNo, cardName, rarity, category }) => ({ cardNo, cardName, rarity, category })),
            ...(replayPending ? { replayPending } : { replayUnavailableReason: 'プレイ開始からの完全な記録がないため、リプレイ出力できません。' })
        }, payload);
        this.currentId = summary.resultId;
        this.renderComparison(summary);
        this.renderStatus();
        this.renderReplayControls();
        this.prepareReplay(summary);
        this.queue.start();
        return summary;
    }

    onQueueChange(update) {
        if ((update.result?.ok || update.result?.historyPending) && update.result.versionMatch === false && this.warnedVersion !== update.result.currentVersion) {
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
        if (row.submission === 'history-pending') return 'スコア送信済み。ターン履歴は送信先の更新待ち';
        if (row.submission === 'history-outside-queue') return 'スコア送信済み（ターン履歴は送信待ちの上限から除外）';
        if (row?.submission === 'outside-queue') return '履歴に保存済み（送信待ちの上限から除外）';
        if (row?.resultId === this.queue.activeId) return 'スコア送信中。もう一度プレイできます';
        return '履歴に保存済み。通信が戻ると再送します';
    }

    renderStatus() {
        if (!this.currentId) return;
        const status = document.getElementById('result-submission-status');
        if (status) status.textContent = this.statusText(this.repository.find(this.currentId));
    }

    preparePendingReplays() {
        for (const row of this.repository.history()) this.prepareReplay(row);
    }

    prepareReplay(row) {
        if (!row?.replayPending || row.replayText || this.replayJobs.has(row.resultId)) return;
        const resultId = row.resultId;
        const replay = structuredClone(row.replayPending);
        this.replayMessages.delete(resultId);
        const job = encodeReplay(replay).then(text => {
            this.repository.setReplay(resultId, text);
        }).catch(error => {
            this.replayMessages.set(resultId, 'リプレイデータを準備できませんでした。履歴を開き直すと再試行します。');
            this.ui.logger?.log(`リプレイデータの準備に失敗: ${error.message}`, 'warning');
        }).finally(() => {
            this.replayJobs.delete(resultId);
            this.renderReplayControls();
            this.renderStatus();
        });
        this.replayJobs.set(resultId, job);
        this.renderReplayControls();
    }

    replayStatusText(row) {
        if (!row) return '履歴はこの端末に残っていません。';
        if (this.replayMessages.has(row.resultId)) return this.replayMessages.get(row.resultId);
        if (row.replayText) return 'リプレイデータをコピーできます。';
        if (row.replayPending) return 'リプレイデータを準備しています。';
        return row.replayUnavailableReason || 'この履歴には完全なリプレイデータがないため、リプレイ出力できません。';
    }

    renderReplayControls() {
        const rows = new Map(this.repository.history().map(row => [row.resultId, row]));
        const favoriteCount = this.repository.favoriteCount();
        const atLimit = favoriteCount >= ResultRepository.FAVORITE_LIMIT;
        const resultFavorite = document.getElementById('result-favorite');
        const resultReplay = document.getElementById('result-replay-copy');
        if (resultFavorite) resultFavorite.dataset.favoriteId = this.currentId || '';
        if (resultReplay) resultReplay.dataset.replayId = this.currentId || '';
        for (const button of document.querySelectorAll('[data-favorite-id]')) {
            const row = rows.get(button.dataset.favoriteId);
            button.textContent = row?.favorite ? '★ お気に入りから外す' : '☆ お気に入りに追加';
            button.setAttribute('aria-pressed', String(!!row?.favorite));
            button.disabled = !row || (!row.favorite && atLimit);
        }
        for (const button of document.querySelectorAll('[data-replay-id]')) {
            button.disabled = !rows.get(button.dataset.replayId)?.replayText;
        }
        const resultStatus = document.getElementById('result-replay-status');
        if (resultStatus) resultStatus.textContent = this.currentId ? this.replayStatusText(rows.get(this.currentId)) : '';
        for (const status of document.querySelectorAll('[data-replay-status]')) {
            status.textContent = this.replayStatusText(rows.get(status.dataset.replayStatus));
        }
        for (const status of document.querySelectorAll('[data-history-status]')) {
            status.textContent = this.statusText(rows.get(status.dataset.historyStatus));
        }
        const countText = `お気に入り ${favoriteCount}/${ResultRepository.FAVORITE_LIMIT}件${atLimit ? '。追加するには、ほかの履歴のお気に入りを解除してください。' : ''}`;
        for (const status of document.querySelectorAll('[data-favorite-count]')) status.textContent = countText;
        for (const label of document.querySelectorAll('[data-history-label]')) {
            const row = rows.get(label.dataset.historyLabel);
            if (row) label.textContent = `${row.favorite ? '★ ' : ''}${row.difficultyName || row.difficulty} · ${row.mode} · ${row.score.displayScore}pt / ${row.score.rank.grade}`;
        }
    }

    toggleFavorite(resultId) {
        const row = this.repository.find(resultId);
        if (!row) return;
        const result = this.repository.setFavorite(resultId, !row.favorite);
        if (!result.ok) this.ui.showFloatNotification(result.error, 'warning');
        this.renderReplayControls();
        this.renderStatus();
    }

    async copyReplay(resultId) {
        const row = this.repository.find(resultId);
        if (!row?.replayText) return;
        try {
            if (!navigator.clipboard?.writeText) throw new Error('クリップボードにアクセスできません');
            await navigator.clipboard.writeText(row.replayText);
            this.replayMessages.set(resultId, 'リプレイデータをコピーしました。');
        } catch (error) {
            this.replayMessages.set(resultId, 'コピーできませんでした。クリップボードへのアクセスを許可して、もう一度お試しください。');
            this.ui.logger?.log(`リプレイデータのコピーに失敗: ${error.message}`, 'warning');
        }
        this.renderReplayControls();
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
        const overlay = this.ui.createInfoOverlay('プレイ履歴（最大50件）');
        overlay.id = 'result-history-overlay';
        const content = overlay.querySelector('.info-overlay-content');
        const note = document.createElement('p');
        note.className = 'result-note';
        note.textContent = 'お気に入りは自動削除されません。50件を超えると、お気に入り以外で最も古い履歴が削除されます。';
        content.appendChild(note);
        const count = document.createElement('p');
        count.className = 'result-note';
        count.dataset.favoriteCount = '';
        count.setAttribute('aria-live', 'polite');
        content.appendChild(count);
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
            details.dataset.resultId = row.resultId;
            details.innerHTML = `<summary><span data-history-label="${escape(row.resultId)}"></span><br><small>${escape(new Date(row.completedAt).toLocaleString('ja-JP'))}</small></summary>
                <p data-history-status="${escape(row.resultId)}">${escape(this.statusText(row))}</p>
                <p>${escape(this.comparisonText(row))}</p>
                <p>体験 ${escape(row.score.experience)} / 入塾 ${escape(row.score.enrollment)} / 満足 ${escape(row.score.satisfaction)} / 経理 ${escape(row.score.accounting)}</p>
                <p>最終デッキ（${row.finalDeck.length}枚）: ${row.finalDeck.map(card => escape(`${card.cardNo || ''} ${card.cardName}`.trim())).join('、')}</p>
                <p class="history-versions">コード: ${escape(row.buildVersion)}<br>ルール: ${escape(row.rulesVersion)}<br>カード: ${escape(row.cardVersion)}<br>ランク: ${escape(row.rankVersion)}</p>`;
            const actions = document.createElement('div');
            actions.className = 'history-actions';
            const favorite = document.createElement('button');
            favorite.type = 'button';
            favorite.className = 'btn-secondary';
            favorite.dataset.favoriteId = row.resultId;
            favorite.addEventListener('click', () => this.toggleFavorite(row.resultId));
            actions.appendChild(favorite);
            const copy = document.createElement('button');
            copy.type = 'button';
            copy.className = 'btn-secondary';
            copy.dataset.replayId = row.resultId;
            copy.textContent = 'リプレイデータをコピー';
            copy.addEventListener('click', () => this.copyReplay(row.resultId));
            actions.appendChild(copy);
            details.appendChild(actions);
            const replayStatus = document.createElement('p');
            replayStatus.dataset.replayStatus = row.resultId;
            replayStatus.setAttribute('role', 'status');
            details.appendChild(replayStatus);
            content.appendChild(details);
        }
        document.body.appendChild(overlay);
        this.updateRetryButton();
        this.renderReplayControls();
        this.preparePendingReplays();
    }
}
