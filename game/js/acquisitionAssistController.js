import { createAdvisorObservation, supportsAcquisitionAdvice } from './acquisitionAdvisor.js?v=20261122-0070';
import {explainAcquisitionCandidates} from './acquisitionExplanation.js?v=20261122-0070';

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
    get outing() { return this.ui.gameState.phase === 'outing'; }
    get candidateContainer() {
        return this.outing ? document.querySelector('#outing-content .outing-card-grid') : this.container;
    }
    eligible() {
        const state = this.ui.gameState;
        return state.battle?.kind !== 'cpu' && supportsAcquisitionAdvice(state.difficulty) && !state.calcMode && !state.event?.enabled && (state.phase === 'training' ||
            this.outing && state.ruleState.int?.outing?.stage === 'card');
    }
    clear() {
        clearTimeout(this.timer);
        this.shown = false;
        this.ui.cardDetails?.schedule();
        for (const [element, label] of this.highlighted || []) {
            element.classList.remove('acquisition-recommended');
            if (label === null) element.removeAttribute('aria-label');
            else element.setAttribute('aria-label', label);
        }
        this.highlighted = [];
    }
    leave() { this.clear(); this.context = null; }
    present() {
        this.clear(); this.context = null;
        const cards = this.ui.gameState.currentTrainingCards;
        const container = this.candidateContainer;
        if (!this.eligible() || !cards?.length || !container || container.children.length < cards.length) return;
        const presentedAt = performance.now();
        try {
            const scene = this.ui.ahiruAdvice.getSceneDecision();
            if (!scene?.acquisition) return;
            const master = this.ui.gameState.difficulty === 'int';
            const { acquisition: advice, status } = scene;
            const observation = master ? createAdvisorObservation(this.ui.gameState, cards, {
                pickCount: Math.min(scene.observation.offer.pickCount, cards.length),
                allowSkip: !!scene.observation.offer.allowSkip
            }) : scene.observation;
            const explanations = master
                ? observation.candidates.map((card, index) => ({
                    text: advice.recommended.indices.includes(index) ? `🐤${status.reason}` : ''
                }))
                : explainAcquisitionCandidates({ observation, advice, status });
            this.context = { observation, advice, explanations, presentedAt, recorded: false };
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
        const container = this.candidateContainer;
        if (!container) return;
        let elements = (advice.recommended?.indices || []).map(index => container.children[index]);
        if (advice.refresh) {
            elements = [this.outing ? document.querySelector('#outing-content [data-outing-refresh]') : document.getElementById('btn-training-refresh')];
        } else if (advice.recommended?.skip) {
            elements = [this.ui.gameState.difficulty === 'int'
                ? document.getElementById('btn-training-skip') : container.children[observation.candidates.length]];
        }
        for (const element of elements.filter(Boolean)) {
            const label = element.getAttribute('aria-label');
            this.highlighted.push([element, label]);
            element.classList.add('acquisition-recommended');
            element.setAttribute('aria-label', `おすすめ。${label || element.textContent.trim() || '取得しない'}`);
        }
        this.shown = this.highlighted.length > 0;
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
