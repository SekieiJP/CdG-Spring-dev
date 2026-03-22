/**
 * GameState - ゲーム状態管理
 */
import { getDifficultyConfig } from './difficultyConfig.js';

export class GameState {
    constructor(logger) {
        this.logger = logger;
        this.difficulty = 'fresh';
        this.reset();
    }

    /**
     * ゲーム状態をリセット
     * @param {string} [difficulty] - 難易度ID ('fresh' or 'pro')。省略時は現在の難易度を維持
     */
    reset(difficulty) {
        if (difficulty) {
            this.difficulty = difficulty;
        }
        const config = getDifficultyConfig(this.difficulty);

        this.player = {
            experience: config.initialStatus.experience,
            enrollment: config.initialStatus.enrollment,
            satisfaction: config.initialStatus.satisfaction,
            accounting: config.initialStatus.accounting,
            deck: [],           // デッキ
            hand: [],           // 手札
            placed: {           // 配置済みカード
                leader: [],
                teacher: [],
                staff: []
            }
        };

        this.turn = 0;  // 0-7 (1月下旬〜5月上旬)
        this.phase = 'start';  // start, training, action, meeting, end
        this.tokens = { passion: 0, inspiration: 0, organize: 0, fatigue: 0 };

        this.logger?.log(`ゲーム状態を初期化しました (難易度: ${config.name})`, 'info');
    }

    /**
     * ステータスを更新（境界値チェック付き）
     * @param {string} type - ステータスタイプ (experience, enrollment, satisfaction, accounting)
     * @param {number} delta - 変化量
     * @returns {number} 実際の変化量
     */
    updateStatus(type, delta) {
        const oldValue = this.player[type];
        let newValue = oldValue + delta;

        // 境界値チェック
        if (type === 'accounting') {
            // 経理は0-15の範囲
            newValue = Math.max(0, Math.min(15, newValue));
        } else {
            // その他は0以上
            newValue = Math.max(0, newValue);
        }

        // 入塾は体験数を超えられない
        if (type === 'enrollment') {
            newValue = Math.min(newValue, this.player.experience);
        }

        const actualDelta = newValue - oldValue;
        this.player[type] = newValue;

        if (actualDelta !== 0) {
            const statusNames = {
                experience: '体験',
                enrollment: '入塾',
                satisfaction: '満足',
                accounting: '経理'
            };

            const sign = actualDelta > 0 ? '+' : '';
            this.logger?.log(
                `${statusNames[type]}: ${oldValue} → ${newValue} (${sign}${actualDelta})`,
                'status'
            );
        }

        return actualDelta;
    }

    /**
     * カードをデッキに追加
     */
    addToDeck(card) {
        // 獲得ターンを記録（未設定の場合のみ）
        if (card.acquiredTurn === undefined) {
            card.acquiredTurn = this.turn;
        }
        this.player.deck.push(card);
        this.logger?.log(`デッキに追加: ${card.cardName} (${card.rarity})`, 'action');
    }

    /**
     * カードを手札に追加
     */
    addToHand(card) {
        this.player.hand.push(card);
    }

    /**
     * デッキをシャッフル
     */
    shuffleDeck() {
        const deck = this.player.deck;
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        this.logger?.log('デッキをシャッフルしました', 'info');
    }

    /**
     * 手札を引く（デバッグモード対応）
     * @param {number} count - 引く枚数
     */
    drawCards(count) {
        const drawn = [];

        // デバッグモード: 指定カードを優先的に引く
        if (window?.debugCards?.hand?.length > 0 && window.game?.cardManager) {
            const cardManager = window.game.cardManager;
            for (const cardName of window.debugCards.hand) {
                if (drawn.length >= count) break;

                // デッキからカード名で検索
                const idx = this.player.deck.findIndex(c => c.cardName === cardName);
                if (idx !== -1) {
                    const card = this.player.deck.splice(idx, 1)[0];
                    this.player.hand.push(card);
                    drawn.push(card);
                    this.logger?.log(`[DEBUG] 手札優先引き: ${cardName}`, 'info');
                } else {
                    // 全カードから検索してコピー
                    const searchCard = cardManager.allCards.find(c => c.cardName === cardName);
                    if (searchCard) {
                        const card = { ...searchCard };
                        this.player.hand.push(card);
                        drawn.push(card);
                        this.logger?.log(`[DEBUG] 手札挿入: ${cardName} (デッキ外)`, 'info');
                    }
                }
            }
        }

        // 残りの枚数を通常通り引く
        for (let i = drawn.length; i < count; i++) {
            if (this.player.deck.length === 0) {
                this.logger?.log('デッキが空です', 'info');
                break;
            }
            const card = this.player.deck.pop();
            this.player.hand.push(card);
            drawn.push(card);
        }

        if (drawn.length > 0) {
            this.logger?.log(`手札を${drawn.length}枚引きました`, 'action');
        }

        return drawn;
    }

    /**
     * カードを配置
     */
    placeCard(card, staff) {
        this.player.placed[staff].push(card);
        const staffNames = { leader: '室長', teacher: '講師', staff: '事務' };
        this.logger?.log(`${staffNames[staff]}に配置: ${card.cardName}`, 'action');
    }

    /**
     * 配置をクリア
     */
    clearPlaced() {
        this.player.placed = { leader: [], teacher: [], staff: [] };
    }

    /**
     * 配置済みカードを取り消し
     */
    removePlacedCard(card, staff) {
        const idx = this.player.placed[staff].indexOf(card);
        if (idx > -1) {
            this.player.placed[staff].splice(idx, 1);
        }
    }

    /**
     * 手札からカードを削除
     */
    removeFromHand(card) {
        const index = this.player.hand.indexOf(card);
        if (index > -1) {
            this.player.hand.splice(index, 1);
        }
    }

    /**
     * デッキからカードを削除（ゲームから除外）
     */
    removeFromDeck(card) {
        const index = this.player.deck.indexOf(card);
        if (index > -1) {
            this.player.deck.splice(index, 1);
            this.logger?.log(`カード削除: ${card.cardName}`, 'action');
            return true;
        }
        return false;
    }

    /**
     * 全カードをデッキに戻す（手札・配置済みを含む）
     */
    returnAllToDeck() {
        // 配置済みカードをデッキに戻す（配列対応）
        const placedCards = Object.values(this.player.placed).flatMap(cards =>
            Array.isArray(cards) ? cards : (cards ? [cards] : [])
        );
        placedCards.forEach(card => this.player.deck.push(card));

        // 手札をデッキに戻す
        this.player.hand.forEach(card => {
            this.player.deck.push(card);
        });

        this.player.hand = [];
        this.clearPlaced();

        this.logger?.log('全カードをデッキに戻しました', 'info');
    }

    /**
     * 現在の状態を取得
     */
    getState() {
        return {
            player: { ...this.player },
            turn: this.turn,
            phase: this.phase
        };
    }
}
