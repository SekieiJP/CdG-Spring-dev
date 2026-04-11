/**
 * TurnManager - ターン進行管理
 */
export class TurnManager {
    static TURN_CONFIG = [
        { name: '1月下旬', week: '1月下旬', training: 'R', recommended: '動員', recommendedStatus: 'experience', delete: 2 },
        { name: '2月上旬', week: '2月上旬', training: 'SR', recommended: '応対', recommendedStatus: 'satisfaction', delete: 2 },
        { name: '2月下旬', week: '2月下旬', training: 'R', recommended: '動員', recommendedStatus: 'experience', delete: 1 },
        { name: '3月上旬', week: '3月上旬', training: 'SSR', recommended: '庶務', recommendedStatus: 'accounting', delete: 1 },
        { name: '3月下旬', week: '3月下旬', training: 'SSR', recommended: '教務', recommendedStatus: 'enrollment', delete: 1 },
        { name: '4月上旬', week: '4月上旬', training: 'SR', recommended: '応対', recommendedStatus: 'satisfaction', delete: 1 },
        { name: '4月下旬', week: '4月下旬', training: 'SR', recommended: '教務', recommendedStatus: 'enrollment', delete: 1 },
        { name: '5月上旬', week: '5月上旬', training: 'SR', recommended: '庶務', recommendedStatus: 'accounting', delete: 0 }
    ];

    constructor(gameState, cardManager, logger) {
        this.gameState = gameState;
        this.cardManager = cardManager;
        this.logger = logger;
    }

    /**
     * 現在のターン設定を取得
     */
    getCurrentTurnConfig() {
        return TurnManager.TURN_CONFIG[this.gameState.turn];
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
        return TurnManager.TURN_CONFIG;
    }

    /**
     * フェーズを進める
     */
    advancePhase() {
        const currentPhase = this.gameState.phase;
        this.logger?.log(`[DEBUG] advancePhase呼び出し: currentPhase=${currentPhase}`, 'info');
        window.CDG_DEBUG && console.log('[DEBUG] advancePhase: currentPhase=', currentPhase);

        if (currentPhase === 'start') {
            this.gameState.phase = 'training';
            this.logger?.log('[DEBUG] start→training遷移', 'info');
            this.startTrainingPhase();
        } else if (currentPhase === 'training') {
            this.gameState.phase = 'action';
            this.logger?.log('[DEBUG] training→action遷移、startActionPhaseを呼び出し', 'info');
            window.CDG_DEBUG && console.log('[DEBUG] training→action遷移、startActionPhaseを呼び出し');
            this.startActionPhase();
        } else if (currentPhase === 'action') {
            const maxDelete = this.getCurrentDeleteMax();
            // 最終ターン(turn===7)は会議スキップ。それ以外はmaxDelete>0なら開く
            if (maxDelete === 0 || this.gameState.turn === 7) {
                this.logger?.log('[DEBUG] 会議フェーズをスキップして次ターンへ遷移', 'info');
                this.gameState.phase = 'meeting'; // 一時的にmeetingへ
                this.advancePhase(); // 即座に次のターンへ
            } else {
                this.gameState.phase = 'meeting';
                this.startMeetingPhase();
            }
        } else if (currentPhase === 'meeting') {
            // 次のターンへ
            this.gameState.turn++;

            if (this.gameState.turn >= 8) {
                // ゲーム終了
                this.gameState.phase = 'end';
                this.logger?.log('ゲーム終了: 8ターン完了', 'info');
            } else {
                this.gameState.phase = 'training';
                const config = this.getCurrentTurnConfig();
                this.logger?.log(`ターン${this.gameState.turn + 1}開始: ${config.name}`, 'info');
                this.startTrainingPhase();
            }
        } else {
            this.logger?.log(`[DEBUG] 未知のフェーズ: ${currentPhase}`, 'error');
            window.CDG_DEBUG && console.error('[DEBUG] 未知のフェーズ:', currentPhase);
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
        window.CDG_DEBUG && console.log('[DEBUG] startActionPhase: 実行開始');
        window.CDG_DEBUG && console.log('[DEBUG] デッキ枚数（シャッフル前）:', this.gameState.player.deck.length);
        window.CDG_DEBUG && console.log('[DEBUG] 手札枚数（ドロー前）:', this.gameState.player.hand.length);

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
        window.CDG_DEBUG && console.log('[DEBUG] デッキシャッフル完了');

        // 手札を引く
        this.gameState.drawCards(drawCount);
        window.CDG_DEBUG && console.log(`[DEBUG] 手札を${drawCount}枚引いた後の手札枚数:`, this.gameState.player.hand.length);
        window.CDG_DEBUG && console.log('[DEBUG] 手札内容:', this.gameState.player.hand);
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
        const placed = this.gameState.player.placed;
        const config = this.getCurrentTurnConfig();
        const actionInfo = {
            cardEffects: {} // staff -> { beforeStats, afterStats, isRecommended }
        };

        this.logger?.log('--- アクション実行開始 ---', 'info');

        // 各スタッフのカード効果を実行（おすすめボーナスも含めて記録）
        const staffOrder = ['leader', 'teacher', 'staff'];
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
                    const beforeStats = {
                        experience: this.gameState.player.experience,
                        enrollment: this.gameState.player.enrollment,
                        satisfaction: this.gameState.player.satisfaction,
                        accounting: this.gameState.player.accounting
                    };

                    const isRecommended = config.recommended && card.category === config.recommended;
                    if (isRecommended && !recommendedApplied && config.recommendedStatus) {
                        this.gameState.updateStatus(config.recommendedStatus, 1);
                        this.logger?.log(`おすすめ行動ボーナス: ${config.recommended} x1`, 'action');
                        recommendedApplied = true;
                    }

                    this.cardManager.applyCardEffect(card, staff, this.gameState);

                    const afterStats = {
                        experience: this.gameState.player.experience,
                        enrollment: this.gameState.player.enrollment,
                        satisfaction: this.gameState.player.satisfaction,
                        accounting: this.gameState.player.accounting
                    };

                    perCard.push({
                        cardName: card.cardName,
                        beforeStats,
                        afterStats,
                        isRecommended
                    });
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
        return actionInfo;
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

        // 基本カード（N）を取得
        const basicCards = this.cardManager.getBasicCards();
        basicCards.forEach(card => {
            this.gameState.player.deck.push(card);
        });

        this.logger?.log(`基本カード${basicCards.length}枚をデッキに追加`, 'info');

        // 初回研修（R x4枚から2枚選択）は別途処理
        this.logger?.log('ゲーム開始: 初回研修でRカード4枚から2枚選択してください', 'info');
    }
}
