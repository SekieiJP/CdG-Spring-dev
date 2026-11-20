import { getSharingPreference, listSharedDiaries, getSharedDiary } from './sharingConsent.js?v=20261122-0069';
import { getDifficultyDisplayName } from './difficultyConfig.js?v=20261122-0069';
import { sortResultDeck } from './resultPresentation.js?v=20261122-0069';

// 日誌の一覧は開いた時だけ取得する。設定変更や画面を閉じた後の応答は表示しない
export function mountSharedDiaries(viewer, host, sharedRecord) {
    const { ui } = viewer;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'btn-secondary';
    trigger.textContent = '他の先生の日誌';
    trigger.setAttribute('aria-expanded', 'false');
    const note = document.createElement('p');
    note.className = 'result-note';
    const panel = document.createElement('section');
    panel.hidden = true;
    panel.setAttribute('aria-label', '他の先生の日誌');
    const list = document.createElement('div');
    list.className = 'shared-diary-list';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'btn-secondary';
    more.hidden = true;
    panel.append(list, status, more);
    host.append(trigger, note, panel);
    let before = null, request = 0;
    const active = id => id === request && host.isConnected && getSharingPreference().enabled;
    const closeList = () => {
        request++;
        panel.hidden = true;
        panel.removeAttribute('aria-busy');
        list.replaceChildren();
        trigger.setAttribute('aria-expanded', 'false');
        before = null;
        status.textContent = '';
        more.hidden = true;
    };
    function syncAccess() {
        trigger.disabled = !getSharingPreference().enabled;
        note.hidden = !trigger.disabled;
        note.textContent = trigger.disabled ? 'プレイデータの送信と日誌の共有に同意すると利用できます。設定から変更できます。' : '';
        if (trigger.disabled) {
            closeList();
            if (sharedRecord) viewer.close();
        }
    }
    async function openEntry(entry, button) {
        const id = ++request;
        button.disabled = true;
        status.textContent = '日誌を読み込んでいます。';
        try {
            const record = await getSharedDiary(entry.resultId);
            if (!active(id)) return;
            viewer.open({ text: record.replayText, sharedRecord: true });
        } catch (error) {
            if (active(id)) status.textContent = '日誌を読み込めませんでした。' + error.message;
        } finally { button.disabled = false; }
    }
    function row(entry) {
        const article = document.createElement('article');
        const heading = document.createElement('h3');
        heading.textContent = entry.nickname;
        const metadata = document.createElement('p');
        const date = new Date(entry.completedAt);
        metadata.textContent = [date.toLocaleString('ja-JP'), getDifficultyDisplayName(entry.difficulty),
            entry.displayScore + '点'].join(' ／ ');
        const deck = document.createElement('ul');
        deck.setAttribute('aria-label', '最終デッキ');
        deck.className = 'shared-diary-deck';
        for (const card of sortResultDeck(entry.finalDeck)) {
            const item = document.createElement('li');
            const src = ui.getCardIconPath(card);
            if (src) {
                const image = document.createElement('img');
                image.loading = 'lazy';
                image.alt = card.cardName;
                image.title = card.cardName;
                image.src = src;
                item.appendChild(image);
            } else item.textContent = card.cardName;
            deck.appendChild(item);
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn-secondary';
        button.textContent = '日誌を読む';
        button.addEventListener('click', () => openEntry(entry, button));
        article.append(heading, metadata, deck, button);
        return article;
    }
    async function loadPage() {
        const id = ++request;
        more.hidden = true;
        panel.setAttribute('aria-busy', 'true');
        status.textContent = '一覧を読み込んでいます。';
        try {
            const page = await listSharedDiaries({ before });
            if (!active(id)) return;
            list.append(...page.entries.map(row));
            before = page.nextBefore;
            status.textContent = list.childElementCount ? '' : '公開されている日誌はまだありません。';
            more.textContent = 'さらに読み込む';
            more.hidden = !before;
        } catch (error) {
            if (!active(id)) return;
            status.textContent = '一覧を読み込めませんでした。' + error.message;
            more.textContent = 'もう一度読み込む';
            more.hidden = false;
        } finally {
            if (id === request) panel.removeAttribute('aria-busy');
        }
    }
    trigger.addEventListener('click', () => {
        if (!panel.hidden) { closeList(); return; }
        if (!getSharingPreference().enabled) { syncAccess(); return; }
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        loadPage();
    });
    more.onclick = loadPage;
    window.addEventListener('storage', syncAccess);
    window.addEventListener('cdg-sharing-changed', syncAccess);
    syncAccess();
    return () => {
        request++;
        window.removeEventListener('storage', syncAccess);
        window.removeEventListener('cdg-sharing-changed', syncAccess);
    };
}
