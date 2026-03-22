/**
 * ScoreManager - スコア計算・記録・共有
 */
import { getHighScoreKey } from './difficultyConfig.js';

export class ScoreManager {
    constructor(logger) {
        this.logger = logger;
        this.migrateOldHighScore();
    }

    /**
     * 旧ハイスコアキーを難易度別キーにマイグレーション
     */
    migrateOldHighScore() {
        try {
            const oldKey = 'bdrinkai_highscore';
            const oldData = localStorage.getItem(oldKey);
            const newKey = getHighScoreKey('fresh');
            if (oldData && !localStorage.getItem(newKey)) {
                localStorage.setItem(newKey, oldData);
                localStorage.removeItem(oldKey);
                this.logger?.log('旧ハイスコアをFRESH用にマイグレーションしました', 'info');
            }
        } catch (e) {
            // マイグレーション失敗は無視
        }
    }

    /**
     * 退塾数を計算
     */
    calculateWithdrawal(gameState) {
        const accounting = gameState.player.accounting;
        const satisfaction = gameState.player.satisfaction;

        const accountingShortage = Math.max(15 - accounting, 0);
        const satisfactionShortage = Math.max(15 - satisfaction, 0);

        return accountingShortage + satisfactionShortage;
    }

    /**
     * スコアを計算
     */
    calculateScore(gameState) {
        const withdrawal = this.calculateWithdrawal(gameState);
        const mobilization = gameState.player.experience; // 動員目標は体験数のみ
        const enrollmentDiff = gameState.player.enrollment - withdrawal;

        let points = 0;

        // 退塾目標
        if (withdrawal >= 4) {
            points -= 3;
        } else if (withdrawal <= 1) {
            points += 1;
        }

        // 動員目標
        if (mobilization >= 12) {
            points += 2;
        } else if (mobilization >= 10) {
            points += 1;
        }

        // 入退目標
        if (enrollmentDiff >= 12) {
            points += 5;
        } else if (enrollmentDiff >= 10) {
            points += 4;
        } else if (enrollmentDiff >= 8) {
            points += 3;
        }

        this.logger?.log('--- スコア計算 ---', 'info');
        this.logger?.log(`退塾数: ${withdrawal}`, 'status');
        this.logger?.log(`動員合計: ${mobilization}`, 'status');
        this.logger?.log(`入退差: ${enrollmentDiff}`, 'status');
        this.logger?.log(`目標ポイント: ${points}`, 'status');

        // 各目標のポイント内訳
        let withdrawalPoints = 0;
        if (withdrawal >= 4) withdrawalPoints = -3;
        else if (withdrawal <= 1) withdrawalPoints = 1;

        let mobilizationPoints = 0;
        if (mobilization >= 12) mobilizationPoints = 2;
        else if (mobilization >= 10) mobilizationPoints = 1;

        let enrollmentDiffPoints = 0;
        if (enrollmentDiff >= 12) enrollmentDiffPoints = 5;
        else if (enrollmentDiff >= 10) enrollmentDiffPoints = 4;
        else if (enrollmentDiff >= 8) enrollmentDiffPoints = 3;

        // ランク計算
        const rank = this.calculateRank(points, withdrawal, mobilization, gameState.player.enrollment);

        // S+かつFRESHのとき: 小数スコアを計算（満点10）
        let displayScore = points;
        if (rank.grade === 'S+' && (gameState.difficulty || 'fresh') === 'fresh') {
            const exp = Math.min(gameState.player.experience, 30);
            const enr = Math.min(gameState.player.enrollment, 30);
            const splusScore = 8 + 0.5 * (exp - 15) / 15 + 1.5 * (enr - 15) / 15;
            displayScore = Math.round(splusScore * 10) / 10;
        }

        return {
            points,
            displayScore,
            withdrawal,
            mobilization,
            enrollmentDiff,
            experience: gameState.player.experience,
            enrollment: gameState.player.enrollment,
            satisfaction: gameState.player.satisfaction,
            accounting: gameState.player.accounting,
            rank,
            breakdown: {
                withdrawalPoints,
                mobilizationPoints,
                enrollmentDiffPoints
            }
        };
    }

    /**
     * ランク計算
     */
    calculateRank(points, withdrawal, mobilization, enrollment) {
        // S+条件: 退塾0 かつ 動員15以上 かつ 入塾15以上
        if (withdrawal === 0 && mobilization >= 15 && enrollment >= 15) {
            return { grade: 'S+', name: '全社最優秀教室!!!' };
        }

        if (points >= 8) return { grade: 'S', name: '最優秀教室！' };
        if (points >= 7) return { grade: 'A', name: '優秀教室ノミネート' };
        if (points >= 5) return { grade: 'B', name: '好調教室の仲間入り' };
        if (points >= 4) return { grade: 'C', name: 'ギリギリ達成' };
        if (points >= 1) return { grade: 'D', name: '達成あと一歩' };
        return { grade: 'E', name: '達成ならず' };
    }

    /**
     * ハイスコアを取得
     * @param {string} [difficulty='fresh'] - 難易度ID
     */
    getHighScore(difficulty = 'fresh') {
        try {
            const key = getHighScoreKey(difficulty);
            const saved = localStorage.getItem(key);
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (error) {
            this.logger?.log(`ハイスコア読み込みエラー: ${error.message}`, 'error');
        }
        return null;
    }

    /**
     * ハイスコアを保存
     * @param {Object} score - スコアデータ
     * @param {string} [difficulty='fresh'] - 難易度ID
     */
    saveHighScore(score, difficulty = 'fresh') {
        try {
            const current = this.getHighScore(difficulty);

            // 現在のスコアがハイスコアより高い場合のみ保存
            const currentBest = current ? (current.displayScore ?? current.points) : -Infinity;
            if (!current || score.displayScore > currentBest) {
                const key = getHighScoreKey(difficulty);
                localStorage.setItem(key, JSON.stringify({
                    points: score.points,
                    displayScore: score.displayScore,
                    date: new Date().toISOString(),
                    ...score
                }));

                this.logger?.log(`新ハイスコア記録: ${score.points}ポイント (${difficulty.toUpperCase()})`, 'action');
                return true;
            }
        } catch (error) {
            this.logger?.log(`ハイスコア保存エラー: ${error.message}`, 'error');
        }
        return false;
    }

    /**
     * スコア共有URLを生成
     */
    generateShareURL(score) {
        const params = new URLSearchParams({
            p: score.points,
            w: score.withdrawal,
            m: score.mobilization,
            d: score.enrollmentDiff,
            exp: score.experience,
            enr: score.enrollment,
            sat: score.satisfaction,
            acc: score.accounting
        });

        const baseURL = window.location.origin + window.location.pathname;
        return `${baseURL}?score=${params.toString()}`;
    }

    /**
     * URLからスコアを読み込み
     */
    loadScoreFromURL() {
        const urlParams = new URLSearchParams(window.location.search);
        const scoreParam = urlParams.get('score');

        if (scoreParam) {
            try {
                const scoreParams = new URLSearchParams(scoreParam);
                return {
                    points: parseInt(scoreParams.get('p')) || 0,
                    withdrawal: parseInt(scoreParams.get('w')) || 0,
                    mobilization: parseInt(scoreParams.get('m')) || 0,
                    enrollmentDiff: parseInt(scoreParams.get('d')) || 0,
                    experience: parseInt(scoreParams.get('exp')) || 0,
                    enrollment: parseInt(scoreParams.get('enr')) || 0,
                    satisfaction: parseInt(scoreParams.get('sat')) || 0,
                    accounting: parseInt(scoreParams.get('acc')) || 0
                };
            } catch (error) {
                this.logger?.log(`URL からのスコア読み込みエラー: ${error.message}`, 'error');
            }
        }

        return null;
    }
}
