import { createMasterPolicy, observeMaster } from './masterPolicy.js?v=20261122-0069';

export function createMasterCpuPolicy(game) {
    const { gameState: state, cardManager, turnManager, scoreManager } = game;
    const decide = createMasterPolicy({ catalog: cardManager.allCards, scorer: scoreManager });
    const observation = () => observeMaster(turnManager);

    return {
        decide() { return decide(observation()); },
        training({ candidates, rarity, pickCount, drawCount, allowSkip }) {
            const obs = { ...observation(), kind: 'acquire', offer: { rarity, pickCount, offerCount: drawCount, allowSkip } };
            for (;;) {
                const move = decide({ ...obs, cards: candidates, refreshes: state.trainingRefreshRemaining });
                if (move.kind !== 'refresh') return { candidates, selected: move.indices.map(index => candidates[index]) };
                candidates = cardManager.refreshTrainingCards(rarity, candidates, drawCount);
                state.trainingRefreshRemaining--;
            }
        },
        place() {
            const move = decide(observation());
            for (const { id, staff } of move.moves) {
                const card = state.player.hand.find(item => item.instanceId === id);
                if (!card) throw new Error('CPUが手札のカードを配置できません');
                state.removeFromHand(card);
                state.placeCard(card, staff);
            }
            const invalid = turnManager.getActionValidationError();
            if (invalid) throw new Error(invalid);
        },
        delete() {
            for (const id of decide(observation()).ids) {
                const card = turnManager.getMeetingDeleteCandidates().find(item => item.instanceId === id);
                if (!card || !turnManager.deleteMeetingCard(card)) throw new Error('CPUが会議でカードを削除できません');
            }
            state.tokens.organize = 0;
        }
    };
}
