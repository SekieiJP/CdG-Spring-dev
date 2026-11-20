const MOVE_THRESHOLD = 10;
const DETAILS_DELAY = 500;

export function bindCardInteraction(element, { activate, details, hover, tapDetails = false }) {
    let timer, hoverTimer, origin, moved = false, longPressed = false, lastTouch = 0;
    const cancelPress = () => {
        clearTimeout(timer);
        origin = null;
    };
    const cancelHover = () => {
        clearTimeout(hoverTimer);
        document.querySelector('.hover-tooltip')?.remove();
    };
    element.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button > 0) return;
        cancelPress();
        moved = false;
        longPressed = false;
        if (event.pointerType === 'mouse') return;
        lastTouch = Date.now();
        cancelHover();
        origin = { x: event.clientX, y: event.clientY };
        timer = setTimeout(() => {
            longPressed = true;
            details();
        }, DETAILS_DELAY);
    });
    element.addEventListener('pointermove', event => {
        if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > MOVE_THRESHOLD) {
            moved = true;
            cancelPress();
        }
    });
    element.addEventListener('pointerup', cancelPress);
    element.addEventListener('pointercancel', () => {
        moved = true;
        cancelPress();
    });
    element.addEventListener('dragstart', () => {
        moved = true;
        cancelPress();
        cancelHover();
    });
    element.addEventListener('contextmenu', event => {
        if (Date.now() - lastTouch < 1000) event.preventDefault();
    });
    element.addEventListener('click', event => {
        if (longPressed || moved) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (tapDetails || event.target.closest('.card-detail-hint')) {
            event.stopPropagation();
            if (event.pointerType === 'touch' || event.pointerType === 'pen' || Date.now() - lastTouch < 600) details();
            return;
        }
        if (activate) {
            cancelHover();
            activate();
        }
    });
    element.tabIndex = 0;
    element.addEventListener('keydown', event => {
        if (event.target !== element || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        activate ? activate() : details();
    });
    element.addEventListener('pointerenter', event => {
        if (event.pointerType !== 'mouse') return;
        hoverTimer = setTimeout(() => {
            if (element.isConnected && element.offsetParent && !document.querySelector('.card.dragging, .effect-tooltip')) {
                hover?.();
            }
        }, DETAILS_DELAY);
    });
    element.addEventListener('pointerleave', cancelHover);
}
