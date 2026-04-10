/**
 * ScoreManager - スコア計算・記録・共有
 */
import { getHighScoreKey } from './difficultyConfig.js';

export class ScoreManager {
    constructor(logger) {
        this.logger = logger;
        this.rankTable = null;
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
     * ランクCSVを読み込み
     * @param {string} csvPath
     * @returns {Promise<Array|null>}
     */
    async loadRankData(csvPath) {
        try {
            const response = await fetch(csvPath);
            if (!response.ok) {
                throw new Error(`CSV読み込み失敗: ${response.status}`);
            }

            const text = await response.text();
            const lines = text
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line !== '');

            if (lines.length <= 1) {
                this.rankTable = [];
                return this.rankTable;
            }

            const headers = lines[0]
                .split(',')
                .map((header) => header.replace(/^\uFEFF/, '').trim());
            const headerIndex = {};
            headers.forEach((header, index) => {
                headerIndex[header] = index;
            });

            const getCell = (cells, headerName) => cells[headerIndex[headerName]];
            const hasHeader = (headerName) => headerIndex[headerName] !== undefined;
            const getNullableFromHeader = (cells, headerName) =>
                hasHeader(headerName) ? toNullableInt(getCell(cells, headerName)) : null;
            const toNullableInt = (raw) => {
                if (raw === undefined || raw === null) return null;
                const trimmed = String(raw).trim();
                if (trimmed === '') return null;
                const parsed = parseInt(trimmed, 10);
                return Number.isNaN(parsed) ? null : parsed;
            };

            this.rankTable = lines
                .slice(1)
                .map((line) => {
                    const cells = line.split(',').map((cell) => cell.trim());
                    const grade = (getCell(cells, 'ランク') || '').replace(/^\uFEFF/, '').trim();
                    if (!grade) return null;

                    const baseRow = {
                        grade,
                        thresholds: {
                            experience: toNullableInt(getCell(cells, '体験基準')),
                            enrollment: toNullableInt(getCell(cells, '入塾基準')),
                            satisfaction: toNullableInt(getCell(cells, '満足基準')),
                            accounting: toNullableInt(getCell(cells, '経理基準'))
                        },
                        withdrawalThreshold: getNullableFromHeader(cells, '退塾基準'),
                        enrollmentDiffThreshold: getNullableFromHeader(cells, '入退差基準'),
                        scores: {
                            mobilization: getNullableFromHeader(cells, '動員スコア'),
                            withdrawal: getNullableFromHeader(cells, '退塾スコア'),
                            enrollmentDiff: getNullableFromHeader(cells, '入退差スコア'),
                            satisfaction: getNullableFromHeader(cells, '満足スコア')
                        },
                        rankThreshold: getNullableFromHeader(cells, 'ランク基準スコア')
                    };

                    return baseRow;
                })
                .filter(Boolean);

            return this.rankTable;
        } catch (error) {
            this.logger?.log(`ランクCSV読み込みエラー: ${error.message}`, 'error');
            this.rankTable = null;
            return null;
        }
    }

    /**
     * ステータスの現在ランクを取得
     * @param {'experience'|'enrollment'|'satisfaction'|'accounting'} statKey
     * @param {number} value
     * @param {'fresh'|'pro'} difficulty
     * @returns {{grade:string,startThreshold:number,currentThreshold:number,nextThreshold:number,deficit:number,targetGrade:string}|null}
     */
    getStatusRank(statKey, value, difficulty = 'fresh') {
        if (!this.rankTable || this.rankTable.length === 0) {
            return null;
        }

        let currentIndex = -1;
        for (let i = this.rankTable.length - 1; i >= 0; i -= 1) {
            const threshold = this.rankTable[i]?.thresholds?.[statKey];
            if (threshold !== null && threshold !== undefined && value >= threshold) {
                currentIndex = i;
                break;
            }
        }

        if (currentIndex === -1) {
            currentIndex = 0;
        }

        const currentRow = this.rankTable[currentIndex];
        const currentThreshold = currentRow?.thresholds?.[statKey] ?? 0;
        const findGradeIndex = (grade) => this.rankTable.findIndex((row) => row?.grade === grade);
        const getScoreGroupStartThreshold = (scoreKey, thresholdGetter, currentScore) => {
            for (let i = 0; i < this.rankTable.length; i += 1) {
                const row = this.rankTable[i];
                const threshold = thresholdGetter(row);
                if (
                    row?.scores?.[scoreKey] === currentScore &&
                    threshold !== null &&
                    threshold !== undefined
                ) {
                    return threshold;
                }
            }
            return currentThreshold;
        };
        const getScoreGroupTarget = (scoreKey, thresholdGetter, currentScore) => {
            for (let i = 0; i < this.rankTable.length; i += 1) {
                const row = this.rankTable[i];
                const threshold = thresholdGetter(row);
                if (
                    row?.scores?.[scoreKey] !== null &&
                    row?.scores?.[scoreKey] > currentScore &&
                    threshold !== null &&
                    threshold !== undefined
                ) {
                    return {
                        threshold,
                        grade: row.grade
                    };
                }
            }

            let highestSameScoreRow = null;
            for (let i = 0; i < this.rankTable.length; i += 1) {
                const row = this.rankTable[i];
                const threshold = thresholdGetter(row);
                if (
                    row?.scores?.[scoreKey] === currentScore &&
                    threshold !== null &&
                    threshold !== undefined
                ) {
                    highestSameScoreRow = row;
                }
            }

            if (!highestSameScoreRow) return null;
            return {
                threshold: thresholdGetter(highestSameScoreRow),
                grade: highestSameScoreRow.grade
            };
        };
        const getSequentialNextTarget = () => {
            if (currentIndex >= this.rankTable.length - 1) return null;
            const nextRow = this.rankTable[currentIndex + 1];
            const threshold = nextRow?.thresholds?.[statKey];
            if (threshold === null || threshold === undefined) return null;
            return {
                threshold,
                grade: nextRow.grade
            };
        };

        let target = null;
        let currentMobilizationScore = 0;
        let currentEnrollmentDiffScore = 0;
        let currentFreshDiffScore = 0;

        if (difficulty === 'pro') {
            if (statKey === 'experience') {
                for (let i = this.rankTable.length - 1; i >= 0; i -= 1) {
                    const row = this.rankTable[i];
                    if (
                        row?.scores?.mobilization !== null &&
                        row?.thresholds?.experience !== null &&
                        value >= row.thresholds.experience
                    ) {
                        currentMobilizationScore = row.scores.mobilization;
                        break;
                    }
                }

                target = getScoreGroupTarget(
                    'mobilization',
                    (row) => row?.thresholds?.experience,
                    currentMobilizationScore
                );
            } else if (statKey === 'enrollment') {
                for (let i = this.rankTable.length - 1; i >= 0; i -= 1) {
                    const row = this.rankTable[i];
                    if (
                        row?.scores?.enrollmentDiff !== null &&
                        row?.enrollmentDiffThreshold !== null &&
                        value >= row.enrollmentDiffThreshold
                    ) {
                        currentEnrollmentDiffScore = row.scores.enrollmentDiff;
                        break;
                    }
                }

                target = getScoreGroupTarget(
                    'enrollmentDiff',
                    (row) => row?.enrollmentDiffThreshold,
                    currentEnrollmentDiffScore
                );
            } else if (statKey === 'satisfaction' || statKey === 'accounting') {
                const sIndex = findGradeIndex('S');
                const sThreshold = sIndex >= 0 ? this.rankTable[sIndex]?.thresholds?.[statKey] : null;
                if (
                    sIndex >= 0 &&
                    currentIndex < sIndex &&
                    sThreshold !== null &&
                    sThreshold !== undefined
                ) {
                    target = {
                        threshold: sThreshold,
                        grade: 'S'
                    };
                } else {
                    target = getSequentialNextTarget();
                }
            } else {
                target = getSequentialNextTarget();
            }
        } else {
            if (statKey === 'experience' || statKey === 'enrollment') {
                for (let i = this.rankTable.length - 1; i >= 0; i -= 1) {
                    const row = this.rankTable[i];
                    const threshold = row?.thresholds?.[statKey];
                    if (
                        row?.scores?.enrollmentDiff !== null &&
                        threshold !== null &&
                        threshold !== undefined &&
                        value >= threshold
                    ) {
                        currentFreshDiffScore = row.scores.enrollmentDiff;
                        break;
                    }
                }

                target = getScoreGroupTarget(
                    'enrollmentDiff',
                    (row) => row?.thresholds?.[statKey],
                    currentFreshDiffScore
                );
            } else if (statKey === 'satisfaction' || statKey === 'accounting') {
                const sIndex = findGradeIndex('S');
                const sThreshold = sIndex >= 0 ? this.rankTable[sIndex]?.thresholds?.[statKey] : null;
                if (
                    sIndex >= 0 &&
                    currentIndex < sIndex &&
                    sThreshold !== null &&
                    sThreshold !== undefined
                ) {
                    target = {
                        threshold: sThreshold,
                        grade: 'S'
                    };
                } else {
                    target = getSequentialNextTarget();
                }
            } else {
                target = getSequentialNextTarget();
            }
        }

        // --- startThreshold の計算 ---
        let startThreshold = currentThreshold; // デフォルト（逐次の場合）

        if (difficulty === 'pro') {
            if (statKey === 'experience') {
                startThreshold = getScoreGroupStartThreshold(
                    'mobilization',
                    (row) => row?.thresholds?.experience,
                    currentMobilizationScore
                );
            } else if (statKey === 'enrollment') {
                startThreshold = getScoreGroupStartThreshold(
                    'enrollmentDiff',
                    (row) => row?.enrollmentDiffThreshold,
                    currentEnrollmentDiffScore
                );
            } else if (statKey === 'satisfaction' || statKey === 'accounting') {
                // PRO満足・経理: Sランク未到達なら始点=0、S以上は currentThreshold（逐次）
                const sIndex = findGradeIndex('S');
                if (sIndex >= 0 && currentIndex < sIndex) {
                    startThreshold = 0;
                }
                // else: startThreshold = currentThreshold (初期値のまま)
            }
            // PRO体験・入塾以外（getSequentialNextTarget の場合）はデフォルトのまま
        } else {
            // FRESH
            if (statKey === 'experience' || statKey === 'enrollment') {
                startThreshold = getScoreGroupStartThreshold(
                    'enrollmentDiff',
                    (row) => row?.thresholds?.[statKey],
                    currentFreshDiffScore
                );
            } else if (statKey === 'satisfaction' || statKey === 'accounting') {
                // Sランク未到達なら始点=0
                const sIndex = findGradeIndex('S');
                if (sIndex >= 0 && currentIndex < sIndex) {
                    startThreshold = 0;
                }
            }
        }

        const nextThreshold = target?.threshold ?? currentThreshold;
        const targetGrade = target?.grade ?? currentRow.grade;
        const deficit = target ? Math.max(nextThreshold - value, 0) : 0;

        return {
            grade: currentRow.grade,
            startThreshold,
            currentThreshold,
            nextThreshold,
            deficit,
            targetGrade
        };
    }

    /**
     * PRO難易度のスコア計算
     * @param {Object} gameState
     */
    calculateScorePro(gameState) {
        const PRO_RANK_NAMES = {
            F: '達成ならず',
            E: '達成ならず',
            D: '達成まであと一歩',
            C: 'ギリギリ達成',
            B: '危なげなく達成',
            'B+': '好調教室の仲間入り',
            A: '近隣教室の憧れ！',
            'A+': '地域最優秀教室ノミネート！',
            S: '地域最優秀教室！！',
            'S+': '全社最優秀教室！！',
            SS: '空前絶後の偉業達成！！'
        };

        const withdrawal = this.calculateWithdrawal(gameState);
        const mobilization = gameState.player.experience;
        const enrollmentDiff = gameState.player.enrollment - withdrawal;

        const findPoints = (predicate, scoreKey) => {
            for (let i = this.rankTable.length - 1; i >= 0; i -= 1) {
                const row = this.rankTable[i];
                if (predicate(row)) {
                    return row.scores[scoreKey];
                }
            }
            return 0;
        };

        const mobilizationPoints = findPoints(
            (row) =>
                row?.scores?.mobilization !== null &&
                row?.thresholds?.experience !== null &&
                mobilization >= row.thresholds.experience,
            'mobilization'
        );
        const withdrawalPoints = findPoints(
            (row) =>
                row?.scores?.withdrawal !== null &&
                row?.withdrawalThreshold !== null &&
                withdrawal <= row.withdrawalThreshold,
            'withdrawal'
        );
        const enrollmentDiffPoints = findPoints(
            (row) =>
                row?.scores?.enrollmentDiff !== null &&
                row?.enrollmentDiffThreshold !== null &&
                enrollmentDiff >= row.enrollmentDiffThreshold,
            'enrollmentDiff'
        );
        const satisfactionPoints = findPoints(
            (row) =>
                row?.scores?.satisfaction !== null &&
                row?.thresholds?.satisfaction !== null &&
                gameState.player.satisfaction >= row.thresholds.satisfaction,
            'satisfaction'
        );

        const points = mobilizationPoints + withdrawalPoints + enrollmentDiffPoints + satisfactionPoints;

        let rankGrade = this.rankTable[0]?.grade || 'F';
        for (let i = this.rankTable.length - 1; i >= 0; i -= 1) {
            const row = this.rankTable[i];
            if (row?.rankThreshold !== null && points >= row.rankThreshold) {
                rankGrade = row.grade;
                break;
            }
        }

        this.logger?.log('--- スコア計算 ---', 'info');
        this.logger?.log(`退塾数: ${withdrawal}`, 'status');
        this.logger?.log(`動員合計: ${mobilization}`, 'status');
        this.logger?.log(`入退差: ${enrollmentDiff}`, 'status');
        this.logger?.log(`目標ポイント: ${points}`, 'status');

        return {
            points,
            displayScore: points,
            withdrawal,
            mobilization,
            enrollmentDiff,
            experience: gameState.player.experience,
            enrollment: gameState.player.enrollment,
            satisfaction: gameState.player.satisfaction,
            accounting: gameState.player.accounting,
            rank: {
                grade: rankGrade,
                name: PRO_RANK_NAMES[rankGrade] || rankGrade
            },
            breakdown: {
                mobilizationPoints,
                withdrawalPoints,
                enrollmentDiffPoints,
                satisfactionPoints
            }
        };
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
        // PROの場合はPRO専用ロジックを使う
        if ((gameState.difficulty || 'fresh') === 'pro' && this.rankTable) {
            return this.calculateScorePro(gameState);
        }

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

        // FRESHは観点別得点8点満点時のみ精度スコアを計算（満点10）
        let displayScore = points;
        let splusBreakdown = null;
        if (points === 8) {
            const experience = gameState.player.experience;
            const expUsed = Math.min(experience, 30);
            const diffUsed = Math.min(enrollmentDiff, 30);
            const rawExpBonus = 0.5 * (expUsed - 12) / 18;
            const rawDiffBonus = 1.5 * (diffUsed - 12) / 18;
            const expBonus = Math.round(rawExpBonus * 10) / 10;
            const diffBonus = Math.round(rawDiffBonus * 10) / 10;
            const totalScore = 8 + rawExpBonus + rawDiffBonus;
            displayScore = Math.round(totalScore * 10) / 10;

            splusBreakdown = {
                base: 8.0,
                expUsed,
                diffUsed,
                expBonus,
                diffBonus
            };
        }

        // ランク計算（S+はdisplayScore 9点以上）
        const rank = this.calculateRank(points, displayScore);

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
            splusBreakdown,
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
    calculateRank(points, displayScore = points) {
        if (displayScore >= 9) {
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
