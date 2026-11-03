/** 表示設定と実際の描画結果から、詳細に追加情報があるカードだけに目印を出す。 */
export class CardDetailVisibility {
    constructor() {
        this.cards = new Map();
        this.observer = new ResizeObserver(() => this.schedule());
        window.addEventListener('resize', () => this.schedule());
        document.fonts?.ready.then(() => this.schedule());
    }
    register(element, { fullEffect, displayEffect, extra }) {
        this.cards.set(element, { fullEffect, displayEffect, extra });
        for (const part of [element, ...element.querySelectorAll('.card-name, .card-effect')]) this.observer.observe(part);
        this.schedule();
    }
    schedule() {
        if (this.frame) return;
        this.frame = requestAnimationFrame(() => { this.frame = null; this.update(); });
    }
    update() {
        for (const [element, info] of this.cards) {
            if (!element.isConnected) {
                for (const part of [element, ...element.querySelectorAll('.card-name, .card-effect')]) this.observer.unobserve(part);
                this.cards.delete(element); continue;
            }
            if (!element.getClientRects().length) continue;
            const clipped = [...element.querySelectorAll('.card-name, .card-effect')].some(part =>
                part.scrollHeight > part.clientHeight + 1 || part.scrollWidth > part.clientWidth + 1);
            const needed = String(info.fullEffect || '').trim() !== String(info.displayEffect || '').trim() || clipped || !!info.extra();
            element.querySelector('.card-detail-hint').hidden = !needed;
            element.setAttribute('aria-label', `${element.classList.contains('acquisition-recommended') ? 'おすすめ。' : ''}${element.querySelector('.card-name').textContent}${needed ? '。長押しで詳細' : ''}`);
        }
    }
}
