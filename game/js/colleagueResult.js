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

function formatNumber(value) {
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? String(value) : '—';
}

function formatPoints(value) {
    if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
    const points = Number(value);
    return `${points > 0 ? '+' : ''}${points}点`;
}

function renderDeck(ui, finalDeck) {
    const deck = document.getElementById('colleague-result-deck');
    const count = document.getElementById('colleague-result-deck-count');
    if (!deck || !count) return;

    deck.replaceChildren();
    const rarityOrder = { SSR: 0, SR: 1, R: 2, N: 3 };
    const grouped = new Map();
    for (const card of Array.isArray(finalDeck) ? finalDeck : []) {
        const cardNo = card.cardNo == null ? '' : String(card.cardNo);
        const key = cardNo || `${card.cardName || ''}|${card.rarity || ''}`;
        const entry = grouped.get(key);
        if (entry) entry.count += 1;
        else grouped.set(key, { ...card, cardNo, count: 1 });
    }

    const cards = [...grouped.values()].sort((a, b) => {
        const rarity = (rarityOrder[a.rarity] ?? 9) - (rarityOrder[b.rarity] ?? 9);
        return rarity || String(a.category || '').localeCompare(String(b.category || ''), 'ja');
    });
    count.textContent = `${Array.isArray(finalDeck) ? finalDeck.length : 0}枚`;
    const columns = Math.max(10, Math.ceil(cards.length / 2));
    deck.style.setProperty('--colleague-columns', String(columns));

    for (const card of cards) {
        const name = String(card.cardName || 'カード');
        const label = `${name}、${card.count}枚`;
        const thumb = document.createElement('div');
        thumb.className = 'colleague-result-thumb';
        thumb.setAttribute('role', 'img');
        thumb.setAttribute('aria-label', label);
        thumb.title = label;
        if (card.cardNo) thumb.dataset.cardNo = card.cardNo;

        const image = document.createElement('img');
        image.alt = '';
        image.loading = 'eager';
        image.decoding = 'async';
        image.src = ui.getCardIconPath?.(card) || '';
        const fallback = document.createElement('span');
        fallback.className = 'colleague-result-thumb-fallback';
        fallback.textContent = '🃏';
        fallback.hidden = true;
        image.addEventListener('error', () => {
            image.hidden = true;
            fallback.hidden = false;
        }, { once: true });
        thumb.append(image, fallback);

        if (card.count > 1) {
            const badge = document.createElement('span');
            badge.className = 'colleague-result-thumb-count';
            badge.textContent = `×${card.count}`;
            thumb.appendChild(badge);
        }
        deck.appendChild(thumb);
    }
}

function renderEvaluation(summary) {
    const score = summary.score || {};
    const breakdown = score.breakdown || {};
    const isPro = String(summary.difficulty || '').toLowerCase() === 'pro';
    const metrics = [
        ['enrollmentDiff', score.enrollmentDiff, breakdown.enrollmentDiffPoints],
        ['withdrawal', score.withdrawal, breakdown.withdrawalPoints],
        ['experience', score.experience ?? score.mobilization, breakdown.mobilizationPoints],
        ['satisfaction', score.satisfaction, isPro ? breakdown.satisfactionPoints : null],
        ['accounting', score.accounting, null],
        ['enrollment', score.enrollment, null]
    ];
    for (const [key, value, points] of metrics) {
        const row = document.querySelector(`#colleague-result-table [data-result-metric="${key}"]`);
        if (!row) continue;
        row.cells[1].textContent = formatNumber(value);
        row.cells[2].textContent = formatPoints(points);
        row.cells[2].classList.toggle('negative', Number(points) < 0);
    }

    const precision = document.getElementById('colleague-result-precision');
    const detail = score.splusBreakdown;
    if (precision) {
        if (detail) {
            const total = Number(score.displayScore) - Number(score.points);
            precision.textContent = `精度加点 +${total.toFixed(1)}点`;
            precision.hidden = false;
        } else {
            precision.textContent = '';
            precision.hidden = true;
        }
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
    const epoch = String(summary.buildVersion || '').match(/\d{8}/)?.[0]
        || String(summary.rulesVersion || '').match(/\d{8}/)?.[0] || '—';
    text('colleague-result-rules', epoch);
    const revenge = document.getElementById('colleague-result-revenge');
    revenge?.classList.toggle('hidden', !summary.room.revenge);
    text('colleague-result-score', `${formatNumber(summary.score?.displayScore)}点`);
    text('colleague-result-rank', summary.score?.rank?.grade || '—');
    renderEvaluation(summary);
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
