export const SHARING_PREFERENCE_KEY = 'cdg_sharing_preference_v1';
export const SCORE_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzaVE8aQRid2p_ZQSr0N40Z1ysd2T0m6CvTQst7vCa_KPNiNp628HAQDiYQdLVbMysAEg/exec';

function readPreference() {
    try { return JSON.parse(globalThis.localStorage?.getItem(SHARING_PREFERENCE_KEY) || 'null'); }
    catch { return null; }
}

export function getSharingPreference() {
    const saved = readPreference();
    return {
        enabled: saved?.enabled === true && !!saved.token && !!saved.grantId,
        decided: typeof saved?.enabled === 'boolean',
        nickname: saved?.nickname || '',
        revocationPending: !!saved?.pendingRevocation
    };
}

export function sharingGrantId() {
    return getSharingPreference().enabled ? readPreference()?.grantId : null;
}

export function tokenForSubmission(grantId) {
    const saved = readPreference();
    return saved?.enabled === true && saved.grantId && saved.grantId === grantId ? saved.token : null;
}

function savePreference(preference) {
    localStorage.setItem(SHARING_PREFERENCE_KEY, JSON.stringify(preference));
    window.dispatchEvent(new Event('cdg-sharing-changed'));
}

async function sharingRequest(action, parameters = {}, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
        const response = await fetch(SCORE_ENDPOINT, {
            method: 'POST', headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action, ...parameters }),
            signal: controller.signal
        });
        if (!response.ok) throw new Error('通信エラー');
        const result = await response.json();
        if (result.status !== 'ok') throw new Error(result.message || '通信エラー');
        return result;
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
    }
}

function requestDiaries(action, parameters) {
    const token = tokenForSubmission(sharingGrantId());
    if (!token) throw new Error('共有を有効にすると教室日誌を見られます。');
    return sharingRequest(action, { ...parameters, sharingToken: token }).then(result => {
        if (tokenForSubmission(sharingGrantId()) !== token) throw new Error('共有設定が変更されました。');
        return result;
    });
}

export async function listSharedDiaries({ before } = {}) {
    const { entries, nextBefore } = await requestDiaries('diary.list', { before });
    return { entries, nextBefore };
}

export async function getSharedDiary(resultId) {
    return (await requestDiaries('diary.get', { resultId })).entry;
}

export async function retrySharingRevocation() {
    const token = readPreference()?.pendingRevocation;
    if (!token) return;
    await sharingRequest('sharing.revoke', { sharingToken: token });
    if (readPreference()?.pendingRevocation === token) savePreference({ enabled: false });
}

async function enableSharing(nickname, signal) {
    nickname = nickname.trim();
    if (!nickname || [...nickname].length > 8 || /[\u0000-\u001f\u007f-\u009f]/.test(nickname)) {
        throw new Error('ニックネームは1〜8文字で入力してください。');
    }
    await retrySharingRevocation();
    if (signal.aborted) return;
    const saved = readPreference();
    if (saved?.enabled && saved.nickname === nickname) return;
    if (saved?.enabled) {
        await sharingRequest('sharing.rename', { nickname, sharingToken: saved.token });
        if (tokenForSubmission(saved.grantId) === saved.token) savePreference({ ...saved, nickname });
        return;
    }
    const { token, grantId } = await sharingRequest('sharing.enable', { nickname }, signal);
    if (signal.aborted) return;
    if (!token || !grantId) throw new Error('共有を設定できませんでした。');
    savePreference({ enabled: true, nickname, token, grantId });
}

async function disableSharing() {
    const saved = readPreference();
    const token = saved?.pendingRevocation || (saved?.enabled ? saved.token : null);
    savePreference({ enabled: false, ...(token ? { pendingRevocation: token } : {}) });
    await retrySharingRevocation();
}

export function showSharingSettings(ui, { firstPlay = false } = {}) {
    const preference = getSharingPreference();
    const overlay = ui.createInfoOverlay('プレイデータの送信と教室日誌', { preserveExisting: firstPlay });
    overlay.id = 'sharing-consent-overlay';
    const content = overlay.querySelector('.info-overlay-content');
    content.innerHTML = `
        <p>共有を有効にすると、これから始めるゲームの完了後に端末の識別子、得点、カードやターンの記録を運営に送信します。</p>
        <p>リプレイがある場合、ほかの共有参加者がニックネーム、プレイ日時、得点、最終デッキ、リプレイを見られます。自分も共有された教室日誌を見られます。</p>
        <p>設定からいつでも変更できます。共有を停止すると以降の送信を止め、通信でき次第この端末から共有した教室日誌を非表示にします。送信済みの運営記録や、他の人が取得済みのデータは残ります。</p>
        <form id="sharing-consent-form">
            <label for="sharing-nickname">ニックネーム（8文字以内）</label>
            <input id="sharing-nickname" type="text" autocomplete="off" spellcheck="false" required>
            <button type="submit" class="btn-primary" id="sharing-enable"></button>
            <button type="button" class="btn-secondary" id="sharing-disable"></button>
            <button type="button" class="btn-secondary" id="sharing-cancel" hidden>送信をキャンセル</button>
        </form>
        <p id="sharing-consent-status" role="status"></p>`;
    const form = content.querySelector('form');
    const nickname = content.querySelector('#sharing-nickname');
    const enable = content.querySelector('#sharing-enable');
    const disable = content.querySelector('#sharing-disable');
    const cancel = content.querySelector('#sharing-cancel');
    const status = content.querySelector('#sharing-consent-status');
    const close = overlay.querySelector('.info-overlay-close');
    nickname.value = preference.nickname;
    enable.textContent = preference.enabled ? 'ニックネームを変更' : '送信・共有に同意する';
    disable.textContent = preference.enabled || preference.revocationPending ? '送信・共有を停止' : '送信せずに遊ぶ';
    status.textContent = preference.revocationPending ? 'この端末の送信を停止しました。サーバーへの停止通知を待っています。' : '';
    document.body.append(overlay);

    return new Promise(resolve => {
        let active = null;
        const finish = () => { overlay.remove(); resolve(true); };
        const setBusy = (busy, cancellable = false) => {
            nickname.disabled = enable.disabled = disable.disabled = close.disabled = busy;
            cancel.hidden = !cancellable;
            status.classList.toggle('is-loading', cancellable);
        };
        close.addEventListener('click', () => resolve(false));
        overlay.addEventListener('keydown', event => { if (event.key === 'Escape') resolve(false); });
        overlay.addEventListener('keydown', event => { if (active && event.key === 'Escape') event.stopImmediatePropagation(); }, true);
        const apply = async (operation, { isDisable = false, cancellable = false } = {}) => {
            if (active) return;
            const controller = new AbortController();
            active = controller;
            setBusy(true, cancellable);
            if (cancellable) {
                status.textContent = '同意内容を送信しています…';
                cancel.focus();
            }
            try {
                await operation(controller.signal);
                if (active === controller) finish();
            } catch (error) {
                if (active !== controller) return;
                const stopping = getSharingPreference().revocationPending;
                status.textContent = stopping ? 'この端末の送信を停止しました。サーバーへ通知できませんでした。オンラインになると再試行します。'
                    : (!isDisable && error.message.startsWith('ニックネーム') ? error.message : '設定を保存できませんでした。もう一度お試しください。');
                if (firstPlay && isDisable) finish();
            } finally {
                if (active === controller) {
                    active = null;
                    setBusy(false);
                }
            }
        };
        cancel.addEventListener('click', () => {
            if (!active || cancel.hidden) return;
            active.abort();
            active = null;
            setBusy(false);
            status.textContent = '送信をキャンセルしました。';
            enable.focus();
        });
        form.addEventListener('submit', event => {
            event.preventDefault();
            void apply(signal => enableSharing(nickname.value, signal), { cancellable: !getSharingPreference().enabled });
        });
        disable.addEventListener('click', () => { void apply(disableSharing, { isDisable: true }); });
    });
}
