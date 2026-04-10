/**
 * ScoreSubmitter - ゲーム完了時のスコアをGAS Web Appに送信
 */
const SCORE_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzaVE8aQRid2p_ZQSr0N40Z1ysd2T0m6CvTQst7vCa_KPNiNp628HAQDiYQdLVbMysAEg/exec';

export async function submitScore(gameState, score, finalDeck, logger) {
    if (SCORE_ENDPOINT.includes('DEPLOY_ID')) {
        logger?.log('⚠️ スコア送信: エンドポイント未設定', 'info');
        return;
    }

    const payload = {
        startedAt: gameState.startedAt || null,
        completedAt: new Date().toISOString(),
        buildVersion: window.BUILD_VERSION || 'unknown',
        difficulty: gameState.difficulty || 'fresh',
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
        discardedCards: gameState.discardedCards || []
    };

    try {
        const response = await fetch(SCORE_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload)
        });
        if (response.ok) {
            logger?.log('📤 スコアを送信しました', 'info');
        } else {
            logger?.log('⚠️ スコア送信に失敗しました', 'error');
        }
    } catch (e) {
        logger?.log('⚠️ スコア送信に失敗しました', 'error');
        console.warn('[ScoreSubmit] エラー:', e.message);
    }
}
