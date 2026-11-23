import { createMasterPolicy, observeMaster, MASTER_PLAY_POLICY, MASTER_POLICY_VERSION } from './masterPolicy.js?v=20261122-0070';
import { createAhiruRoleInspector } from './ahiruCardRoles.js?v=20261122-0070';
import { estimateSOutlook, withSOutlook } from './ahiruSOutlook.js?v=20261122-0070';

const AXES = { experience: '体験', enrollment: '入塾', satisfaction: '満足', accounting: '経理' };

export function createMasterAdvice({ turnManager, cardManager, scoreManager }) {
    const decide = createMasterPolicy({ catalog: cardManager.allCards, scorer: scoreManager, ...MASTER_PLAY_POLICY });
    let previousKey, previousScene;
    return () => {
        const observation = observeMaster(turnManager);
        if (!observation) return null;
        const { config, ...visible } = observation;
        if (visible.hand) visible.hand = [...visible.hand].sort((a, b) => a.instanceId.localeCompare(b.instanceId));
        const key = JSON.stringify(visible);
        if (key !== previousKey) {
            const move = decide(observation);
            const phase = observation.kind === 'delete' ? 'meeting' : observation.kind === 'place' ? 'action'
                : observation.kind === 'outing' || observation.offer?.id || observation.kind === 'staff' ? 'outing' : 'training';
            const outlook = estimateSOutlook({ ...observation, difficulty: 'int', rankTable: scoreManager.rankTable }, phase);
            const status = withSOutlook(describeMasterDecision(observation, move, outlook?.shortfall), outlook);
            const acquisition = observation.kind === 'acquire' ? {
                version: MASTER_POLICY_VERSION,
                recommended: { indices: move.indices || [], skip: move.kind === 'acquire' && !move.indices.length },
                refresh: move.kind === 'refresh'
            } : null;
            previousScene = { observation, move, status, acquisition };
            previousKey = key;
        }
        return previousScene;
    };
}

export function describeMasterDecision(observation, move, shortfall) {
    const status = (text, reason = text) => ({ tone: 'yellow', text, reason });
    const { config, stats, turn } = observation;
    const day = config.turns[turn];
    switch (move.kind) {
    case 'refresh':
        return status('リフレッシュで候補を見直そう');
    case 'acquire': {
        if (!move.indices.length) return observation.offer.allowSkip
            ? status('今回は発想研修を見送ろう', 'デッキを増やさず、所持カードを引きやすく保とう。')
            : status('候補がないので次へ進もう');
        const selected = move.indices.map(index => observation.cards[index]);
        const inspector = createAhiruRoleInspector({ ...observation,
            totalTurns: observation.offer.id === 'headquarters' ? turn + 1 : config.turns.length }, stats);
        const priority = [...new Set([shortfall, 'experience', 'accounting', 'enrollment', 'satisfaction'].filter(Boolean))];
        const axis = priority.find(key => selected.some(card => inspector.canRecover(card, key, stats[key] + 1)));
        if (axis) return status(`${AXES[axis]}を伸ばせる効果に注目しよう`);
        if (selected.some(card => inspector.supportsHand(card))) return status('手数を増やせる効果に注目しよう');
        return status('今の条件で発動する効果を見よう');
    }
    case 'outing':
        return move.place === 'headquarters' ? status('外出先で得られる即効性に注目しよう')
            : status('講習で繰り返し使える札を探そう');
    case 'staff':
        return status('担当者で変わる追加効果を比べよう');
    case 'delete':
        return move.ids.length ? status('効果の小さい札を減らして回そう')
            : status('このまま次に進もう');
    case 'place':
        if (day.spring) {
            const saveCards = config.turns[turn + 1]?.spring && observation.activeCards - move.moves.length <= 3;
            return status(saveCards ? '自動の教務で手札を残そう' : '自動の教務枠を活かそう',
                '室長と講師の空き枠には基本の教務が入るよ。講習で使った札は講習終了まで戻らないよ。');
        }
        if (turn >= 9) return status('入退差と退塾の得点を見よう');
        return stats.enrollment + 4 >= stats.experience
            ? status('体験を先に伸ばせる順を考えよう')
            : status('コストを払える配置を選ぼう');
    }
}
