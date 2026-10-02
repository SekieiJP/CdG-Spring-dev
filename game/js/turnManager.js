/**
 * TurnManager - ターン進行管理
 */
import { resolveCardAction } from './actionResolver.js?v=20260815-0052';
import { DEFAULT_TURNS } from './defaultRules.js?v=20260815-0052';

export class TurnManager {
    static TURN_CONFIG = DEFAULT_TURNS;

    constructor(gameState, cardManager, logger) {
        this.gameState = gameState;
        this.cardManager = cardManager;
        this.cardManager.gameState = gameState;
        this.logger = logger;
    }

    /**
     * 現在のターン設定を取得
     */
    getCurrentTurnConfig() {
        return this.getTurnConfigs()[this.gameState.turn];
    }

    /**
     * 現在の削除上限を取得（整理トークン込み）
     */
    getCurrentDeleteMax() {
        const config = this.getCurrentTurnConfig();
        return config.delete + (this.gameState.tokens?.organize || 0);
    }

    /**
     * 全ターン設定を取得
     */
    getTurnConfigs() {
        return this.gameState.config.turns;
    }

    /**
     * フェーズを進める
     */
    advancePhase() {
        const currentPhase = this.gameState.phase;
        this.logger?.log(`[DEBUG] advancePhase呼び出し: currentPhase=${currentPhase}`, 'info');
        globalThis.window?.CDG_DEBUG && console.log('[DEBUG] advancePhase: currentPhase=', currentPhase);

        if (currentPhase === 'start') {
            this.gameState.phase = 'training';
            this.logger?.log('[DEBUG] start→training遷移', 'info');
            this.startTrainingPhase();
        } else if (currentPhase === 'training') {
            this.gameState.phase = 'action';
            this.logger?.log('[DEBUG] training→action遷移、startActionPhaseを呼び出し', 'info');
            globalThis.window?.CDG_DEBUG && console.log('[DEBUG] training→action遷移、startActionPhaseを呼び出し');
            this.startActionPhase();
        } else if (currentPhase === 'action') {
            this.gameState.pendingAction = null;
            const maxDelete = this.getCurrentDeleteMax();
            // 最終ターン(turn===7)は会議スキップ。それ以外はmaxDelete>0なら開く
            if (maxDelete === 0 || this.gameState.turn === this.gameState.totalTurns - 1) {
                this.logger?.log('[DEBUG] 会議フェーズをスキップして次ターンへ遷移', 'info');
                this.gameState.returnAllToDeck(); // 手札・配置カードをデッキへ戻す
                this.gameState.tokens.organize = 0; // 整理トークンをリセット（最終ターンで残存する可能性あり）
                this.gameState.phase = 'meeting'; // 一時的にmeetingへ
                this.advancePhase(); // 即座に次のターンへ
            } else {
                this.gameState.phase = 'meeting';
                this.startMeetingPhase();
            }
        } else if (currentPhase === 'meeting') {
            // 次のターンへ
            this.gameState.turn++;

            if (this.gameState.turn >= this.gameState.totalTurns) {
                // ゲーム終了
                this.gameState.phase = 'end';
                this.logger?.log(`ゲーム終了: ${this.gameState.totalTurns}ターン完了`, 'info');
            } else {
                this.gameState.phase = 'training';
                const config = this.getCurrentTurnConfig();
                this.logger?.log(`ターン${this.gameState.turn + 1}開始: ${config.name}`, 'info');
                this.startTrainingPhase();
            }
        } else {
            this.logger?.log(`[DEBUG] 未知のフェーズ: ${currentPhase}`, 'error');
            globalThis.window?.CDG_DEBUG && console.error('[DEBUG] 未知のフェーズ:', currentPhase);
        }
    }

    /**
     * 研修フェーズ開始
     */
    startTrainingPhase() {
        const config = this.getCurrentTurnConfig();
        this.logger?.log(`研修フェーズ: ${config.training}カードを習得`, 'info');
    }

    /**
     * 教室行動フェーズ開始
     */
    startActionPhase() {
        this.logger?.log('教室行動フェーズ開始', 'info');
        globalThis.window?.CDG_DEBUG && console.log('[DEBUG] startActionPhase: 実行開始');
        globalThis.window?.CDG_DEBUG && console.log('[DEBUG] デッキ枚数（シャッフル前）:', this.gameState.player.deck.length);
        globalThis.window?.CDG_DEBUG && console.log('[DEBUG] 手札枚数（ドロー前）:', this.gameState.player.hand.length);

        if (!this.gameState.tokens) {
            this.gameState.tokens = { passion: 0, inspiration: 0, organize: 0, fatigue: 0 };
        }

        // 情熱・疲労トークン消費
        const passion = this.gameState.tokens.passion || 0;
        const fatigue = this.gameState.tokens.fatigue || 0;
        const drawCount = Math.max(0, 4 + passion - fatigue);
        if (passion > 0) {
            this.logger?.log(`✊情熱発動: ドロー+${passion} → ${drawCount}枚`, 'action');
            this.gameState.tokens.passion = 0;
        }
        if (fatigue > 0) {
            this.logger?.log(`💤疲労発動: ドロー-${fatigue} → ${drawCount}枚`, 'action');
            this.gameState.tokens.fatigue = 0;
        }

        // 次回の行動フェーズ表示時に、ドロー変動通知を出すための一時情報
        if (passion > 0 || fatigue > 0) {
            this.gameState.lastDrawNotification = { passion, fatigue, drawCount };
        } else {
            this.gameState.lastDrawNotification = null;
        }

        // デッキをシャッフル
        this.gameState.shuffleDeck();
        globalThis.window?.CDG_DEBUG && console.log('[DEBUG] デッキシャッフル完了');

        // 手札を引く
        this.gameState.drawCards(drawCount);
        globalThis.window?.CDG_DEBUG && console.log(`[DEBUG] 手札を${drawCount}枚引いた後の手札枚数:`, this.gameState.player.hand.length);
        globalThis.window?.CDG_DEBUG && console.log('[DEBUG] 手札内容:', this.gameState.player.hand);
    }

    /**
     * 教室会議フェーズ開始
     */
    startMeetingPhase() {
        const organizeBonus = this.gameState.tokens?.organize || 0;
        if (organizeBonus > 0) {
            this.logger?.log(`🗑️整理発動: 削除上限+${organizeBonus}`, 'action');
            // トークンはUIが削除処理完了後にリセット
        }
        this.logger?.log('教室会議フェーズ開始', 'info');

        // 全カードをデッキに戻す
        this.gameState.returnAllToDeck();
    }

    /**
     * アクション実行
     * @returns {Object} 各カードの効果情報
     */
    executeActions() {
        if (this.gameState.pendingAction?.turn === this.gameState.turn) return this.gameState.pendingAction.actionInfo;
        this.gameState.config.rules.beforeAction?.(this.gameState, this.cardManager);
        const placed = this.gameState.player.placed;
        const actionInfo = {
            cardEffects: {} // staff -> { beforeStats, afterStats, isRecommended, cards }
        };

        this.logger?.log('--- アクション実行開始 ---', 'info');

        // 各スタッフのカード効果を実行（おすすめボーナスも含めて記録）
        const staffOrder = this.gameState.slotIds;
        staffOrder.forEach(staff => {
            const cards = Array.isArray(placed[staff]) ? placed[staff] : (placed[staff] ? [placed[staff]] : []);
            if (cards.length > 0) {
                const staffBeforeStats = {
                    experience: this.gameState.player.experience,
                    enrollment: this.gameState.player.enrollment,
                    satisfaction: this.gameState.player.satisfaction,
                    accounting: this.gameState.player.accounting
                };

                let recommendedApplied = false;
                const perCard = [];

                cards.forEach(card => {
                    const resolved = this.resolveCardAction(card, staff);
                    recommendedApplied ||= resolved.recommendedApplied;
                    perCard.push(resolved);
                });

                const staffAfterStats = {
                    experience: this.gameState.player.experience,
                    enrollment: this.gameState.player.enrollment,
                    satisfaction: this.gameState.player.satisfaction,
                    accounting: this.gameState.player.accounting
                };

                actionInfo.cardEffects[staff] = {
                    beforeStats: staffBeforeStats,
                    afterStats: staffAfterStats,
                    isRecommended: recommendedApplied,
                    cards: perCard
                };
            }
        });

        this.logger?.log('--- アクション実行完了 ---', 'info');
        // アイテム条件に用いるのは、実際に有効解決されたカードだけ。
        const usage = {};
        Object.values(actionInfo.cardEffects).forEach(info => info.cards.forEach(card => {
            if (!card.applied) return;
            const category = card.category;
            if (category) usage[category] = (usage[category] || 0) + 1;
        }));
        this.gameState.eventCardUsage = usage;
        this.logger?.log(`イベント用有効カード枚数: ${JSON.stringify(usage)}`, 'info');
        this.gameState.config.rules.afterAction?.(this.gameState, actionInfo);
        this.gameState.pendingAction = { turn: this.gameState.turn, actionInfo };
        return actionInfo;
    }

    /** 本体とsolverが同じコスト・条件・おすすめ順序で1枚を解決する入口。 */
    resolveCardAction(card, staff, state = this.gameState) {
        const isSimulation = state !== this.gameState;
        const manager = isSimulation
            ? Object.assign(Object.create(this.cardManager), { logger: null, gameState: state,
                ...(this.gameState.config.rules.resolveCard ? {
                    trainingDecks: structuredClone(this.cardManager.trainingDecks),
                    trainingDiscards: structuredClone(this.cardManager.trainingDiscards)
                } : {}) })
            : this.cardManager;
        const resolver = this.gameState.config.rules.resolveCard || resolveCardAction;
        return resolver(manager, state, card, staff, this.getTurnConfigs()[state.turn], isSimulation ? null : this.logger);
    }

    createSimulationState() {
        const state = this.gameState;
        return Object.assign(Object.create(Object.getPrototypeOf(state)), state, {
            player: structuredClone(state.player), tokens: { ...state.tokens },
            ruleState: structuredClone(state.ruleState), pendingAction: null, logger: null, playRecord: null,
            rng: state.rng.constructor.restore(state.rng.snapshot())
        });
    }

    /**
     * おすすめ行動ボーナス計算
     */
    calculateRecommendedBonus(placedCards, recommendedCategory) {
        let count = 0;
        Object.values(placedCards).forEach(cards => {
            const list = Array.isArray(cards) ? cards : (cards ? [cards] : []);
            list.forEach(card => {
                if (card && card.category === recommendedCategory) {
                    count++;
                }
            });
        });
        return count;
    }

    /**
     * ゲーム初期化
     */
    initializeGame() {
        this.gameState.reset(this.gameState.difficulty);

        // 研修候補プールを初期化（各カード2枚ずつ）
        this.cardManager.initTrainingPool();
        this.gameState.startRecording({ cardVersion: this.cardManager.dataVersion, rankVersion: this.cardManager.rankVersion,
            catalog: this.cardManager.allCards.map(card => ({ ...card })) });

        // 基本カード（N）を取得
        const basicCards = this.cardManager.getBasicCards();
        basicCards.forEach(card => {
            this.gameState.addToDeck(card);
        });

        this.logger?.log(`基本カード${basicCards.length}枚をデッキに追加`, 'info');

        // 初回研修（R x4枚から2枚選択）は別途処理
        this.logger?.log('ゲーム開始: 初回研修でRカード4枚から2枚選択してください', 'info');
    }
}
