/**
 * SaveManager - ゲーム状態の保存・復元管理
 * v20260208-1200: 中断・再開機能実装
 */
export class SaveManager {
    static SAVE_KEY = 'cdg_save_data';

    constructor(logger) {
        this.logger = logger;
    }

    /**
     * ビルドバージョンを取得
     * @returns {string} ビルドバージョン
     */
    getBuildVersion() {
        return window.BUILD_VERSION || 'unknown';
    }

    /**
     * 保存データが存在するかチェック
     * @returns {boolean}
     */
    hasSaveData() {
        try {
            const data = localStorage.getItem(SaveManager.SAVE_KEY);
            return data !== null;
        } catch (e) {
            this.logger?.log(`保存データ確認エラー: ${e.message}`, 'error');
            return false;
        }
    }

    /**
     * ゲーム状態を保存
     * @param {GameState} gameState - ゲーム状態
     * @param {CardManager} cardManager - カードマネージャー
     */
    save(gameState, cardManager) {
        try {
            const saveData = {
                buildVersion: this.getBuildVersion(),
                savedAt: new Date().toISOString(),
                gameState: this.serializeGameState(gameState),
                trainingDecks: this.serializeTrainingDecks(cardManager)
            };

            console.log('[SAVE-DEBUG] save: phase=', gameState.phase, ', turn=', gameState.turn);
            console.log('[SAVE-DEBUG] save: currentTrainingCards=', gameState.currentTrainingCards?.map(c => c.cardName));
            console.log('[SAVE-DEBUG] save: hand=', gameState.player.hand.map(c => c.cardName));
            console.log('[SAVE-DEBUG] save: deck=', gameState.player.deck.map(c => c.cardName));

            localStorage.setItem(SaveManager.SAVE_KEY, JSON.stringify(saveData));
            this.logger?.log(`ゲーム状態を保存しました (ターン${gameState.turn}, ${gameState.phase})`, 'info');
            console.log('[SAVE-DEBUG] save: 保存完了, データサイズ=', JSON.stringify(saveData).length);
            return true;
        } catch (e) {
            this.logger?.log(`保存エラー: ${e.message}`, 'error');
            console.error('[SAVE-DEBUG] save: エラー', e);
            return false;
        }
    }

    /**
     * ゲーム状態を読み込み
     * @returns {Object|null} 保存データ、または null
     */
    load() {
        try {
            const data = localStorage.getItem(SaveManager.SAVE_KEY);
            if (!data) {
                console.log('[SAVE-DEBUG] load: 保存データなし');
                return null;
            }

            const saveData = JSON.parse(data);
            console.log('[SAVE-DEBUG] load: 読み込み成功, phase=', saveData.gameState?.phase, ', turn=', saveData.gameState?.turn);
            console.log('[SAVE-DEBUG] load: currentTrainingCards=', saveData.gameState?.currentTrainingCards?.map(c => c.cardName));
            this.logger?.log(`保存データを読み込みました (${saveData.savedAt})`, 'info');
            return saveData;
        } catch (e) {
            this.logger?.log(`読み込みエラー: ${e.message}`, 'error');
            console.error('[SAVE-DEBUG] load: エラー', e);
            return null;
        }
    }

    /**
     * 保存データを削除
     */
    clear() {
        try {
            localStorage.removeItem(SaveManager.SAVE_KEY);
            this.logger?.log('保存データを削除しました', 'info');
            return true;
        } catch (e) {
            this.logger?.log(`削除エラー: ${e.message}`, 'error');
            return false;
        }
    }

    /**
     * ビルドバージョンが一致するかチェック
     * @param {Object} saveData - 保存データ
     * @returns {boolean} 一致する場合 true
     */
    isVersionMatch(saveData) {
        const currentVersion = this.getBuildVersion();
        const savedVersion = saveData?.buildVersion;
        return currentVersion === savedVersion;
    }

    /**
     * GameState をシリアライズ
     * @param {GameState} gameState
     * @returns {Object}
     */
    serializeGameState(gameState) {
        return {
            difficulty: gameState.difficulty || 'fresh',
            turn: gameState.turn,
            phase: gameState.phase,
            player: {
                experience: gameState.player.experience,
                enrollment: gameState.player.enrollment,
                satisfaction: gameState.player.satisfaction,
                accounting: gameState.player.accounting,
                deck: gameState.player.deck.map(card => this.serializeCard(card)),
                hand: gameState.player.hand.map(card => this.serializeCard(card)),
                placed: {
                    leader: gameState.player.placed.leader.map(c => this.serializeCard(c)),
                    teacher: gameState.player.placed.teacher.map(c => this.serializeCard(c)),
                    staff: gameState.player.placed.staff.map(c => this.serializeCard(c))
                },
                tokens: { ...gameState.tokens }
            },
            trainingRefreshRemaining: gameState.trainingRefreshRemaining ?? 0,
            // 研修フェーズ中の抽選カード
            currentTrainingCards: gameState.currentTrainingCards ?
                gameState.currentTrainingCards.map(card => this.serializeCard(card)) : null
        };
    }

    /**
     * カードをシリアライズ
     * @param {Object} card
     * @returns {Object}
     */
    serializeCard(card) {
        return {
            category: card.category,
            rarity: card.rarity,
            cardName: card.cardName,
            topEffect: card.topEffect,
            effect: card.effect,
            acquiredTurn: card.acquiredTurn
        };
    }

    /**
     * 研修デッキをシリアライズ
     * @param {CardManager} cardManager
     * @returns {Object}
     */
    serializeTrainingDecks(cardManager) {
        const result = {};
        for (const rarity of ['N', 'R', 'SR', 'SSR']) {
            result[rarity] = cardManager.trainingDecks[rarity].map(card => this.serializeCard(card));
        }
        return result;
    }

    /**
     * GameState を復元
     * @param {GameState} gameState
     * @param {Object} savedState
     */
    restoreGameState(gameState, savedState) {
        gameState.difficulty = savedState.difficulty || 'fresh';
        gameState.turn = savedState.turn;
        gameState.phase = savedState.phase;
        gameState.player.experience = savedState.player.experience;
        gameState.player.enrollment = savedState.player.enrollment;
        gameState.player.satisfaction = savedState.player.satisfaction;
        gameState.player.accounting = savedState.player.accounting;
        gameState.player.deck = savedState.player.deck.map(card => ({ ...card }));
        gameState.player.hand = savedState.player.hand.map(card => ({ ...card }));
        gameState.player.placed = {
            leader: (savedState.player.placed.leader || []).map(c => ({ ...c })),
            teacher: (savedState.player.placed.teacher || []).map(c => ({ ...c })),
            staff: (savedState.player.placed.staff || []).map(c => ({ ...c }))
        };
        gameState.tokens = savedState.tokens
            ? { ...savedState.tokens }
            : { passion: 0, inspiration: 0, organize: 0, fatigue: 0 };
        gameState.trainingRefreshRemaining = savedState.trainingRefreshRemaining ?? 0;
        // 研修フェーズ中の抽選カードを復元
        if (savedState.currentTrainingCards) {
            gameState.currentTrainingCards = savedState.currentTrainingCards.map(card => ({ ...card }));
        }
        this.logger?.log('ゲーム状態を復元しました', 'info');
    }

    /**
     * 研修デッキを復元
     * @param {CardManager} cardManager
     * @param {Object} savedDecks
     */
    restoreTrainingDecks(cardManager, savedDecks) {
        for (const rarity of ['N', 'R', 'SR', 'SSR']) {
            if (savedDecks[rarity]) {
                cardManager.trainingDecks[rarity] = savedDecks[rarity].map(card => ({ ...card }));
            }
        }
        this.logger?.log('研修デッキを復元しました', 'info');
    }
}
