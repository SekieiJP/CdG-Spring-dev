/** 長押し・スクロール・タップを区別し、長押し後の合成clickを抑止する。 */
export function bindCardInteraction(element, { activate, details, hover }) {
    let timer, hoverTimer, origin, moved = false, longPressed = false, lastTouch = 0;
    const cancel = () => clearTimeout(timer);
    element.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button > 0) return;
        if (event.pointerType !== 'mouse') lastTouch = Date.now();
        origin = { x: event.clientX, y: event.clientY }; moved = false; longPressed = false;
        timer = setTimeout(() => { longPressed = true; details(); }, 500);
    });
    element.addEventListener('pointermove', event => {
        if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) { moved = true; cancel(); }
    });
    element.addEventListener('pointerup', () => { cancel(); origin = null; });
    element.addEventListener('pointercancel', () => { cancel(); moved = true; origin = null; });
    element.addEventListener('dragstart', () => { cancel(); moved = true; });
    element.addEventListener('contextmenu', event => event.preventDefault());
    element.addEventListener('click', event => {
        if (longPressed || moved) { event.preventDefault(); event.stopPropagation(); return; }
        if (event.target.closest('.card-detail-hint')) { event.stopPropagation(); details(); return; }
        activate?.();
    });
    element.tabIndex = 0;
    element.addEventListener('keydown', event => {
        if (event.target !== element || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault(); activate ? activate() : details();
    });
    element.addEventListener('mouseenter', () => {
        if (Date.now() - lastTouch < 600) return;
        hoverTimer = setTimeout(() => { if (element.isConnected && element.offsetParent && matchMedia('(hover: hover)').matches) hover?.(); }, 500);
    });
    element.addEventListener('mouseleave', () => {
        clearTimeout(hoverTimer); document.querySelector('.hover-tooltip')?.remove();
    });
}
