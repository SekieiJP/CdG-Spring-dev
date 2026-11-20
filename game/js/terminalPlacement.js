const STATS = ['experience', 'enrollment', 'satisfaction', 'accounting'];
const TOKENS = ['passion', 'fatigue', 'inspiration', 'organize'];

export function createTerminalExact({
    rules, placementError, resolve, score, rank = null,
    firstTurn = rules.turns.length - 1, maxStates = 1_000_000
}) {
    if (!Number.isInteger(maxStates) || maxStates < 1 || maxStates > 5_000_000) {
        throw new Error('全探索の状態上限は1〜5000000');
    }
    const slots = rules.slots.map(slot => slot.id);
    if (!['fresh', 'pro'].includes(rules.id) || slots.join(',') !== 'leader,teacher,staff' ||
        rules.turns.length !== 8 || rules.cardZones.length) {
        throw new Error('FRESH・PROの3枠専用');
    }
    if (!Number.isInteger(firstTurn) || firstTurn < 6 || firstTurn > 7) {
        throw new Error('全探索は最後の2ターンに限る');
    }

    function initial(observation) {
        const { difficulty, turn, totalTurns, stats, tokens } = observation;
        if (difficulty !== rules.id || observation.mode !== 'normal' || !Number.isInteger(turn) ||
            turn < firstTurn || turn > 7 || totalTurns !== 8 ||
            STATS.some(key => !Number.isFinite(stats[key])) || TOKENS.some(key => !Number.isFinite(tokens[key] ?? 0))) {
            throw new Error('対象ターンの公開状態が必要');
        }
        return {
            difficulty, turn, totalTurns, slots: rules.slots, config: rules,
            player: { ...Object.fromEntries(STATS.map(key => [key, stats[key]])),
                placed: Object.fromEntries(slots.map(slot => [slot, []])) },
            tokens: Object.fromEntries(TOKENS.map(key => [key, tokens[key] || 0])),
            updateStatus(key, delta) {
                const old = this.player[key];
                this.player[key] = Math.max(0, old + delta);
                if (key === 'enrollment') this.player[key] = Math.min(this.player[key], this.player.experience);
                return this.player[key] - old;
            }
        };
    }

    function replay(observation, hand, sequence) {
        const state = initial(observation);
        const used = new Set();
        let last = 0;
        for (const { slot, cardIndex } of sequence) {
            const position = slots.indexOf(slot);
            const card = hand[cardIndex];
            if (position < last || !card || used.has(cardIndex) || placementError(state, card, slot)) {
                throw new Error('観測された配置が合法でない');
            }
            if (!resolve(card, slot, state).applied) throw new Error('観測された配置の効果が発動しない');
            state.player.placed[slot].push(card);
            used.add(cardIndex);
            last = position;
        }
        return {
            score: score(state),
            stats: Object.fromEntries(STATS.map(key => [key, state.player[key]])),
            tokens: { ...state.tokens }
        };
    }

    function optimize(observation, hand) {
        if (!Array.isArray(hand) || hand.length > 20) throw new Error('公開手札は20枚以内');
        const root = initial(observation);
        const seen = new Set();
        const scores = new Map();
        const ranking = new Map();
        let visited = 0;
        let complete = true;

        function metric(state) {
            const key = STATS.map(axis => state.player[axis]).join(',');
            if (!scores.has(key)) scores.set(key, score(state));
            return scores.get(key);
        }

        function value(state, official) {
            if (!rank) return official.displayScore;
            const key = [...STATS.map(axis => state.player[axis]), ...TOKENS.map(token => state.tokens[token])].join(',');
            if (!ranking.has(key)) ranking.set(key, rank(observation, state, official));
            return ranking.get(key);
        }

        const initialScore = metric(root);
        let best = { metric: initialScore, value: value(root, initialScore), state: root, sequence: [] };

        function visit(state, mask, last, sequence) {
            if (!complete) return;
            const key = [mask.toString(16), last, ...slots.map(slot => state.player.placed[slot].length),
                ...STATS.map(axis => state.player[axis]), ...TOKENS.map(token => state.tokens[token])].join(',');
            if (seen.has(key)) return;
            seen.add(key);
            if (++visited > maxStates) {
                complete = false;
                return;
            }
            const currentScore = metric(state);
            const currentValue = value(state, currentScore);
            if (currentValue > best.value || currentValue === best.value && (
                currentScore.withdrawal < best.metric.withdrawal ||
                currentScore.withdrawal === best.metric.withdrawal && sequence.length < best.sequence.length
            )) {
                best = { metric: currentScore, value: currentValue, state, sequence: [...sequence] };
            }

            const equivalent = new Set();
            for (let i = 0; i < hand.length; i++) {
                const bit = 1n << BigInt(i);
                if (mask & bit) continue;
                const card = hand[i];
                const identity = JSON.stringify([card.cardNo, card.category, card.effect]);
                if (equivalent.has(identity)) continue;
                equivalent.add(identity);
                for (let position = last; position < slots.length; position++) {
                    const slot = slots[position];
                    if (placementError(state, card, slot)) continue;
                    const next = {
                        ...state, tokens: { ...state.tokens },
                        player: {
                            ...state.player,
                            placed: Object.fromEntries(slots.map(id => [id, [...state.player.placed[id]]]))
                        }
                    };
                    if (!resolve(card, slot, next).applied) continue;
                    next.player.placed[slot].push(card);
                    visit(next, mask | bit, position, [...sequence, { cardIndex: i, slot }]);
                }
            }
        }

        visit(root, 0n, 0, []);
        return {
            complete, visited, score: best.metric, sequence: best.sequence,
            stats: Object.fromEntries(STATS.map(axis => [axis, best.state.player[axis]])),
            purpose: complete ? 'exact legal terminal optimum; same points prefer less withdrawal'
                : 'lower bound only; state limit reached'
        };
    }

    return { optimize, replay };
}
