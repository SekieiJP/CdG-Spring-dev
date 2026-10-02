/**
 * ScoreSubmitter - ゲーム完了時のスコアをGAS Web Appに送信
 */
import { getEventItem } from './eventManager.js?v=20260815-0052';

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
                ? state.conditionMetTurns.filter(turn => Number.isInteger(turn) && turn >= 1 && turn <= 8)
                : [];
            const conditionMetTurns = [...new Set(turns)].sort((a, b) => a - b);
            return {
                name: getEventItem(itemId)?.name || itemId,
                conditionMetTurns
            };
        });
}

export async function submitScore(gameState, score, finalDeck, logger) {
    if (SCORE_ENDPOINT.includes('DEPLOY_ID')) {
        logger?.log('⚠️ スコア送信: エンドポイント未設定', 'info');
        return { ok: false, skipped: true, reason: 'endpoint_unset' };
    }

    const payload = {
        startedAt: gameState.startedAt || null,
        completedAt: new Date().toISOString(),
        buildVersion: window.BUILD_VERSION || 'unknown',
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
    };

    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 2000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(SCORE_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const result = await response.json();
            if (result.status !== 'ok') {
                throw new Error(`server: ${result.message || 'unknown error'}`);
            }
            logger?.log('📤 スコアを送信しました', 'info');
            const currentVersion = result.currentVersion || null;
            const clientVersion = result.clientVersion || payload.buildVersion;
            return {
                ok: true,
                currentVersion,
                clientVersion,
                versionMatch: currentVersion
                    ? isClientVersionCurrent(clientVersion, currentVersion)
                    : result.versionMatch !== false
            };
        } catch (e) {
            console.warn(`[ScoreSubmit] 試行${attempt}/${MAX_RETRIES} 失敗:`, e.message);
            if (attempt < MAX_RETRIES) {
                logger?.log(`⚠️ スコア送信失敗 (${attempt}/${MAX_RETRIES}回目)、${RETRY_DELAY_MS / 1000}秒後にリトライします`, 'error');
                await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
            } else {
                logger?.log(`❌ スコア送信に失敗しました（${MAX_RETRIES}回試行）: ${e.message}`, 'error');
                return { ok: false, error: e.message };
            }
        }
    }
}
