import { supportsAcquisitionAdvice } from './acquisitionAdvisor.js?v=20260815-0060';
import {explainAcquisitionCandidates} from './acquisitionExplanation.js?v=20260815-0060';

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
        return supportsAcquisitionAdvice(state.difficulty) && !state.calcMode && !state.event?.enabled && state.phase === 'training';
    }
    clear() {
        clearTimeout(this.timer);
        this.shown = false;
        this.ui.cardDetails?.schedule();
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
        const presentedAt = performance.now();
        try {
            const scene=this.ui.ahiruAdvice.getSceneDecision();
            if(!scene?.acquisition)return;
            const explanations=explainAcquisitionCandidates({observation:scene.observation,advice:scene.acquisition,status:scene.status});
            this.context = { observation:scene.observation, advice:scene.acquisition, explanations, presentedAt, recorded: false };
            this.ui.ahiruAdvice.scheduleRefresh();
            this.schedule();
        } catch (error) { console.warn('[取得アシスト]',error.message); }
    }
    refreshAdvice() {
        // 表示済みの候補では補正到着後も順位と提示期限を固定する。
        if(!this.context&&this.eligible())this.present();
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
        this.ui.cardDetails?.schedule();
    }
    setEnabled(enabled) {
        this.enabled = enabled;
        try { localStorage.setItem(AcquisitionAssistController.KEY,enabled ? 'on' : 'off'); } catch { /* 再読み込みまでは反映 */ }
        this.clear(); this.schedule();
    }
    explanation(card) {
        if (!this.enabled || !this.shown || !this.context || !this.eligible()) return '';
        const index = this.context.observation.candidates.findIndex(item => String(item.cardNo) === String(card.cardNo));
        return this.context.explanations?.[index]?.text||'';
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
