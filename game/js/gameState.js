/**
 * GameState - ゲーム状態管理
 */
import { getDifficultyConfig } from './difficultyConfig.js?v=20260815-0055';
import { makeRunId } from './defaultRules.js?v=20260815-0055';
import { RandomSource } from './randomSource.js?v=20260815-0055';
import { createPlayRecord, recordPlayEvent, cardIdentity } from './playRecord.js?v=20260815-0055';

export class GameState {
    get config() { return getDifficultyConfig(this.difficulty); }
    get slots() { return this.config.slots; }
    get slotIds() { return this.slots.map(slot => slot.id); }
    get totalTurns() { return this.config.turns.length; }
    get staffNames() { return Object.fromEntries(this.slots.map(slot => [slot.id, slot.name])); }
    constructor(logger) {
        this.logger = logger;
        this.difficulty = 'fresh';
        this.calcMode = false;
        this.reset();
    }

    /**
     * ゲーム状態をリセット
     * @param {string} [difficulty] - 難易度ID ('fresh' or 'pro')。省略時は現在の難易度を維持
     */
    reset(difficulty, options = {}) {
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
            placed: Object.fromEntries(config.slots.map(slot => [slot.id, []])),
            zones: Object.fromEntries(config.cardZones.map(id => [id, []]))
        };

        this.runId = makeRunId();
        this.nextInstanceId = 1;
        this.ruleState = {};
        this.pendingAction = null;
        this.rng = new RandomSource(options.seed ?? globalThis.window?.CDG_GAME_SEED ?? this.runId);
        this.recordingMetadata = options;
        this.playRecord = null;

        this.turn = 0;  // 0-7 (1月下旬〜5月上旬)
        this.phase = 'start';  // start, training, action, meeting, end
        this.tokens = { passion: 0, inspiration: 0, organize: 0, fatigue: 0 };
        // 研修リフレッシュ残り回数
        const difficultyId = difficulty || this.difficulty;
        const diffConfig = getDifficultyConfig(difficultyId || 'fresh');
        this.trainingRefreshRemaining = diffConfig.trainingRefresh?.enabled
            ? diffConfig.trainingRefresh.maxCount : 0;
        this.trainingRefreshPhaseStartRemaining = this.trainingRefreshRemaining;
        this.trainingSelectionMode = 'normal';
        this.currentTrainingCards = null;
        this.startedAt = null;
        this.discardedCards = [];  // 途中で削除したカード名の一覧
        // イベントは開始時に固定され、カードとは完全に別管理する。
        this.event = null;
        this.eventCardUsage = {};

        this.logger?.log(`ゲーム状態を初期化しました (難易度: ${config.name})`, 'info');
    }

    recordStartTime() {
        this.startedAt = new Date().toISOString();
    }

    startRecording(metadata = {}) { this.playRecord = createPlayRecord(this, { ...this.recordingMetadata, ...metadata }); }
    record(type, data) { recordPlayEvent(this, type, data); }
    exportPlayRecord() {
        if (!this.playRecord) return null;
        return { ...structuredClone(this.playRecord), metadata: { ...this.playRecord.metadata,
            calcMode: this.calcMode, eventId: this.event?.enabled ? this.event.eventId : null,
            startedAt: this.startedAt, randomState: this.rng.snapshot() } };
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
            // 経理は0以上（上限なし）
            newValue = Math.max(0, newValue);
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
        this.identifyCard(card);
        // 獲得ターンを記録（未設定の場合のみ）
        if (card.acquiredTurn === undefined) {
            card.acquiredTurn = this.turn;
        }
        this.player.deck.push(card);
        this.record('acquire', { card: cardIdentity(card) });
        this.logger?.log(`デッキに追加: ${card.cardName} (${card.rarity})`, 'action');
    }

    /**
     * カードを手札に追加
     */
    addToHand(card) {
        this.identifyCard(card);
        this.player.hand.push(card);
    }

    identifyCard(card) {
        card.instanceId ||= `${this.runId}:${this.nextInstanceId++}`;
        card.definitionId ||= card.cardNo ? `card:${card.cardNo}` : `${card.rarity}:${card.cardName}`;
        return card;
    }

    getOwnedCards() {
        return [...this.player.deck, ...this.player.hand, ...Object.values(this.player.placed).flat(),
            ...Object.values(this.player.zones || {}).flat()];
    }

    ensureCardIdentities() {
        const cards = this.getOwnedCards();
        for (const card of cards) {
            if (card.instanceId?.startsWith(`${this.runId}:`)) {
                this.nextInstanceId = Math.max(this.nextInstanceId, Number(card.instanceId.split(':').at(-1)) + 1 || 1);
            }
        }
        cards.forEach(card => this.identifyCard(card));
    }

    /**
     * デッキをシャッフル
     */
    shuffleDeck() {
        const deck = this.player.deck;
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(this.rng.next(`deck:${this.turn}`) * (i + 1));
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
        if (globalThis.window?.debugCards?.hand?.length > 0 && window.game?.cardManager) {
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
                        const card = this.identifyCard({ ...searchCard });
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
            this.record('draw', { cards: drawn.map(cardIdentity), requested: count });
            this.logger?.log(`手札を${drawn.length}枚引きました`, 'action');
        }

        return drawn;
    }

    /**
     * カードを配置
     */
    placeCard(card, staff) {
        this.identifyCard(card);
        this.player.placed[staff].push(card);
        this.record('place', { card: cardIdentity(card), staff });
        const staffNames = this.staffNames;
        this.logger?.log(`${staffNames[staff]}に配置: ${card.cardName}`, 'action');
    }

    /**
     * 配置をクリア
     */
    clearPlaced({ includePersistent = false } = {}) {
        for (const slot of this.slots) {
            if (includePersistent || !slot.persistent) this.player.placed[slot.id] = [];
        }
    }

    /**
     * 配置済みカードを取り消し
     */
    removePlacedCard(card, staff) {
        const idx = this.player.placed[staff].indexOf(card);
        if (idx > -1) {
            this.player.placed[staff].splice(idx, 1);
            this.record('unplace', { card: cardIdentity(card), staff });
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
            this.discardedCards.push(card.cardName);
            this.record('delete', { card: cardIdentity(card) });
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
        const placedCards = this.slots.filter(slot => !slot.persistent).flatMap(slot => this.player.placed[slot.id] || []);
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
