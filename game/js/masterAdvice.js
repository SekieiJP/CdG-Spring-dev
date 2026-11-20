import { createMasterPolicy, observeMaster } from './masterPolicy.js?v=20261122-0069';

export function createMasterAdvice({ gameState, turnManager, cardManager, scoreManager }) {
    const decide = createMasterPolicy({ catalog: cardManager.allCards, scorer: scoreManager });
    let previousKey, previousMove;
    return () => {
        const observation = observeMaster(turnManager);
        if (!observation) return null;
        const { config, ...visible } = observation;
        const key = JSON.stringify(visible);
        if (key !== previousKey) {
            previousMove = decide(observation);
            previousKey = key;
        }
        const move = previousMove;
        const status = describeMasterDecision(observation, move, gameState.player.placed);
        const acquisition = observation.kind === 'acquire' ? {
            version: 'master-v2',
            recommended: { indices: move.indices || [], skip: move.kind === 'acquire' && !move.indices.length },
            refresh: move.kind === 'refresh'
        } : null;
        return { observation, move, status, acquisition };
    };
}

export function describeMasterDecision(observation, move, placed = {}) {
    const status = (tone, text, reason = text) => ({ tone, text, reason });
    const slotName = id => observation.config.slots.find(slot => slot.id === id)?.name;
    switch (move.kind) {
    case 'refresh':
        return status('yellow', '候補をリフレッシュしよう', 'いまの候補では欲しい役割を補いにくいので、残りのリフレッシュを使うよ。');
    case 'acquire': {
        if (!move.indices.length) return observation.offer.allowSkip
            ? status('yellow', '今回は発想研修を見送ろう', '候補を加えず、いまのデッキを回しやすくするよ。')
            : status('green', '候補がないので次へ進もう');
        const names = move.indices.map(index => observation.cards[index].cardName);
        const headquarters = observation.offer.id === 'headquarters';
        const verb = headquarters ? '使おう' : '選ぼう';
        const text = names.length === 1 && Array.from(names[0]).length <= 17 ? `「${names[0]}」を${verb}`
            : `おすすめの${names.length}枚を${verb}`;
        return status('green', text, headquarters
            ? `「${names.join('」「')}」を本部で使うよ。今のパラメータで見込める効果を重視したよ。`
            : `「${names.join('」「')}」を選ぶよ。今のパラメータとデッキの役割を見て決めたよ。`);
    }
    case 'outing': {
        const name = observation.options.find(option => option.id === move.place).name;
        return status('green', `${name}へ行こう`, `行き先は${name}がおすすめ。今のパラメータと各行き先で得られる効果を比べたよ。`);
    }
    case 'staff':
        return status('green', `${slotName(move.staff)}で実行しよう`);
    case 'delete': {
        const names = move.ids.map(id => observation.cards.find(card => card.instanceId === id)?.cardName).filter(Boolean);
        if (!names.length) return status('green', '今回は削除せず次へ進もう');
        const text = names.length === 1 && Array.from(names[0]).length <= 15 ? `「${names[0]}」の削除がおすすめ` : `${names.length}枚削除してデッキを整えよう`;
        return status('yellow', text, `「${names.join('」「')}」を削除して、残したカードを引きやすくするよ。`);
    }
    case 'place': {
        const plan = Object.fromEntries(observation.config.slots.map(slot => [slot.id, []]));
        for (const step of move.moves) plan[step.staff].push(step.id);
        for (const { id, name } of observation.config.slots) {
            const ids = (placed[id] || []).map(card => card.instanceId);
            const wrong = ids.findIndex((cardId, index) => cardId !== plan[id][index]);
            if (wrong !== -1) return status('yellow', `${name}の配置を見直そう`);
            const next = observation.hand.find(card => card.instanceId === plan[id][ids.length]);
            if (next) {
                const text = `「${next.cardName}」を${name}へ`;
                return status('green', Array.from(text).length <= 25 ? text : `${name}におすすめのカードを置こう`, text);
            }
        }
        return status('green', 'この配置で実行しよう');
    }
    }
}
