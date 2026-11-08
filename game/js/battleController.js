import { decodeReplay } from './replayCodec.js?v=20261107-0063';
import { getCurrentEvent } from './eventManager.js?v=20261107-0063';
import { cpuTrainingAdvice, cpuMeetingAdvice } from './battleAdvice.js?v=20261107-0063';
import { BATTLE_STATS, validateBattleReplay, opponentSnapshot, opponentDeck, opponentFrames,
    interimScore, battleSummary } from './battleReplay.js?v=20261107-0063';

const LABELS = { experience: '体験', enrollment: '入塾', satisfaction: '満足', accounting: '経理' };
const ANIMATION_STATS = { experience: 'exp', enrollment: 'enr', satisfaction: 'sat', accounting: 'acc' };
const OUTCOMES = { win: '勝利！', lose: '敗北', draw: '引き分け' };

export class BattleController {
    constructor(ui) { this.ui = ui; this.request = 0; }
    get state() { return this.ui.gameState; }
    get active() { return !!this.state.battle; }
    get opponentName() { return this.state.battle?.kind === 'cpu' ? 'あひる先生' : 'リプレイの教室'; }
    init() {
        document.getElementById('start-battle')?.addEventListener('click', () => this.openLobby());
        document.getElementById('result-battle-lobby')?.addEventListener('click', () => this.openLobby());
        const panel = document.getElementById('full-status-panel');
        this.statusRow = document.createElement('div');
        this.statusRow.id = 'battle-opponent-status';
        this.statusRow.className = 'battle-opponent-row hidden';
        panel?.prepend(this.statusRow);
        const animation = document.getElementById('animation-stats');
        this.animationRow = document.createElement('div');
        this.animationRow.id = 'battle-animation-opponent';
        this.animationRow.className = 'battle-opponent-row hidden';
        (animation || document.querySelector('.animation-stats'))?.before(this.animationRow);
        this.compactRow = document.createElement('div');
        this.compactRow.id = 'battle-compact-opponent';
        this.compactRow.className = 'battle-opponent-row battle-opponent-row--compact hidden';
        document.querySelector('#sticky-header .compact-stats')?.before(this.compactRow);
        for (const selector of ['#full-header .turn-info', '#sticky-header .compact-info']) {
            const score = document.createElement('div');
            score.className = 'battle-score hidden'; score.dataset.battleScore = '';
            document.querySelector(selector)?.appendChild(score);
        }
        const animationScore = document.createElement('div');
        animationScore.className = 'battle-score hidden'; animationScore.dataset.battleScore = '';
        document.getElementById('animation-header')?.after(animationScore);
        this.render();
    }
    resetDisplay() {
        this.cpuSpeech = null;
        for (const row of [this.statusRow, this.animationRow, this.compactRow]) row?.classList.add('hidden');
        document.querySelectorAll('[data-battle-score]').forEach(node => node.classList.add('hidden'));
        document.body.classList.remove('battle-mode', 'battle-results');
        document.querySelectorAll('[data-battle-comparison]').forEach(node => delete node.dataset.battleComparison);
    }
    openLobby(preset = null) {
        if (this.state.startedAt && !['start', 'end'].includes(this.state.phase)) {
            this.ui.showFloatNotification('モードを変更するには、設定から初めからやり直してください。', 'warning');
            return;
        }
        this.cancelCpu?.(); this.request++;
        document.getElementById('battle-lobby')?.remove();
        const overlay = this.ui.createInfoOverlay('対戦ロビー'); overlay.id = 'battle-lobby';
        const content = overlay.querySelector('.info-overlay-content');
        content.innerHTML = `<div class="battle-lobby-tabs" role="group" aria-label="対戦相手">
            <button type="button" id="battle-kind-replay" class="btn-primary" aria-pressed="true">リプレイと対戦</button>
            <button type="button" id="battle-kind-cpu" class="btn-secondary" aria-pressed="false">あひる先生と対戦</button></div>
            <div id="battle-replay-controls"><label for="battle-replay-input">リプレイデータ</label>
            <textarea id="battle-replay-input" rows="5" spellcheck="false" placeholder="コピーしたリプレイデータを貼り付けてください"></textarea>
            <button type="button" id="battle-load-replay" class="btn-secondary">リプレイを読み込む</button>
            <p id="battle-replay-summary"></p>
            <label class="battle-check"><input id="battle-same-seed" type="checkbox">リプレイデータと同一シード</label>
            <p class="result-note">同一シードではハイスコアを記録しません。選ぶカードによって、候補や手札は変わります。</p>
            <label id="battle-event-label" class="battle-check hidden"><input id="battle-event" type="checkbox">開催中のイベントを自分に適用する</label></div>
            <div id="battle-cpu-controls" class="hidden"><label for="battle-difficulty">ゲーム難易度</label>
            <select id="battle-difficulty"><option value="fresh">FRESH</option><option value="pro">PRO</option></select>
            <p>あひる先生は自分の教室を独立して運営します。あなたへの取得アシストとアドバイスはお休みです。</p></div>
            <p id="battle-lobby-message" role="status" aria-live="polite"></p>
            <button type="button" id="battle-start" class="btn-primary" disabled>対戦開始</button>`;
        document.body.appendChild(overlay);
        let kind = 'replay'; let loaded = preset?.opponent || null; let busy = false;
        const input = content.querySelector('#battle-replay-input');
        const start = content.querySelector('#battle-start');
        const message = content.querySelector('#battle-lobby-message');
        const summary = content.querySelector('#battle-replay-summary');
        const eventLabel = content.querySelector('#battle-event-label');
        content.querySelector('#battle-difficulty').value = preset?.opponent?.metadata.difficulty || this.ui.selectedDifficulty || 'fresh';
        const update = () => { start.disabled = busy || kind === 'replay' && !loaded; };
        const select = selected => {
            if (busy) return;
            kind = selected; message.textContent = '';
            content.querySelector('#battle-replay-controls').classList.toggle('hidden', kind !== 'replay');
            content.querySelector('#battle-cpu-controls').classList.toggle('hidden', kind !== 'cpu');
            for (const item of ['replay', 'cpu']) {
                const button = content.querySelector(`#battle-kind-${item}`);
                button.setAttribute('aria-pressed', String(item === kind));
                button.className = item === kind ? 'btn-primary' : 'btn-secondary';
            }
            update();
        };
        content.querySelector('#battle-kind-replay').onclick = () => select('replay');
        content.querySelector('#battle-kind-cpu').onclick = () => select('cpu');
        if (loaded) {
            summary.textContent = `${loaded.metadata.difficulty.toUpperCase()} ／ ${loaded.metadata.buildVersion} ／ 同じリプレイで再戦します`;
            eventLabel.classList.toggle('hidden', !(getCurrentEvent() && (loaded.metadata.eventId || loaded.metadata.calcMode)));
        }
        select(preset?.kind || 'replay');
        input.oninput = () => { loaded = null; summary.textContent = ''; eventLabel.classList.add('hidden'); update(); };
        content.querySelector('#battle-load-replay').onclick = async () => {
            const text = input.value; const request = ++this.request; loaded = null; busy = true; update();
            message.textContent = 'リプレイを確認しています。';
            try {
                const record = validateBattleReplay(await decodeReplay(text, { currentBuildVersion: window.BUILD_VERSION }));
                if (request !== this.request || input.value !== text || !overlay.isConnected) return;
                loaded = record;
                const mode = record.metadata.eventId ? 'イベント' + (record.metadata.calcMode ? '・計算機' : '') : record.metadata.calcMode ? '計算機' : '通常';
                summary.textContent = `${record.metadata.difficulty.toUpperCase()} ／ 元のモード：${mode} ／ ${record.metadata.buildVersion}`;
                eventLabel.classList.toggle('hidden', !(getCurrentEvent() && (record.metadata.eventId || record.metadata.calcMode)));
                message.textContent = '対戦できます。';
            } catch (error) { if (request === this.request) message.textContent = error.message; }
            finally { busy = false; update(); }
        };
        const close = overlay.querySelector('.info-overlay-close');
        const cancel = () => { this.cancelCpu?.(); this.request++; };
        close?.addEventListener('click', cancel);
        overlay.addEventListener('keydown', event => { if (event.key === 'Escape') cancel(); });
        start.onclick = async () => {
            if (busy || kind === 'replay' && !loaded) return;
            busy = true; update(); const request = ++this.request;
            try {
                const difficulty = kind === 'cpu' ? content.querySelector('#battle-difficulty').value : loaded.metadata.difficulty;
                const preparing = difficulty === 'pro' ? 'あひる先生が教材研究中…' : 'あひる先生が準備しています…';
                if (kind === 'cpu') message.textContent = preparing;
                const opponent = kind === 'cpu' ? await this.createCpu(difficulty, progress => {
                    message.textContent = `${preparing} ${progress}/8ターン`;
                }) : loaded;
                if (request !== this.request || !overlay.isConnected) return;
                const same = kind === 'replay' && content.querySelector('#battle-same-seed').checked;
                const seed = same ? opponent.metadata.seed : `battle:${crypto.randomUUID()}`;
                const battle = { schema: 1, kind, opponent, sameSeed: seed === opponent.metadata.seed, animation: null };
                const eventEnabled = kind === 'replay' && !eventLabel.classList.contains('hidden') && content.querySelector('#battle-event').checked;
                overlay.remove();
                await this.ui.onStartGame({ difficulty, seed, battle, eventEnabled });
            } catch (error) { message.textContent = `対戦を開始できませんでした。${error.message}`; }
            finally { busy = false; update(); }
        };
    }
    createCpu(difficulty, progress) {
        return new Promise((resolve, reject) => {
            const url = new URL('./cpuOpponentWorker.js', import.meta.url);
            url.search = new URL(import.meta.url).search;
            const worker = new Worker(url, { type: 'module' }); this.worker = worker;
            const finish = (error, record) => {
                worker.terminate();
                if (this.worker === worker) { this.worker = null; this.cancelCpu = null; }
                if (error) reject(error);
                else {
                    try { resolve(validateBattleReplay(record)); } catch (error) { reject(error); }
                }
            };
            this.cancelCpu = () => finish(new Error('あひる先生の準備を中止しました。'));
            worker.onmessage = event => {
                if (event.data.progress) progress(event.data.progress);
                if (event.data.record) finish(null, event.data.record);
                if (event.data.error) finish(new Error(event.data.error));
            };
            worker.onerror = () => finish(new Error('あひる先生の準備データを読み込めませんでした。再度お試しください。'));
            worker.postMessage({ difficulty, seed: `ahiru:${crypto.randomUUID()}`, buildVersion: window.BUILD_VERSION });
        });
    }
    visibleStats() {
        const battle = this.state.battle;
        if (battle.animation?.turn === this.state.turn && battle.animation.visibleStats) return battle.animation.visibleStats;
        return opponentSnapshot(battle, this.state.turn, this.state.phase).player;
    }
    render(playerStats = this.state.player, opponentStats = null) {
        if (!this.active) { this.resetDisplay(); return; }
        document.body.classList.add('battle-mode');
        document.body.classList.toggle('battle-results', this.state.phase === 'end');
        const battle = this.state.battle, opponent = opponentStats || this.visibleStats();
        const escape = value => this.ui._escapeHTML(String(value));
        for (const key of BATTLE_STATS) {
            const comparison = playerStats[key] > opponent[key] ? 'ahead' : playerStats[key] < opponent[key] ? 'behind' : 'even';
            for (const node of document.querySelectorAll(`.status-${key}, .anim-${ANIMATION_STATS[key]}, .compact-stat.stat-${ANIMATION_STATS[key]}`)) node.dataset.battleComparison = comparison;
        }
        const delta = battle.animation?.turn === this.state.turn && !battle.animation.done ? battle.animation.visibleDelta : null;
        for (const row of [this.statusRow, this.animationRow, this.compactRow]) {
            if (!row) continue;
            const animated = row === this.animationRow;
            const rows = BATTLE_STATS.map(key => {
                const grade = animated ? '' : this.ui.scoreManager.getStatusRank(key, opponent[key], this.state.difficulty)?.grade || '';
                const change = animated ? delta?.[key] || 0 : 0;
                const difference = change ? `<span class="battle-opponent-delta ${change > 0 ? 'positive' : 'negative'}">${change > 0 ? '+' : ''}${escape(change)}</span>` : '';
                return `<span class="battle-opponent-stat" data-stat="${key}"><span>${LABELS[key]}</span> ${grade ? `<span class="battle-opponent-rank">${escape(grade)}</span> ` : ''}<strong>${escape(opponent[key])}</strong>${difference}</span>`;
            }).join('');
            row.classList.remove('hidden');
            row.innerHTML = `<span class="battle-opponent-name">${escape(this.opponentName)}</span><div class="battle-opponent-stats">${rows}</div>`;
        }
        const ownScore = interimScore(this.ui.scoreManager, this.state, playerStats).displayScore;
        const opponentState = { difficulty: this.state.difficulty, event: battle.opponent.result.state.event };
        const otherScore = interimScore(this.ui.scoreManager, opponentState, opponent, this.state.turn).displayScore;
        for (const node of document.querySelectorAll('[data-battle-score]')) {
            node.classList.remove('hidden');
            node.setAttribute('role', 'img');
            node.setAttribute('aria-label', `${this.state.phase === 'end' ? '最終' : '暫定'}スコア：あなた ${ownScore}、${this.opponentName} ${otherScore}`);
            node.innerHTML = `<span aria-hidden="true">👤 <span class="battle-score-value${ownScore > otherScore ? ' leading' : ''}">${escape(ownScore)}</span><span class="battle-score-divider"> / </span><span class="battle-score-value${otherScore > ownScore ? ' leading' : ''}">${escape(otherScore)}</span> ${battle.kind === 'cpu' ? '🐤' : '🎞️'}</span>`;
        }
    }
    appendOpponentDeck(content) {
        if (!this.active) return;
        const section = document.createElement('section'); section.className = 'deck-section battle-deck';
        const cards = opponentDeck(this.state.battle, this.state.turn, this.state.phase);
        const title = document.createElement('h3'); title.textContent = `${this.opponentName}の山札（${cards.length}枚）`;
        section.appendChild(title);
        const list = document.createElement('div'); list.className = 'deck-cards';
        for (const card of cards) list.appendChild(this.ui.createCardElement(card, { compact: true }));
        section.appendChild(list); content.appendChild(section);
    }
    cpuAdvice() {
        if (this.state.battle?.kind !== 'cpu') return null;
        const opponent = this.state.battle.opponent;
        if (this.cpuSpeech?.opponent !== opponent || this.cpuSpeech.turn !== this.state.turn || this.cpuSpeech.phase !== this.state.phase) {
            const recommend = this.state.phase === 'meeting' ? cpuMeetingAdvice : cpuTrainingAdvice;
            this.cpuSpeech = { opponent, turn: this.state.turn, phase: this.state.phase, advice: recommend(opponent, this.state.turn) };
        }
        return this.cpuSpeech.advice;
    }
    async playOpponentAction() {
        if (!this.active) return;
        this.render();
        if (this.playJob) return this.playJob;
        const battle = this.state.battle, turn = this.state.turn;
        if (battle.animation?.turn === turn && battle.animation.done) return;
        this.playJob = this.runOpponentAnimation(battle, turn).finally(() => { this.playJob = null; });
        return this.playJob;
    }
    async runOpponentAnimation(battle, turn) {
        const frames = opponentFrames(battle.opponent, turn);
        if (battle.animation?.turn !== turn) battle.animation = { turn, cursor: 0, done: false };
        const animation = battle.animation, clock = this.ui.actionAnimation.clock;
        const overlay = document.getElementById('status-animation-overlay');
        const header = document.getElementById('animation-header');
        const cards = document.getElementById('animation-cards');
        const ownsClock = !clock.active;
        const advance = event => {
            if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
            event.preventDefault(); event.stopImmediatePropagation();
            clock.skipCard();
        };
        if (ownsClock) {
            clock.start();
            document.addEventListener('click', advance, true); document.addEventListener('keydown', advance, true);
        }
        this.ui.actionAnimation.updateAnimationStats(this.state.player, {});
        overlay?.classList.remove('hidden');
        try {
            for (let index = animation.cursor; index < frames.length; index++) {
                const frame = frames[index]; clock.beginCard();
                if (header) header.textContent = `${this.opponentName}\n教室行動 ${turn + 1}/8`;
                if (cards) {
                    const escape = value => this.ui._escapeHTML(String(value || ''));
                    cards.innerHTML = `<div class="animation-card-item battle-animation-card"><div class="anim-card-copy">
                        <div class="anim-staff-name">${escape(frame.type === 'event' ? '塾アイテム' : this.state.staffNames[frame.slot])}</div>
                        <div class="anim-card-name">${escape(frame.card.cardName)}</div><div class="anim-card-effect">${escape(frame.card.effect)}</div>
                        ${frame.skipped ? '<div class="anim-skip-text">条件・コストにより効果なし</div>' : ''}</div>
                        ${frame.type === 'card' ? this.ui.buildCardThumbnailHTML(frame.card, 'anim-card-thumbnail') : ''}</div>`;
                    this.ui.setupCardThumbnailFallback(cards);
                }
                animation.visibleStats = structuredClone(frame.after);
                animation.visibleDelta = Object.fromEntries(BATTLE_STATS.map(key => [key, frame.after[key] - frame.before[key]]));
                animation.cursor = index + 1;
                this.render(this.state.player, frame.after); this.ui.saveGameState();
                await clock.wait(800);
            }
            animation.visibleStats = structuredClone(battle.opponent.turns[turn].action.after.player);
            animation.done = true; delete animation.visibleDelta;
            this.render(); this.ui.saveGameState();
        } finally {
            if (ownsClock) {
                clock.finish(); overlay?.classList.add('hidden');
                document.removeEventListener('click', advance, true); document.removeEventListener('keydown', advance, true);
            }
        }
    }
    renderResult(score) {
        document.getElementById('battle-result')?.remove();
        document.getElementById('battle-opponent-deck')?.remove();
        document.getElementById('battle-rematch')?.remove();
        document.getElementById('restart-game').textContent = this.active ? 'タイトルへ' : 'もう一度プレイ';
        if (!this.active) return;
        const summary = battleSummary(this.state, score);
        const escape = value => this.ui._escapeHTML(String(value ?? ''));
        const other = summary.opponentScore;
        const pro = this.state.difficulty === 'pro';
        const players = [
            { name: 'あなた', icon: '👤', score, winner: summary.outcome === 'win' },
            { name: summary.opponentName, icon: this.state.battle.kind === 'cpu' ? '🐤' : '🎞️', score: other, winner: summary.outcome === 'lose' }
        ];
        const rows = [
            ['体験', 'experience', 'mobilizationPoints', 'experience'], ['入塾', 'enrollment'],
            ['満足', 'satisfaction', pro ? 'satisfactionPoints' : null, 'satisfaction'], ['経理', 'accounting'],
            ['退塾', 'withdrawal', 'withdrawalPoints'], ['入退差', 'enrollmentDiff', 'enrollmentDiffPoints', 'enrollmentDiff']
        ];
        const points = value => `${value > 0 ? '+' : ''}${escape(value)}点`;
        const cell = (value, key, pointKey, overflowKey) => {
            const extra = pro && value.overflow?.[overflowKey];
            return `<td><span class="battle-metric-value">${escape(value[key])}</span>${pointKey
                ? `<span class="battle-metric-points${value.breakdown[pointKey] < 0 ? ' negative' : ''}">${points(value.breakdown[pointKey])}${extra ? `<small>上限超過 +${escape(extra.toFixed(1))}点</small>` : ''}</span>` : ''}</td>`;
        };
        const precision = ['expBonus', 'diffBonus'].map((key, index) => {
            if (!score.splusBreakdown && !other.splusBreakdown) return '';
            return `<tr class="battle-precision-row"><th scope="row">${index ? '入退差' : '体験'}加点</th>${players.map(player =>
                `<td>${player.score.splusBreakdown ? points(player.score.splusBreakdown[key]) : '—'}</td>`).join('')}</tr>`;
        }).join('');
        const result = document.createElement('section'); result.id = 'battle-result';
        result.innerHTML = `<p class="battle-result-context">${pro ? 'PRO' : 'FRESH'} · ${escape(summary.opponentName)}と対戦</p>
            <div id="battle-outcome" class="battle-outcome ${summary.outcome}">${OUTCOMES[summary.outcome]}</div>
            <div class="battle-final-score">${players.map(player => `<section class="battle-player-result${player.winner ? ' winner' : ''}">
                <h3>${player.icon} ${escape(player.name)}${player.winner ? '<span class="battle-result-crown" aria-label="勝者">👑</span>' : ''}</h3>
                <p class="battle-player-score">${escape(player.score.displayScore)}<small>点</small></p>
                <div class="battle-player-rank"><span class="rank-${escape(player.score.rank.grade.replace('+', 'plus'))}">${escape(player.score.rank.grade)}</span><span>${escape(player.score.rank.name)}</span></div>
            </section>`).join('')}</div>
            <h3 class="battle-evaluation-heading">評価の比較</h3>
            <table class="battle-comparison-table"><thead><tr><th scope="col">項目</th><th scope="col">👤 あなた</th><th scope="col">${players[1].icon} ${escape(summary.opponentName)}</th></tr></thead>
            <tbody>${rows.map(([name, key, pointKey, overflowKey]) => `<tr><th scope="row">${name}</th>${cell(score, key, pointKey, overflowKey)}${cell(other, key, pointKey, overflowKey)}</tr>`).join('')}${precision}</tbody></table>
            ${summary.sameSeed ? '<p class="result-note battle-same-seed-note">同一シードの対戦です。自己ベストの対象外です。</p>' : ''}`;
        document.getElementById('result-rank')?.before(result);
        const deckSection = document.createElement('div'); deckSection.id = 'battle-opponent-deck';
        deckSection.innerHTML = `<details class="result-deck-details"><summary>${players[1].icon} ${escape(summary.opponentName)}の最終デッキ<span>${summary.opponentFinalDeck.length}枚</span></summary><div class="result-cards-grid"></div></details><details class="battle-result-build"><summary>バージョン・記録情報</summary><p class="result-build-info">${this.ui._buildInfoText()}</p></details>`;
        const grid = deckSection.querySelector('.result-cards-grid');
        for (const card of this.state.battle.opponent.result.finalDeck) grid.appendChild(this.ui.createCardElement(card, { compact: true }));
        document.getElementById('result-cards')?.after(deckSection);
        const rematch = document.createElement('button'); rematch.id = 'battle-rematch'; rematch.type = 'button';
        rematch.className = 'btn-primary'; rematch.textContent = '同じ相手と再戦';
        rematch.onclick = () => {
            const previous = this.state.battle;
            this.ui.onRestart(); this.openLobby({ kind: previous.kind, opponent: previous.opponent });
        };
        document.querySelector('#result-area .result-actions')?.prepend(rematch);
    }
}
