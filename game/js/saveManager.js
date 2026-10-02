import { RandomSource } from './randomSource.js?v=20260815-0053';
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
                trainingDecks: this.serializeTrainingDecks(cardManager),
                trainingDiscards: this.serializeTrainingDiscards(cardManager)
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
        const getGameVersion = (version) => {
            const match = String(version || '').match(/^v(\d{8})-\d{4}$/);
            return match ? match[1] : null;
        };

        const currentGameVersion = getGameVersion(currentVersion);
        const savedGameVersion = getGameVersion(savedVersion);
        // 下4桁は表示などゲーム内容に影響しない更新用のため、中断データを維持する。
        return currentGameVersion !== null && currentGameVersion === savedGameVersion;
    }

    /**
     * GameState をシリアライズ
     * @param {GameState} gameState
     * @returns {Object}
     */
    serializeGameState(gameState) {
        gameState.ensureCardIdentities();
        return {
            difficulty: gameState.difficulty || 'fresh',
            calcMode: gameState.calcMode || false,
            turn: gameState.turn,
            phase: gameState.phase,
            player: {
                experience: gameState.player.experience,
                enrollment: gameState.player.enrollment,
                satisfaction: gameState.player.satisfaction,
                accounting: gameState.player.accounting,
                deck: gameState.player.deck.map(card => this.serializeCard(card)),
                hand: gameState.player.hand.map(card => this.serializeCard(card)),
                placed: this.serializeCardGroups(gameState.player.placed),
                zones: this.serializeCardGroups(gameState.player.zones),
                tokens: { ...gameState.tokens }
            },
            startedAt: gameState.startedAt || null,
            runId: gameState.runId,
            nextInstanceId: gameState.nextInstanceId,
            ruleState: structuredClone(gameState.ruleState || {}),
            pendingAction: structuredClone(gameState.pendingAction || null),
            randomState: gameState.rng.snapshot(),
            playRecord: gameState.exportPlayRecord(),
            discardedCards: [...(gameState.discardedCards || [])],
            trainingRefreshRemaining: gameState.trainingRefreshRemaining ?? 0,
            trainingRefreshPhaseStartRemaining: gameState.trainingRefreshPhaseStartRemaining ?? gameState.trainingRefreshRemaining ?? 0,
            trainingSelectionMode: gameState.trainingSelectionMode ?? null,
            // 研修フェーズ中の抽選カード
            currentTrainingCards: gameState.currentTrainingCards ?
                gameState.currentTrainingCards.map(card => this.serializeCard(card)) : null,
            event: gameState.event ? JSON.parse(JSON.stringify(gameState.event)) : null,
            eventCardUsage: { ...(gameState.eventCardUsage || {}) }
        };
    }

    /**
     * カードをシリアライズ
     * @param {Object} card
     * @returns {Object}
     */
    serializeCard(card) {
        return structuredClone(card);
    }

    serializeCardGroups(groups = {}) {
        return Object.fromEntries(Object.entries(groups).map(([id, cards]) => [id, cards.map(card => this.serializeCard(card))]));
    }

    /**
     * 研修デッキをシリアライズ
     * @param {CardManager} cardManager
     * @returns {Object}
     */
    serializeTrainingDecks(cardManager) {
        const result = {};
        for (const rarity of ['N', 'R', 'SR', 'SSR']) {
            result[rarity] = (cardManager.trainingDecks[rarity] || []).map(card => this.serializeCard(card));
        }
        return result;
    }

    serializeTrainingDiscards(cardManager) {
        return Object.fromEntries(['R', 'SR', 'SSR'].map(rarity => [rarity,
            (cardManager.trainingDiscards?.[rarity] || []).map(card => this.serializeCard(card))
        ]));
    }

    /**
     * GameState を復元
     * @param {GameState} gameState
     * @param {Object} savedState
     */
    restoreGameState(gameState, savedState) {
        gameState.difficulty = savedState.difficulty || 'fresh';
        gameState.calcMode = savedState.calcMode || false;
        gameState.turn = savedState.turn;
        gameState.phase = savedState.phase;
        gameState.player.experience = savedState.player.experience;
        gameState.player.enrollment = savedState.player.enrollment;
        gameState.player.satisfaction = savedState.player.satisfaction;
        gameState.player.accounting = savedState.player.accounting;
        gameState.player.deck = savedState.player.deck.map(card => ({ ...card }));
        gameState.player.hand = savedState.player.hand.map(card => ({ ...card }));
        gameState.player.placed = this.serializeCardGroups(savedState.player.placed);
        for (const id of gameState.slotIds) gameState.player.placed[id] ||= [];
        gameState.player.zones = this.serializeCardGroups(savedState.player.zones);
        for (const id of gameState.config.cardZones) gameState.player.zones[id] ||= [];
        gameState.runId = savedState.runId || gameState.runId;
        gameState.nextInstanceId = savedState.nextInstanceId || 1;
        gameState.ruleState = structuredClone(savedState.ruleState || {});
        gameState.pendingAction = structuredClone(savedState.pendingAction || null);
        if (savedState.randomState) gameState.rng = RandomSource.restore(savedState.randomState);
        gameState.playRecord = structuredClone(savedState.playRecord || null);
        gameState.ensureCardIdentities();
        // 旧形式（ルート直下tokens）と新形式（player.tokens）の両方に対応
        const savedTokens = savedState.player?.tokens || savedState.tokens;
        gameState.tokens = savedTokens
            ? { passion: 0, inspiration: 0, organize: 0, fatigue: 0, ...savedTokens }
            : { passion: 0, inspiration: 0, organize: 0, fatigue: 0 };
        gameState.startedAt = savedState.startedAt || null;
        gameState.discardedCards = [...(savedState.discardedCards || [])];
        gameState.trainingRefreshRemaining = savedState.trainingRefreshRemaining ?? 0;
        gameState.trainingRefreshPhaseStartRemaining = savedState.trainingRefreshPhaseStartRemaining ?? gameState.trainingRefreshRemaining;
        // 旧保存のnullはUIの従来推定へ渡し、新しい保存では通常／発想を明示する。
        gameState.trainingSelectionMode = savedState.trainingSelectionMode ?? null;
        // 研修フェーズ中の抽選カードを復元
        gameState.currentTrainingCards = savedState.currentTrainingCards?.map(card => ({ ...card })) ?? null;
        gameState.event = savedState.event ? JSON.parse(JSON.stringify(savedState.event)) : null;
        gameState.eventCardUsage = { ...(savedState.eventCardUsage || {}) };
        this.logger?.log('ゲーム状態を復元しました', 'info');
    }

    /**
     * 研修デッキを復元
     * @param {CardManager} cardManager
     * @param {Object} savedDecks
     */
    restoreTrainingDecks(cardManager, savedDecks = {}, savedDiscards = {}) {
        for (const rarity of ['N', 'R', 'SR', 'SSR']) {
            if (savedDecks[rarity]) {
                cardManager.trainingDecks[rarity] = savedDecks[rarity].map(card => ({ ...card }));
            }
        }
        cardManager.trainingDiscards = Object.fromEntries(['R', 'SR', 'SSR'].map(rarity => [rarity,
            (savedDiscards?.[rarity] || []).map(card => ({ ...card }))
        ]));
        this.logger?.log('研修デッキを復元しました', 'info');
    }
}
