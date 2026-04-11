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
     * セーブデータの整合性署名を計算（カジュアル改ざん検知用）
     * @param {string} dataStr - JSON文字列化されたセーブデータ
     * @returns {string} 署名文字列
     */
    _computeSignature(dataStr) {
        const key = 'cdg-spring-2026-integrity';
        const str = dataStr + key;
        let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
        for (let i = 0; i < str.length; i++) {
            const ch = str.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 3266489909);
        return ((h1 ^ h2) >>> 0).toString(36) + '-' + ((h2 ^ h1) >>> 0).toString(36);
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

            window.CDG_DEBUG && console.log('[SAVE-DEBUG] save: phase=', gameState.phase, ', turn=', gameState.turn);
            window.CDG_DEBUG && console.log('[SAVE-DEBUG] save: currentTrainingCards=', gameState.currentTrainingCards?.map(c => c.cardName));
            window.CDG_DEBUG && console.log('[SAVE-DEBUG] save: hand=', gameState.player.hand.map(c => c.cardName));
            window.CDG_DEBUG && console.log('[SAVE-DEBUG] save: deck=', gameState.player.deck.map(c => c.cardName));

            const dataStr = JSON.stringify(saveData);
            const sig = this._computeSignature(dataStr);
            localStorage.setItem(SaveManager.SAVE_KEY, JSON.stringify({ data: dataStr, sig: sig }));
            this.logger?.log(`ゲーム状態を保存しました (ターン${gameState.turn}, ${gameState.phase})`, 'info');
            window.CDG_DEBUG && console.log('[SAVE-DEBUG] save: 保存完了, データサイズ=', dataStr.length);
            return true;
        } catch (e) {
            this.logger?.log(`保存エラー: ${e.message}`, 'error');
            window.CDG_DEBUG && console.error('[SAVE-DEBUG] save: エラー', e);
            return false;
        }
    }

    /**
     * ゲーム状態を読み込み
     * @returns {Object|null} 保存データ、または null
     */
    load() {
        try {
            const raw = localStorage.getItem(SaveManager.SAVE_KEY);
            if (!raw) {
                window.CDG_DEBUG && console.log('[SAVE-DEBUG] load: 保存データなし');
                return null;
            }

            const parsed = JSON.parse(raw);

            let saveData;
            if (parsed.data && parsed.sig) {
                // 新形式: 署名検証
                if (this._computeSignature(parsed.data) !== parsed.sig) {
                    this.logger?.log('セーブデータの整合性チェックに失敗しました。データが改ざんされた可能性があります。', 'error');
                    window.CDG_DEBUG && console.error('[SAVE-DEBUG] load: 署名不一致 - 改ざん検知');
                    return null;
                }
                saveData = JSON.parse(parsed.data);
            } else {
                // 旧形式: 署名なし（後方互換）
                window.CDG_DEBUG && console.log('[SAVE-DEBUG] load: 旧形式データを検出（次回保存時に署名付き形式へ移行）');
                saveData = parsed;
            }

            window.CDG_DEBUG && console.log('[SAVE-DEBUG] load: 読み込み成功, phase=', saveData.gameState?.phase, ', turn=', saveData.gameState?.turn);
            window.CDG_DEBUG && console.log('[SAVE-DEBUG] load: currentTrainingCards=', saveData.gameState?.currentTrainingCards?.map(c => c.cardName));
            this.logger?.log(`保存データを読み込みました (${saveData.savedAt})`, 'info');
            return saveData;
        } catch (e) {
            this.logger?.log(`読み込みエラー: ${e.message}`, 'error');
            window.CDG_DEBUG && console.error('[SAVE-DEBUG] load: エラー', e);
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
            startedAt: gameState.startedAt || null,
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
        // 旧形式（ルート直下tokens）と新形式（player.tokens）の両方に対応
        const savedTokens = savedState.player?.tokens || savedState.tokens;
        gameState.tokens = savedTokens
            ? { passion: 0, inspiration: 0, organize: 0, fatigue: 0, ...savedTokens }
            : { passion: 0, inspiration: 0, organize: 0, fatigue: 0 };
        gameState.startedAt = savedState.startedAt || null;
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
