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
        console.log('[DEBUG] advancePhase: currentPhase=', currentPhase);

        if (currentPhase === 'start') {
            this.gameState.phase = 'training';
            this.logger?.log('[DEBUG] start→training遷移', 'info');
            this.startTrainingPhase();
        } else if (currentPhase === 'training') {
            this.gameState.phase = 'action';
            this.logger?.log('[DEBUG] training→action遷移、startActionPhaseを呼び出し', 'info');
            console.log('[DEBUG] training→action遷移、startActionPhaseを呼び出し');
            this.startActionPhase();
        } else if (currentPhase === 'action') {
            const config = this.getCurrentTurnConfig();
            // 削除枚数が0の場合は教室会議フェーズをスキップ
            if (config.delete === 0) {
                this.logger?.log('[DEBUG] 削除枚数0のため教室会議フェーズをスキップ', 'info');
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
            console.error('[DEBUG] 未知のフェーズ:', currentPhase);
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
        console.log('[DEBUG] startActionPhase: 実行開始');
        console.log('[DEBUG] デッキ枚数（シャッフル前）:', this.gameState.player.deck.length);
        console.log('[DEBUG] 手札枚数（ドロー前）:', this.gameState.player.hand.length);

        // デッキをシャッフル
        this.gameState.shuffleDeck();
        console.log('[DEBUG] デッキシャッフル完了');

        // 手札を4枚引く
        this.gameState.drawCards(4);
        console.log('[DEBUG] 手札を4枚引いた後の手札枚数:', this.gameState.player.hand.length);
        console.log('[DEBUG] 手札内容:', this.gameState.player.hand);
    }

    /**
     * 教室会議フェーズ開始
     */
    startMeetingPhase() {
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
            const card = placed[staff];
            if (card) {
                // 適用前のステータスを記録
                const beforeStats = {
                    experience: this.gameState.player.experience,
                    enrollment: this.gameState.player.enrollment,
                    satisfaction: this.gameState.player.satisfaction,
                    accounting: this.gameState.player.accounting
                };

                // おすすめ行動かどうかチェック
                const isRecommended = config.recommended && card.category === config.recommended;

                // おすすめ行動ボーナスを適用（該当カードの処理時に）
                if (isRecommended && config.recommendedStatus) {
                    this.gameState.updateStatus(config.recommendedStatus, 1);
                    this.logger?.log(`おすすめ行動ボーナス: ${config.recommended} x1`, 'action');
                }

                // カード効果を適用
                this.cardManager.applyCardEffect(card, staff, this.gameState);

                // 適用後のステータスを記録
                const afterStats = {
                    experience: this.gameState.player.experience,
                    enrollment: this.gameState.player.enrollment,
                    satisfaction: this.gameState.player.satisfaction,
                    accounting: this.gameState.player.accounting
                };

                actionInfo.cardEffects[staff] = {
                    beforeStats,
                    afterStats,
                    isRecommended
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
        Object.values(placedCards).forEach(card => {
            if (card && card.category === recommendedCategory) {
                count++;
            }
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
