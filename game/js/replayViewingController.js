import { decodeReplay } from './replayCodec.js?v=20261110-0065';
import { validateBattleReplay } from './battleReplay.js?v=20261110-0065';
import { replayScenes, sceneAnalysisSource, sceneAnalysisInput } from './replayViewing.js?v=20261110-0065';
import { getDifficultyConfig } from './difficultyConfig.js?v=20261110-0065';

const STATS = { experience: '体験', enrollment: '入塾', satisfaction: '満足', accounting: '経理' };

export class ReplayViewingController {
    constructor(ui) { this.ui = ui; this.session = 0; this.jobId = 0; }
    init() {
        document.getElementById('start-replay-view')?.addEventListener('click', () => this.open());
        document.getElementById('start-replay-example')?.addEventListener('click', () => this.open({ mode: 'example' }));
    }
    close() {
        this.session++; this.analysisWorker?.terminate(); this.modelWorker?.terminate();
        this.observer?.disconnect(); this.overlay?.remove(); this.overlay = null;
        this.analysisWorker = null; this.modelWorker = null;
        this.record = null; this.scenes = []; this.cache = new Map(); this.example = null;
    }
    worker() {
        const url = new URL('./replayWorkshopWorker.js', import.meta.url);
        url.search = new URL(import.meta.url).search;
        return new Worker(url, { type: 'module' });
    }
    open({ mode = 'view', text = null } = {}) {
        this.close(); const session = this.session;
        this.mode = mode; this.record = null; this.scenes = []; this.cursor = 0; this.cache = new Map(); this.reasonOpen = false;
        this.analysisBusy = false; this.analysisError = null;
        const overlay = this.ui.createInfoOverlay(mode === 'example' ? 'あひる先生のお手本プレイ' : '教室防犯カメラ');
        this.overlay = overlay; overlay.id = 'replay-workshop';
        overlay.querySelector('.info-overlay-content').innerHTML = `
            <details id="replay-input-panel" open><summary>リプレイデータ</summary>
                <label for="replay-view-input">読み込むコード</label>
                <textarea id="replay-view-input" rows="4" spellcheck="false" autocapitalize="off" autocorrect="off" autocomplete="off"></textarea>
                <button id="replay-view-load" type="button" class="btn-primary">${mode === 'example' ? 'お手本を作る' : '読み込む'}</button>
            </details>
            <p id="replay-load-status" role="status" aria-live="polite"></p>
            <section id="replay-camera" class="hidden" aria-label="リプレイ視聴">
                <p id="replay-source-description" class="result-note"></p>
                <div id="replay-scene-stats" class="replay-scene-stats"></div>
                <p id="replay-stats-timing" class="result-note"></p>
                <nav class="replay-transport" aria-label="時間を移動">
                    <button id="replay-previous" type="button" class="btn-secondary" aria-label="前のページ">⏪</button>
                    <span id="replay-page-position" aria-label="視聴ページ" aria-live="polite"></span>
                    <button id="replay-next" type="button" class="btn-secondary" aria-label="次のページ">⏩</button>
                </nav>
                <h2 id="replay-scene-title"></h2><p id="replay-actual-choice"></p>
                <div id="replay-original-placements"></div><div id="replay-scene-cards" class="replay-cards-grid"></div>
                <p id="replay-ai-status" role="status" aria-live="polite"></p>
                <button id="replay-ai-reason" type="button" class="btn-secondary" aria-expanded="false" disabled>🐤 選択理由</button>
                <p id="replay-ai-explanation" class="hidden"></p>
                <button id="replay-ai-retry" type="button" class="btn-secondary hidden">もう一度確認する</button>
                <button id="replay-generate-example" type="button" class="btn-primary">🐤 同じシードのお手本を作る</button>
            </section>
            <p id="replay-example-status" role="status" aria-live="polite"></p>
            <section id="replay-example-result" class="hidden" aria-label="生成したお手本">
                <h2>あひる先生のお手本</h2><p id="replay-example-summary"></p>
                <label for="replay-example-code">お手本のリプレイデータ</label>
                <textarea id="replay-example-code" readonly rows="3" spellcheck="false"></textarea>
                <button id="replay-example-copy" type="button" class="btn-secondary">リプレイデータをコピー</button>
                <button id="replay-example-view" type="button" class="btn-primary">📹 このお手本を見る</button>
            </section>`;
        document.body.appendChild(overlay);
        this.observer = new MutationObserver(() => { if (this.overlay === overlay && !overlay.isConnected) this.close(); });
        this.observer.observe(document.body, { childList: true });
        const input = this.node('replay-view-input');
        input.addEventListener('paste', event => {
            const plain = event.clipboardData?.getData('text/plain'); if (!plain) return;
            event.preventDefault(); input.setRangeText(plain, input.selectionStart, input.selectionEnd, 'end');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        input.addEventListener('input', () => {
            this.record = null; this.stopAnalysis(); this.scenes = []; this.cache.clear();
            this.node('replay-camera').classList.add('hidden'); this.node('replay-example-result').classList.add('hidden');
            this.node('replay-load-status').textContent = '';
        });
        this.node('replay-view-load').onclick = () => this.loadInput();
        this.node('replay-previous').onclick = () => this.go(this.cursor - 1);
        this.node('replay-next').onclick = () => this.go(this.cursor + 1);
        this.node('replay-ai-reason').onclick = () => {
            this.reasonOpen = !this.reasonOpen; this.showDecision(this.cache.get(this.scenes[this.cursor].key));
        };
        this.node('replay-ai-retry').onclick = () => { this.analysisError = null; this.stopAnalysis(); this.requestAnalysis(); };
        this.node('replay-generate-example').onclick = () => this.generateExample();
        this.node('replay-example-copy').onclick = async () => {
            try { await navigator.clipboard.writeText(this.example.text); if (this.live(session)) this.node('replay-example-status').textContent = 'コピーしました。'; }
            catch { if (this.live(session)) this.node('replay-example-status').textContent = 'コピーできませんでした。コードを選択してコピーしてください。'; }
        };
        this.node('replay-example-view').onclick = () => {
            this.node('replay-view-input').value = this.example.text; this.showRecord(this.example.record);
        };
        if (text) { input.value = text; this.loadInput(); }
    }
    node(id) { return this.overlay?.querySelector(`#${id}`); }
    live(session) { return session === this.session && !!this.overlay?.isConnected; }
    setBusy(busy) {
        for (const id of ['replay-view-input', 'replay-view-load', 'replay-generate-example']) {
            const node = this.node(id); if (node) node.disabled = busy;
        }
    }
    async loadInput() {
        const session = this.session; this.setBusy(true);
        this.node('replay-load-status').textContent = '読み込んでいます…';
        try {
            const record = validateBattleReplay(await decodeReplay(this.node('replay-view-input').value, { currentBuildVersion: window.BUILD_VERSION }));
            if (!this.live(session)) return;
            this.record = record; this.node('replay-load-status').textContent = '';
            if (this.mode === 'example') this.generateExample();
            else this.showRecord(record);
        } catch (error) { if (this.live(session)) this.node('replay-load-status').textContent = error.message; }
        finally { if (this.live(session) && !this.modelWorker) this.setBusy(false); }
    }
    stopAnalysis() { this.analysisWorker?.terminate(); this.analysisWorker = null; this.analysisBusy = false; }
    showRecord(record) {
        const scenes = replayScenes(record);
        this.mode = 'view'; this.node('replay-view-load').textContent = '読み込む';
        this.stopAnalysis(); this.record = record; this.scenes = scenes; this.cursor = 0; this.cache.clear(); this.analysisError = null;
        this.node('replay-camera').classList.remove('hidden'); this.node('replay-input-panel').open = false;
        this.overlay.querySelector('.info-overlay-title').textContent = '教室防犯カメラ';
        this.overlay.setAttribute('aria-label', '教室防犯カメラ');
        const description = `${record.metadata.cpuPolicy ? 'あひる先生' : 'プレイ記録'} / ${record.metadata.difficulty.toUpperCase()}${record.metadata.eventId ? ' / イベント' : ''}`;
        this.node('replay-source-description').textContent = description;
        this.renderScene();
        this.overlay.querySelector('.info-overlay-content').scrollTop = 0;
    }
    go(index) {
        if (index < 0 || index >= this.scenes.length) return;
        this.cursor = index; this.analysisError = null; this.renderScene();
        this.overlay.querySelector('.info-overlay-content').scrollTop = 0;
    }
    renderScene() {
        const scene = this.scenes[this.cursor], escape = value => this.ui._escapeHTML(String(value));
        this.node('replay-page-position').textContent = `${this.cursor + 1} / ${this.scenes.length}`;
        this.node('replay-previous').disabled = this.cursor === 0; this.node('replay-next').disabled = this.cursor === this.scenes.length - 1;
        const config = getDifficultyConfig(this.record.metadata.difficulty);
        this.node('replay-scene-title').textContent = `${scene.turn + 1}/${this.record.metadata.totalTurns}ターン ${config.turns[scene.turn].name}：${scene.label}`;
        this.node('replay-scene-stats').innerHTML = Object.entries(STATS).map(([key, label]) => `<div><span>${label}</span><strong data-stat="${key}">${escape(scene.stats[key])}</strong></div>`).join('');
        this.node('replay-stats-timing').textContent = scene.kind === 'action' ? '効果解決後のステータス' : scene.kind === 'meeting' ? '削除前のステータス' : '取得前のステータス';
        this.node('replay-actual-choice').textContent = scene.kind === 'training' && !scene.selectedIndices.length ? '記録の選択：取得しない' : scene.kind === 'meeting' && !scene.selectedIds.length ? scene.skipped ? 'このターンの教室会議はありません。' : '記録の選択：削除しない' : '';
        const placements = this.node('replay-original-placements'); placements.replaceChildren();
        if (scene.kind === 'action') {
            for (const slot of config.slots) {
                const row = document.createElement('p');
                row.textContent = `${slot.name}：${(scene.placements[slot.id] || []).map(id => scene.cards.find(card => card.instanceId === id)?.cardName || '').join('、') || '配置なし'}`;
                placements.appendChild(row);
            }
        }
        const cards = this.node('replay-scene-cards'); cards.replaceChildren();
        const entries = [];
        scene.cards.forEach((card, index) => {
            const same = scene.kind === 'training' && this.record.metadata.calcMode ? entries.find(entry => String(entry.card.cardNo) === String(card.cardNo)) : null;
            if (same) same.indices.push(index); else entries.push({ card, indices: [index] });
        });
        for (const { card, indices } of entries) {
            const actualCount = scene.kind === 'training' ? indices.filter(i => scene.selectedIndices.includes(i)).length : Number(scene.selectedIds.includes(card.instanceId));
            const node = document.createElement('article'); node.className = `card replay-readonly-card${actualCount ? ' replay-actual-card' : ''}`;
            node.dataset.indices = JSON.stringify(indices); node.dataset.instanceId = card.instanceId || '';
            node.innerHTML = `<div class="replay-card-marks"><span>${actualCount ? `${scene.kind === 'training' ? '取得' : scene.kind === 'meeting' ? '削除' : '配置'}${actualCount > 1 ? `×${actualCount}` : ''}` : ''}</span><button type="button" data-cpu-choice class="replay-duck" hidden aria-label="あひる先生の選択理由を開く">🐤</button></div>
                <div class="card-header"><span class="card-name">${escape(card.cardName)}</span><span class="card-meta">${escape(card.category)} ${escape(card.rarity)}</span></div>
                <div class="card-body"><div class="card-effect">${escape(card.topEffect || card.effect)}</div>${this.ui.buildCardThumbnailHTML(card, 'card-thumbnail')}</div>
                ${card.topEffect && card.topEffect !== card.effect ? `<details class="replay-card-detail"><summary>効果全文</summary><p>${escape(card.effect)}</p></details>` : ''}`;
            node.querySelector('[data-cpu-choice]').onclick = () => {
                this.reasonOpen = true; this.showDecision(this.cache.get(scene.key));
                this.node('replay-ai-explanation').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            };
            this.ui.setupCardThumbnailFallback(node); cards.appendChild(node);
        }
        this.node('replay-ai-retry').classList.add('hidden');
        this.showDecision(this.cache.get(scene.key)); this.requestAnalysis();
    }
    showDecision(decision) {
        const scene = this.scenes[this.cursor]; if (!scene) return;
        for (const card of this.node('replay-scene-cards').children) {
            const count = decision ? scene.kind === 'training'
                ? JSON.parse(card.dataset.indices).filter(i => decision.selectedIndices.includes(i)).length
                : Number(decision.selectedIds.includes(card.dataset.instanceId)) : 0;
            const mark = card.querySelector('[data-cpu-choice]'); mark.hidden = !count; mark.textContent = count > 1 ? `🐤×${count}` : '🐤';
        }
        this.node('replay-ai-reason').disabled = !decision;
        this.node('replay-ai-reason').setAttribute('aria-expanded', String(this.reasonOpen && !!decision));
        this.node('replay-ai-explanation').classList.toggle('hidden', !this.reasonOpen || !decision);
        this.node('replay-ai-explanation').textContent = decision?.reason || '';
        this.node('replay-ai-status').textContent = decision ? decision.refresh ? 'あひる先生はリフレッシュで候補を更新します。' : '🐤 同じ場面であひる先生が選ぶカード' : 'あひる先生がこの場面を確認中…';
    }
    requestAnalysis() {
        const scene = this.scenes[this.cursor];
        if (!scene || this.analysisBusy || this.cache.has(scene.key) || this.analysisError === scene.key) return;
        const session = this.session, record = this.record, id = ++this.jobId;
        if (!this.analysisWorker) this.analysisWorker = this.worker();
        const worker = this.analysisWorker; this.analysisBusy = true;
        const fail = message => {
            if (!this.live(session) || this.record !== record) return;
            this.stopAnalysis(); this.analysisError = this.scenes[this.cursor].key;
            this.node('replay-ai-status').textContent = `この場面を確認できませんでした。${message}`;
            this.node('replay-ai-retry').classList.remove('hidden');
        };
        worker.onerror = () => fail('通信状態を確認して、もう一度お試しください。');
        worker.onmessage = event => {
            if (!this.live(session) || this.record !== record || event.data.id !== id) return;
            if (event.data.error) { fail(event.data.error); return; }
            if (!event.data.decision) return;
            this.analysisBusy = false; this.cache.set(scene.key, event.data.decision);
            if (this.scenes[this.cursor].key === scene.key) this.showDecision(event.data.decision);
            this.requestAnalysis();
        };
        try {
            worker.postMessage({ type: 'scene', id, buildVersion: window.BUILD_VERSION,
                source: sceneAnalysisSource(record, scene), scene: sceneAnalysisInput(scene) });
        } catch (error) { fail(error.message); }
    }
    generateExample() {
        if (!this.record || this.modelWorker) return;
        const source = this.record, session = this.session, id = ++this.jobId, worker = this.worker();
        this.modelWorker = worker; this.setBusy(true); this.node('replay-example-result').classList.add('hidden');
        this.node('replay-example-status').textContent = 'あひる先生が同じシードでプレイしています…';
        const finish = message => {
            worker.terminate(); if (!this.live(session)) return;
            this.modelWorker = null; this.setBusy(false); this.node('replay-example-status').textContent = message;
        };
        worker.onerror = () => finish('お手本を作れませんでした。通信状態を確認して、もう一度お試しください。');
        worker.onmessage = event => {
            if (!this.live(session) || event.data.id !== id) return;
            if (event.data.error) { finish(event.data.error); return; }
            if (event.data.progress != null) this.node('replay-example-status').textContent = `あひる先生が同じシードでプレイしています… ${event.data.progress}/8ターン`;
            if (!event.data.record) return;
            this.example = { record: event.data.record, text: event.data.text };
            this.node('replay-example-code').value = event.data.text;
            this.node('replay-example-summary').textContent = `${event.data.record.metadata.difficulty.toUpperCase()} / 元の記録と同じシード${source.metadata.eventId ? ' / イベントを引き継ぎ' : ''}`;
            this.node('replay-example-result').classList.remove('hidden'); finish('お手本が完成しました。');
        };
        worker.postMessage({ type: 'example', id, buildVersion: window.BUILD_VERSION, record: source });
    }
}
