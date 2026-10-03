import { createAdvisorObservation, recommendAcquisition } from './freshAcquisitionAdvisor.js?v=20260815-0054';

/** 設定・5秒の提示期限・候補DOMだけを管理する。選択やゲーム進行は行わない。 */
export class AcquisitionAssistController {
    static KEY = 'cdg_acquisition_assist';
    constructor(ui) { this.ui = ui; this.enabled = true; this.shown = false; }
    init() {
        try { this.enabled = localStorage.getItem(AcquisitionAssistController.KEY) !== 'off'; } catch { /* 端末内の設定を使う */ }
        this.container = document.getElementById('training-cards');
        this.observer = new MutationObserver(() => this.present());
        this.observer.observe(this.container, { childList: true });
    }
    eligible() {
        const state = this.ui.gameState;
        return state.difficulty === 'fresh' && !state.calcMode && !state.event?.enabled && state.phase === 'training';
    }
    clear() {
        clearTimeout(this.timer);
        this.shown = false;
        for (const card of this.container?.children || []) {
            card.classList.remove('acquisition-recommended');
            if (card.dataset.assistAria) { card.setAttribute('aria-label',card.dataset.assistAria); delete card.dataset.assistAria; }
        }
    }
    leave() { this.clear(); this.context = null; }
    present() {
        this.clear(); this.context = null;
        const cards = this.ui.gameState.currentTrainingCards;
        if (!this.eligible() || !cards?.length || this.container.children.length < cards.length) return;
        const inspiration = this.ui.trainingSelectionMode === 'inspiration';
        const observation = createAdvisorObservation(this.ui.gameState, cards, {
            pickCount: this.ui.gameState.turn === 0 && !inspiration ? 2 : 1, allowSkip: inspiration
        });
        const presentedAt = performance.now();
        try {
            this.context = { observation, advice: recommendAcquisition(observation), presentedAt, recorded: false };
            this.schedule();
        } catch (error) { console.warn('[取得アシスト]',error.message); }
    }
    schedule() {
        clearTimeout(this.timer);
        if (!this.enabled || !this.context || !this.eligible()) return;
        const delay = Math.max(0,5000 - (performance.now() - this.context.presentedAt));
        this.timer = setTimeout(() => this.highlight(),delay);
    }
    highlight() {
        if (!this.enabled || !this.context || !this.eligible()) return;
        const { advice, observation } = this.context;
        const indices = advice.recommended?.skip ? [observation.candidates.length] : advice.recommended?.indices || [];
        for (const index of indices) {
            const card = this.container.children[index];
            if (!card) continue;
            card.classList.add('acquisition-recommended');
            card.dataset.assistAria = card.getAttribute('aria-label') || '取得しない';
            card.setAttribute('aria-label',`おすすめ。${card.dataset.assistAria}`);
        }
        this.shown = true;
    }
    setEnabled(enabled) {
        this.enabled = enabled;
        try { localStorage.setItem(AcquisitionAssistController.KEY,enabled ? 'on' : 'off'); } catch { /* 再読み込みまでは反映 */ }
        this.clear(); this.schedule();
    }
    explanation(card) {
        if (!this.enabled || !this.shown || !this.context || !this.eligible()) return '';
        const index = this.context.observation.candidates.findIndex(item => String(item.cardNo) === String(card.cardNo));
        const evaluation = this.context.advice.evaluations.find(item => item.indices.includes(index));
        return evaluation ? `取得アシスト：${evaluation.reasons.join('・')}を評価しています` : '';
    }
    recordChoice(override = null) {
        if (!this.context || this.context.recorded || !this.eligible()) return;
        const inspiration = this.ui.trainingSelectionMode === 'inspiration';
        const selection = override || (this.ui.gameState.turn === 0 && !inspiration ? this.ui.selectedInitialCards || [] : [this.ui.selectedTrainingCard].filter(Boolean));
        const chosenIndices = selection.filter(card=>!card.__skip).map(card=>this.context.observation.candidates.findIndex(item => String(item.cardNo) === String(card.cardNo)));
        if (!selection.length || chosenIndices.some(index=>index<0) ||
            (chosenIndices.length !== this.context.observation.pickCount && !(this.context.observation.allowSkip && !chosenIndices.length))) return;
        this.context.recorded = true;
        this.ui.gameState.record('acquisition-decision', { observation: this.context.observation, advice: this.context.advice,
            chosenIndices, assistEnabled: this.enabled, assistShown: this.shown });
        this.clear();
    }
}
