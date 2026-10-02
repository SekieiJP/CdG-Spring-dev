/** 共通のカード解決。条件とコストはおすすめ加算前の状態で判定する。 */
export const STATUS_KEYS = Object.freeze(['experience', 'enrollment', 'satisfaction', 'accounting']);

export function snapshotStats(player) {
    return Object.fromEntries(STATUS_KEYS.map(key => [key, player[key]]));
}

export function resolveCardAction(cardManager, gameState, card, staff, config = {}, logger = null) {
    const beforeStats = snapshotStats(gameState.player);
    const beforeTokens = { ...gameState.tokens };
    const isRecommended = !!(config.recommended && card.category === config.recommended);
    const costCheck = cardManager.simulateCardEffect(card, staff, beforeStats, null, gameState);
    const parsed = cardManager.parseEffect(card?.effect || '');
    const conditions = parsed.conditionalBlocks.map(block => ({
        condition: block.condition,
        matched: cardManager.evaluateCondition(block.condition, staff, {
            player: beforeStats, turn: gameState.turn, totalTurns: gameState.totalTurns
        })
    }));
    let result = costCheck;
    let recommendedApplied = false;

    if (costCheck.applied) {
        if (isRecommended && config.recommendedStatus) {
            gameState.updateStatus(config.recommendedStatus, 1);
            recommendedApplied = true;
            logger?.log(`おすすめ行動ボーナス: ${config.recommended} x1`, 'action');
        }
        result = cardManager.applyCardEffect(card, staff, gameState, beforeStats, { costStats: beforeStats });
    } else {
        logger?.log(`コスト不足: ${card.cardName}の効果は無効`, 'warning');
    }

    return {
        cardName: card.cardName,
        cardNo: card.cardNo,
        definitionId: card.definitionId,
        instanceId: card.instanceId,
        staff,
        turn: gameState.turn,
        conditions,
        category: card.category,
        beforeStats,
        afterStats: snapshotStats(gameState.player),
        beforeTokens,
        afterTokens: { ...gameState.tokens },
        isRecommended,
        recommendedApplied,
        applied: result.applied,
        skippedReason: result.skippedReason,
        shortageEffects: result.shortageEffects || []
    };
}
