const MOVE_THRESHOLD = 10;

export class CardDrag {
    constructor({ slots, canDrag, place }) {
        this.slots = slots;
        this.canDrag = canDrag;
        this.place = place;
        document.addEventListener('dragover', event => {
            if (!this.active || this.active.ghost) return;
            const target = this.highlight(event);
            if (!target) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
        });
        document.addEventListener('drop', event => {
            if (!this.active || this.active.ghost) return;
            event.preventDefault();
            this.drop(event);
        });
    }

    bind(element, card, source) {
        let press;
        element.draggable = true;
        element.addEventListener('pointerdown', event => {
            if (!event.isPrimary || event.button !== 0) return;
            press = { id: event.pointerId, x: event.clientX, y: event.clientY, type: event.pointerType };
            if (source && event.isTrusted && event.pointerType !== 'mouse' && this.canDrag()) {
                element.setPointerCapture(event.pointerId);
            }
        });
        element.addEventListener('dragstart', event => {
            if (!this.canDrag() || (press && press.type !== 'mouse')) {
                event.preventDefault();
                return;
            }
            this.start(element, card, source, press ?? { x: event.clientX, y: event.clientY });
            event.dataTransfer.setData('text/plain', card.cardName);
            event.dataTransfer.effectAllowed = 'move';
        });
        element.addEventListener('dragend', () => {
            if (this.active?.element === element) this.clear();
            press = null;
        });

        if (!source) return;
        element.classList.add('drag-from-staff');
        element.addEventListener('pointermove', event => {
            if (press?.id !== event.pointerId || press.type === 'mouse' || !this.canDrag()) return;
            if (!this.active) {
                if (document.querySelector('.effect-tooltip')) return;
                if (Math.hypot(event.clientX - press.x, event.clientY - press.y) <= MOVE_THRESHOLD) return;
                this.start(element, card, source, press);
                const ghost = element.cloneNode(true);
                ghost.className = 'card card-drag-preview';
                ghost.setAttribute('aria-hidden', 'true');
                ghost.removeAttribute('tabindex');
                ghost.style.width = `${this.active.width}px`;
                ghost.style.height = `${this.active.height}px`;
                this.active.ghost = ghost;
                document.body.appendChild(ghost);
            }
            if (this.active.element !== element) return;
            const { x, y } = this.dragPosition(event);
            this.active.ghost.style.transform = `translate(${x}px, ${y}px)`;
            this.highlight(event);
        });
        element.addEventListener('pointerup', event => {
            if (press?.id !== event.pointerId || !this.active?.ghost || this.active.element !== element) return;
            this.drop(event);
        });
        const cancel = () => {
            press = null;
            if (this.active?.element === element && this.active.ghost) this.clear();
        };
        element.addEventListener('pointercancel', cancel);
        element.addEventListener('lostpointercapture', cancel);
    }

    start(element, card, source, press) {
        this.clear();
        document.querySelector('.hover-tooltip')?.remove();
        const rect = element.getBoundingClientRect();
        this.active = { element, card, source, width: rect.width, height: rect.height,
            offsetX: press.x - rect.left, offsetY: press.y - rect.top };
        element.classList.add('dragging');
    }

    dragPosition(event) {
        return { x: event.clientX - this.active.offsetX, y: event.clientY - this.active.offsetY };
    }

    highlight(event) {
        const { width, height } = this.active;
        const { x, y } = this.dragPosition(event);
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        let closest = null;
        let bestDistance = Infinity;
        if (this.canDrag()) {
            for (const slot of this.slots()) {
                const rect = slot.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0 ||
                    x >= rect.right || x + width <= rect.left || y >= rect.bottom || y + height <= rect.top) continue;
                const distance = Math.hypot(centerX - (rect.left + rect.width / 2), centerY - (rect.top + rect.height / 2));
                if (distance < bestDistance) {
                    closest = slot;
                    bestDistance = distance;
                }
            }
        }
        if (closest !== this.target) {
            this.target?.classList.remove('drag-over');
            closest?.classList.add('drag-over');
            this.target = closest;
        }
        return closest;
    }

    drop(event) {
        const { card, source } = this.active;
        const staff = this.highlight(event)?.dataset.staff;
        this.clear();
        if (staff && staff !== source) this.place(card, staff, source);
    }

    clear() {
        this.active?.element.classList.remove('dragging');
        this.active?.ghost?.remove();
        this.target?.classList.remove('drag-over');
        this.active = null;
        this.target = null;
    }
}
