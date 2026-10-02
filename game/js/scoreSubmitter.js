/**
 * ScoreSubmitter - ゲーム完了時のスコアをGAS Web Appに送信
 */
import { getEventItem } from './eventManager.js?v=20260815-0053';
import { makeRunId } from './defaultRules.js?v=20260815-0053';

const SCORE_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzaVE8aQRid2p_ZQSr0N40Z1ysd2T0m6CvTQst7vCa_KPNiNp628HAQDiYQdLVbMysAEg/exec';
let userUUIDMemory = null;

/**
 * Cookieに永続化されたユーザーUUIDを返す（なければ生成して保存）
 */
export function getOrCreateUserUUID() {
    const cookieName = 'cdg_uuid';
    const match = document.cookie.match(new RegExp('(?:^|; )' + cookieName + '=([^;]*)'));
    if (match) {
        userUUIDMemory = decodeURIComponent(match[1]);
        return userUUIDMemory;
    }
    // file: URLなどでCookieが読み戻せない場合も、同一ページ内では表示と送信で同じUUIDを使う。
    if (userUUIDMemory) return userUUIDMemory;

    const uuid = userUUIDMemory = (crypto.randomUUID
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        }));
    const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `${cookieName}=${encodeURIComponent(uuid)}; expires=${expires}; path=/; SameSite=Strict`;
    return uuid;
}

export function buildVersionNumber(version) {
    const digits = String(version || '').replace(/\D/g, '');
    if (!digits) return null;
    const num = Number(digits);
    return Number.isFinite(num) ? num : null;
}

export function isClientVersionCurrent(clientVersion, currentVersion) {
    const clientNum = buildVersionNumber(clientVersion);
    const currentNum = buildVersionNumber(currentVersion);
    if (clientNum === null || currentNum === null) {
        return clientVersion === currentVersion;
    }
    return clientNum >= currentNum;
}

/**
 * GAS送信用に、入手済みの塾アイテムと条件成立ターンを整形する。
 * @param {Object} gameState
 * @returns {Array<{name: string, conditionMetTurns: number[]}>}
 */
export function buildSchoolItemsPayload(gameState) {
    const items = gameState?.event?.items;
    if (!gameState?.event?.enabled || !items) return [];

    return Object.entries(items)
        .filter(([, state]) => state?.acquired)
        .sort(([, a], [, b]) => (a.acquisitionOrder ?? 0) - (b.acquisitionOrder ?? 0))
        .map(([itemId, state]) => {
            const turns = Array.isArray(state.conditionMetTurns)
                ? state.conditionMetTurns.filter(turn => Number.isInteger(turn) && turn >= 1 && turn <= (gameState.totalTurns || 8))
                : [];
            const conditionMetTurns = [...new Set(turns)].sort((a, b) => a - b);
            return {
                name: getEventItem(itemId)?.name || itemId,
                conditionMetTurns
            };
        });
}

/** 完了時に一度確定し、次のゲームを始めても内容・ID・完了時刻を変えない。 */
export function buildScorePayload(gameState, score, finalDeck, metadata = {}) {
    gameState.runId ||= makeRunId();
    const record = gameState.playRecord?.metadata || {};
    return structuredClone({
        resultId: gameState.runId,
        totalTurns: gameState.totalTurns || 8,
        startedAt: gameState.startedAt || null,
        completedAt: new Date().toISOString(),
        buildVersion: globalThis.window?.BUILD_VERSION || 'unknown',
        rulesVersion: record.rulesVersion || metadata.rulesVersion || String(globalThis.window?.BUILD_VERSION || '').replace(/\D/g, '').slice(0, 8),
        cardVersion: record.cardVersion || metadata.cardVersion || 'unknown',
        rankVersion: record.rankVersion || metadata.rankVersion || 'unknown',
        userUUID: getOrCreateUserUUID(),
        difficulty: gameState.difficulty || 'fresh',
        mode: gameState.event?.enabled
            ? `イベント:(${gameState.event.eventName})${gameState.calcMode ? '/計算機' : ''}`
            : (gameState.calcMode ? '計算機' : '通常'),
        experience: score.experience,
        enrollment: score.enrollment,
        satisfaction: score.satisfaction,
        accounting: score.accounting,
        displayScore: score.displayScore,
        grade: score.rank.grade,
        points: score.points,
        withdrawal: score.withdrawal,
        mobilization: score.mobilization,
        enrollmentDiff: score.enrollmentDiff,
        finalDeck: finalDeck.map(c => c.cardName),
        discardedCards: gameState.discardedCards || [],
        schoolItems: buildSchoolItemsPayload(gameState)
    });
}

/** 1回の送信。JSON応答の読み込みまで含め、通信を8秒で打ち切る。 */
export async function submitPayload(payload, logger, { timeoutMs = 8000, signal, fetchImpl = globalThis.fetch } = {}) {
    const controller = new AbortController();
    let timer, onAbort;
    const stop = new Promise((_, reject) => {
        onAbort = () => { controller.abort(); reject(new Error('送信を中断しました')); };
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
        timer = setTimeout(() => { controller.abort(); reject(new Error('通信がタイムアウトしました')); }, timeoutMs);
    });
    try {
        const request = async () => {
            if (signal?.aborted) throw new Error('送信を中断しました');
            const response = await fetchImpl(SCORE_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await response.json();
            if (result.status !== 'ok') throw new Error(`server: ${result.message || 'unknown error'}`);
            if (result.resultId && result.resultId !== payload.resultId) throw new Error('結果IDが応答と一致しません');
            return result;
        };
        const result = await Promise.race([request(), stop]);
        logger?.log('📤 スコアを送信しました', 'info');
        const currentVersion = result.currentVersion || null;
        const clientVersion = result.clientVersion || payload.buildVersion;
        return { ok: true, duplicate: !!result.duplicate, currentVersion, clientVersion,
            versionMatch: currentVersion ? isClientVersionCurrent(clientVersion, currentVersion) : result.versionMatch !== false };
    } catch (error) {
        return { ok: false, error: error.message };
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
}

/** 旧呼び出し口。ゲーム画面は保存済み結果のSubmissionQueueを利用する。 */
export async function submitScore(gameState, score, finalDeck, logger) {
    const payload = buildScorePayload(gameState, score, finalDeck);
    for (let attempt = 0; attempt < 3; attempt++) {
        const result = await submitPayload(payload, logger);
        if (result.ok || attempt === 2) return result;
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}
