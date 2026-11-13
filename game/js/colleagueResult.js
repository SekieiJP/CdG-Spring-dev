import { formatResultNumber, formatResultPoints, resultMetrics, resultPrecisionText, resultRulesEpoch, sortResultDeck } from './resultPresentation.js?v=20261110-0066';

const MOVED_RESULT_CONTROLS = [
    '#result-submission-status',
    '#result-comparison',
    '.result-replay-actions',
    '#result-favorite-status',
    '#result-replay-status',
    '#restart-game',
    '#view-result-history'
];

let movedControls = [];
let originalRestartLabel = null;

function restoreResultControls() {
    for (const entry of movedControls.sort((a, b) => a.index - b.index)) {
        if (!entry.node.isConnected || !entry.parent.isConnected) continue;
        entry.parent.insertBefore(entry.node, entry.parent.childNodes[entry.index] || null);
    }
    movedControls = [];
}

function moveResultControls(menu) {
    restoreResultControls();
    const entries = MOVED_RESULT_CONTROLS
        .map(selector => document.querySelector(selector))
        .filter(node => node && !menu.contains(node))
        .map(node => ({ node, parent: node.parentNode, index: [...node.parentNode.childNodes].indexOf(node) }));
    movedControls = entries;
    for (const entry of entries) menu.appendChild(entry.node);
}

function renderDeck(ui, finalDeck) {
    const deck = document.getElementById('colleague-result-deck');
    const count = document.getElementById('colleague-result-deck-count');
    if (!deck || !count) return;

    deck.replaceChildren();
    const cards = sortResultDeck(finalDeck);
    count.textContent = `${cards.length}枚`;
    const columns = Math.max(10, Math.ceil(cards.length / 2));
    deck.style.setProperty('--colleague-columns', String(columns));

    for (const card of cards) {
        const name = String(card.cardName || 'カード');
        const thumb = document.createElement('div');
        thumb.className = 'colleague-result-thumb';
        thumb.setAttribute('role', 'img');
        thumb.setAttribute('aria-label', name);
        thumb.title = name;
        if (card.cardNo) thumb.dataset.cardNo = card.cardNo;

        const fallback = document.createElement('span');
        fallback.className = 'colleague-result-thumb-fallback';
        fallback.textContent = '🃏';
        const src = ui.getCardIconPath?.(card);
        if (src) {
            const image = document.createElement('img');
            image.alt = '';
            image.decoding = 'async';
            fallback.hidden = true;
            image.addEventListener('error', () => {
                image.remove();
                fallback.hidden = false;
            }, { once: true });
            image.src = src;
            thumb.appendChild(image);
        }
        thumb.appendChild(fallback);
        deck.appendChild(thumb);
    }
}

function renderEvaluation(score) {
    for (const { key, value, points } of resultMetrics(score)) {
        const row = document.querySelector(`#colleague-result-table [data-result-metric="${key}"]`);
        if (!row) continue;
        row.cells[1].textContent = formatResultNumber(value);
        row.cells[2].textContent = formatResultPoints(points);
        row.cells[2].classList.toggle('negative', Number(points) < 0);
    }

    const precision = document.getElementById('colleague-result-precision');
    if (precision) {
        precision.textContent = resultPrecisionText(score);
        precision.hidden = !precision.textContent;
    }
}

function bindActions(ui) {
    const lobby = document.getElementById('colleague-result-lobby');
    if (lobby) lobby.onclick = () => ui.battleController?.openLobby({ kind: 'room' });

    const toggle = document.getElementById('colleague-result-menu-toggle');
    const menu = document.getElementById('colleague-result-menu');
    if (toggle && menu) {
        toggle.onclick = () => {
            menu.classList.toggle('hidden');
            const expanded = !menu.classList.contains('hidden');
            toggle.setAttribute('aria-expanded', String(expanded));
            toggle.textContent = expanded ? '閉じる' : 'メニュー';
        };
    }
}

/** 同僚と対戦の完了結果を、進行中の画面要素を隠した専用パネルへ描画する。 */
export function renderColleagueResult(ui, summary) {
    const panel = document.getElementById('colleague-result');
    if (!panel || !summary?.room) {
        clearColleagueResult();
        return;
    }

    const root = document.getElementById('result-area');
    root?.classList.add('colleague-result-active');
    document.body.classList.add('colleague-results');
    panel.classList.remove('hidden');

    const text = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.textContent = String(value ?? '');
    };
    text('colleague-result-room-code', summary.room.code);
    text('colleague-result-difficulty', (summary.difficultyName || summary.difficulty || '').toUpperCase());
    text('colleague-result-rules', resultRulesEpoch(summary));
    const revenge = document.getElementById('colleague-result-revenge');
    revenge?.classList.toggle('hidden', !summary.room.revenge);
    text('colleague-result-score', `${formatResultNumber(summary.score.displayScore)}点`);
    text('colleague-result-rank', summary.score?.rank?.grade || '—');
    renderEvaluation(summary.score);
    renderDeck(ui, summary.finalDeck);

    const menu = document.getElementById('colleague-result-menu-items');
    if (menu) moveResultControls(menu);
    const restart = document.getElementById('restart-game');
    if (restart) {
        if (originalRestartLabel === null) originalRestartLabel = restart.textContent;
        restart.textContent = 'タイトルへ';
    }
    bindActions(ui);
}

/** 通常の結果画面へ戻す。移動した既存アクションは元の位置へ戻す。 */
export function clearColleagueResult() {
    restoreResultControls();
    const restart = document.getElementById('restart-game');
    if (restart && originalRestartLabel !== null) restart.textContent = originalRestartLabel;
    originalRestartLabel = null;
    const panel = document.getElementById('colleague-result');
    panel?.classList.add('hidden');
    const menu = document.getElementById('colleague-result-menu');
    menu?.classList.add('hidden');
    const toggle = document.getElementById('colleague-result-menu-toggle');
    toggle?.setAttribute('aria-expanded', 'false');
    if (toggle) toggle.textContent = 'メニュー';
    document.getElementById('result-area')?.classList.remove('colleague-result-active');
    document.body.classList.remove('colleague-results');
}
