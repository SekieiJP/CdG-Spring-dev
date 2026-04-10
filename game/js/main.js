/**
 * Main - エントリーポイント
 * v20260320-2335: 難易度選択システム追加
 */
import { Logger } from './logger.js?v=20260410-1915';
import { GameState } from './gameState.js?v=20260410-1915';
import { CardManager } from './cardManager.js?v=20260410-1915';
import { TurnManager } from './turnManager.js?v=20260410-1915';
import { ScoreManager } from './scoreManager.js?v=20260410-1915';
import { UIController } from './uiController.js?v=20260410-1915';
import { SaveManager } from './saveManager.js?v=20260410-1915';
import { getDifficultyConfig } from './difficultyConfig.js?v=20260410-1915';

const CACHE_BUSTER = 'v20260410-1915';

// ビルドバージョンをグローバルに公開
window.BUILD_VERSION = CACHE_BUSTER;

class Game {
    constructor() {
        this.logger = new Logger();
        this.gameState = new GameState(this.logger);
        this.cardManager = new CardManager(this.logger);
        this.turnManager = new TurnManager(this.gameState, this.cardManager, this.logger);
        this.scoreManager = new ScoreManager(this.logger);
        this.saveManager = new SaveManager(this.logger);
        this.uiController = new UIController(
            this.gameState,
            this.cardManager,
            this.turnManager,
            this.scoreManager,
            this.logger,
            this.saveManager
        );

        this.difficulty = 'fresh';
        this.cardLoadFailed = false;
    }

    async initialize() {
        this.logger.log('カードで学習塾 起動中...', 'info');
        this.logger.log(`ビルドバージョン: ${CACHE_BUSTER}`, 'info');

        // ログUI初期化
        this.logger.init();

        // デフォルトのFRESHカードデータをロード
        await this.loadCardsForDifficulty('fresh');

        // UI初期化
        this.uiController.init();

        // セーブデータ復元チェック
        if (this.saveManager.hasSaveData()) {
            const saveData = this.saveManager.load();
            if (saveData) {
                // ビルドバージョンチェック
                if (!this.saveManager.isVersionMatch(saveData)) {
                    this.logger.log('ゲームが更新されたため、セーブデータをリセットします', 'info');
                    // アップデート情報バッジ用フラグを立てる
                    localStorage.setItem('cdg_version_updated', 'true');
                    alert(`ゲームが更新されました。\n\n保存時: ${saveData.buildVersion}\n現在: ${CACHE_BUSTER}\n\n新しいゲームを開始してください。`);
                    this.saveManager.clear();
                } else {
                    // セーブデータから難易度を取得してカードを読み込み
                    const savedDifficulty = saveData.gameState?.difficulty || 'fresh';
                    if (savedDifficulty !== this.difficulty) {
                        await this.loadCardsForDifficulty(savedDifficulty);
                    }
                    // ゲーム状態を復元
                    this.restoreFromSave(saveData);
                    return;
                }
            }
        }

        // URLからスコアを読み込み（共有リンクの場合）
        const sharedScore = this.scoreManager.loadScoreFromURL();
        if (sharedScore) {
            this.showSharedScore(sharedScore);
        }

        // 通知バッジ判定
        this.updateNotificationBadges();

        this.logger.log('初期化完了: 難易度を選択してゲームを開始してください', 'info');
    }

    /**
     * 指定難易度のカードデータをロード
     * @param {string} difficultyId - 'fresh' or 'pro'
     * @returns {boolean} 読み込み成功/失敗
     */
    async loadCardsForDifficulty(difficultyId) {
        const config = getDifficultyConfig(difficultyId);
        this.difficulty = difficultyId;
        this.cardLoadFailed = false;

        const success = await this.cardManager.loadCards(config.csvPath);
        if (!success) {
            this.logger.log(`${config.name}のカードデータの読み込みに失敗しました`, 'info');
            this.cardLoadFailed = true;
            return false;
        }

        // ランクCSV読み込み
        if (config.rankCsvPath) {
            await this.scoreManager.loadRankData(config.rankCsvPath);
        }

        return true;
    }

    /**
     * 難易度を設定してカードを再読込
     * @param {string} difficultyId - 'fresh' or 'pro'
     * @returns {boolean} 読み込み成功/失敗
     */
    async setDifficulty(difficultyId) {
        return await this.loadCardsForDifficulty(difficultyId);
    }

    /**
     * 通知バッジの表示判定
     */
    updateNotificationBadges() {
        // 遊び方バッジ: cdg_visited がなければ初回アクセス
        const visited = localStorage.getItem('cdg_visited');
        if (!visited) {
            const badge = document.getElementById('badge-tutorial');
            if (badge) badge.classList.remove('hidden');
        }

        // 遊び方リンクのクリック時に cdg_visited を保存
        const tutorialLink = document.getElementById('link-tutorial');
        if (tutorialLink) {
            tutorialLink.addEventListener('click', () => {
                localStorage.setItem('cdg_visited', 'true');
            });
        }

        // アップデート情報バッジ: cdg_version_updated フラグがある場合
        const versionUpdated = localStorage.getItem('cdg_version_updated');
        if (versionUpdated) {
            const badge = document.getElementById('badge-release-note');
            if (badge) badge.classList.remove('hidden');
        }

        // アップデート情報リンクのクリック時にフラグをクリア
        const releaseLink = document.getElementById('link-release-note');
        if (releaseLink) {
            releaseLink.addEventListener('click', () => {
                localStorage.removeItem('cdg_version_updated');
            });
        }

        // タイトル画面を表示した事実を保存
        localStorage.setItem('cdg_visited', 'true');
    }

    /**
     * セーブデータからゲームを復元
     */
    restoreFromSave(saveData) {
        console.log('[SAVE-DEBUG] restoreFromSave: 開始');
        console.log('[SAVE-DEBUG] restoreFromSave: savedPhase=', saveData.gameState?.phase, ', savedTurn=', saveData.gameState?.turn);
        console.log('[SAVE-DEBUG] restoreFromSave: currentTrainingCards=', saveData.gameState?.currentTrainingCards?.map(c => c.cardName));

        this.logger.log('前回のゲームを復元しています...', 'info');

        // 研修デッキを復元
        this.saveManager.restoreTrainingDecks(this.cardManager, saveData.trainingDecks);

        // ゲーム状態を復元
        this.saveManager.restoreGameState(this.gameState, saveData.gameState);

        console.log('[SAVE-DEBUG] restoreFromSave: 復元後 phase=', this.gameState.phase, ', turn=', this.gameState.turn);
        console.log('[SAVE-DEBUG] restoreFromSave: 復元後 currentTrainingCards=', this.gameState.currentTrainingCards?.map(c => c.cardName));

        // UIを復元
        this.uiController.restoreUI();

        this.logger.log(`ゲームを復元しました (ターン${this.gameState.turn}, ${this.gameState.phase})`, 'info');
        console.log('[SAVE-DEBUG] restoreFromSave: 完了');
    }

    showSharedScore(score) {
        const message = `
共有されたスコア:
目標ポイント: ${score.points}
退塾数: ${score.withdrawal}
動員合計: ${score.mobilization}
入退差: ${score.enrollmentDiff}

詳細:
体験: ${score.experience}
入塾: ${score.enrollment}
満足: ${score.satisfaction}
経理: ${score.accounting}
        `.trim();

        alert(message);
        this.logger.log('共有スコアを表示しました', 'info');
    }
}

// ページ読み込み時に初期化
document.addEventListener('DOMContentLoaded', async () => {
    // デバッグモード: URLパラメータまたはコンソールから設定可能
    const game = new Game();
    window.game = game;
    window.debugCards = {
        training: [], // 研修会場に出したいカード名のリスト
        hand: []      // 手札に出したいカード名のリスト
    };

    // デバッグ関数: 研修候補に特定のカードを出す
    window.setDebugTrainingCards = function (cardNames) {
        window.debugCards.training = Array.isArray(cardNames) ? cardNames : [cardNames];
        console.log('[DEBUG] 研修候補設定:', window.debugCards.training);
    };

    // デバッグ関数: 手札に特定のカードを出す
    window.setDebugHandCards = function (cardNames) {
        window.debugCards.hand = Array.isArray(cardNames) ? cardNames : [cardNames];
        console.log('[DEBUG] 手札候補設定:', window.debugCards.hand);
    };

    // デバッグ関数: カード名で検索
    window.findCard = function (searchTerm) {
        const matches = game.cardManager.allCards.filter(c =>
            c.cardName.includes(searchTerm) || c.effect.includes(searchTerm)
        );
        console.table(matches.map(c => ({ name: c.cardName, category: c.category, rarity: c.rarity, effect: c.effect })));
        return matches;
    };

    /**
     * デバッグ関数: 任意のターンにスキップ
     * 使い方: debugSkipToTurn(7) で7ターン目（4月下旬）の研修フェーズから開始
     * @param {number} targetTurn - 0〜7のターン番号
     */
    window.debugSkipToTurn = function (targetTurn) {
        if (targetTurn < 0 || targetTurn > 7) {
            console.error('[DEBUG] ターン番号は0〜7で指定してください');
            return;
        }

        console.log(`[DEBUG] ターン${targetTurn + 1}にスキップ中...`);

        // ゲーム状態をリセット
        game.gameState.reset(game.gameState.difficulty);

        // 研修候補プールを初期化
        game.cardManager.initTrainingPool();

        // 基本カード（N）をデッキに追加
        const basicCards = game.cardManager.getBasicCards();
        basicCards.forEach(card => game.gameState.player.deck.push(card));

        // R・SRカードを適当にデッキに追加（ターン数に応じて増加）
        const rCards = game.cardManager.allCards.filter(c => c.rarity === 'R');
        const srCards = game.cardManager.allCards.filter(c => c.rarity === 'SR');
        const ssrCards = game.cardManager.allCards.filter(c => c.rarity === 'SSR');

        // ターン数に応じてカードを追加（初回2枚 + 各ターン1枚）
        const extraCardCount = Math.min(2 + targetTurn, rCards.length + srCards.length);
        const shuffled = [...rCards, ...srCards, ...ssrCards].sort(() => Math.random() - 0.5);
        for (let i = 0; i < extraCardCount && i < shuffled.length; i++) {
            game.gameState.player.deck.push({ ...shuffled[i] });
        }

        // ステータスを適当な値に設定
        game.gameState.player.experience = Math.floor(Math.random() * 6) + 3;
        game.gameState.player.enrollment = Math.floor(Math.random() * 6) + 3;
        game.gameState.player.satisfaction = Math.floor(Math.random() * 6) + 3;
        game.gameState.player.accounting = Math.floor(Math.random() * 6) + 3;

        // ターンとフェーズを設定
        game.gameState.turn = targetTurn;
        game.gameState.phase = 'training';

        // スタートオーバーレイを非表示
        const overlay = document.getElementById('start-overlay');
        overlay?.classList.add('hidden');

        // UI更新
        game.uiController.updateStatusDisplay();

        const config = game.turnManager.getCurrentTurnConfig();
        console.log(`[DEBUG] ターン${targetTurn + 1} (${config.name}) にスキップ完了`);
        console.log(`[DEBUG] デッキ: ${game.gameState.player.deck.length}枚, 研修: ${config.training}, 削除: ${config.delete}`);

        // 最終ターンの場合は教室行動フェーズから
        if (targetTurn === 7) {
            game.turnManager.startActionPhase();
            game.uiController.showActionPhase();
        } else {
            // 研修フェーズを表示
            game.uiController.showTrainingPhase();
        }
    };

    // URLからデバッグ設定を読み込み
    const params = new URLSearchParams(window.location.search);
    if (params.has('debug_training')) {
        window.debugCards.training = params.get('debug_training').split(',');
        console.log('[DEBUG] URL: 研修候補設定:', window.debugCards.training);
    }
    if (params.has('debug_hand')) {
        window.debugCards.hand = params.get('debug_hand').split(',');
        console.log('[DEBUG] URL: 手札候補設定:', window.debugCards.hand);
    }

    await game.initialize();
});
