/** Safariの可視領域の変化に合わせ、多数手札を手札内でスクロールさせる。 */
export class MobileLayoutController {
    constructor(state) { this.state = state; }
    init() {
        const schedule = () => this.schedule();
        window.addEventListener('resize', schedule); window.visualViewport?.addEventListener('resize', schedule);
        if (globalThis.ResizeObserver) {
            this.observer = new ResizeObserver(schedule);
            for (const element of document.querySelectorAll('#full-header, #full-status-panel, .staff-area')) this.observer.observe(element);
        }
    }
    schedule({ resetScroll = false } = {}) {
        this.resetScroll ||= resetScroll;
        cancelAnimationFrame(this.frame);
        this.frame = requestAnimationFrame(() => this.update());
    }
    update() {
        const hand = document.getElementById('hand-cards');
        if (!hand) return;
        if (!matchMedia('(max-width: 480px)').matches || this.state.phase !== 'action' || this.state.calcMode) {
            this.resetScroll = false;
            hand.style.maxHeight = ''; return;
        }
        // 配置によるDOMの差し替えでブラウザが画面を自動スクロールしても、判断材料を上端に戻す。
        if (this.resetScroll) window.scrollTo(0, 0);
        this.resetScroll = false;
        const height = window.visualViewport?.height || window.innerHeight;
        const buttonHeight = document.getElementById('confirm-action')?.offsetHeight || 44;
        const safeBottom = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
        const areaStyle = getComputedStyle(hand.parentElement);
        const note = document.getElementById('draw-notification-bottom');
        const noteStyle = note && getComputedStyle(note);
        const bottomNote = note?.offsetHeight ? note.offsetHeight + parseFloat(noteStyle.marginTop) + parseFloat(noteStyle.marginBottom) : 0;
        const belowHand = parseFloat(areaStyle.paddingBottom) + parseFloat(areaStyle.marginBottom) + bottomNote + buttonHeight + safeBottom + 10;
        const handTop = hand.getBoundingClientRect().top + window.scrollY;
        hand.style.maxHeight = `${Math.max(100, Math.floor(height - handTop - belowHand))}px`;
    }
}
