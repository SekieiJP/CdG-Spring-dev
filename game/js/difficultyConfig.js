/**
 * DifficultyConfig - 難易度設定の一元管理
 */
export const DIFFICULTY_CONFIG = {
    FRESH: {
        id: 'fresh',
        name: 'FRESH',
        csvPath: 'data/cards_fresh.csv',
        initialStatus: {
            experience: 0,
            enrollment: 0,
            satisfaction: 3,
            accounting: 3
        },
        trainingRefresh: {
            enabled: false
        }
    },
    PRO: {
        id: 'pro',
        name: 'PRO',
        csvPath: 'data/cards_pro.csv',
        initialStatus: {
            experience: 0,
            enrollment: 0,
            satisfaction: 3,
            accounting: 5  // 経理の初期値が高い（仮値）
        },
        trainingRefresh: {
            enabled: true,
            maxCount: 2
        }
    }
};

/**
 * 難易度IDからconfigを取得
 * @param {string} difficultyId - 'fresh' or 'pro'
 * @returns {Object} 難易度設定
 */
export function getDifficultyConfig(difficultyId) {
    return DIFFICULTY_CONFIG[difficultyId.toUpperCase()] || DIFFICULTY_CONFIG.FRESH;
}

/**
 * ハイスコアのLocalStorageキーを生成
 * @param {string} difficultyId - 'fresh' or 'pro'
 * @returns {string} LocalStorageキー
 */
export function getHighScoreKey(difficultyId) {
    return `bdrinkai_highscore_${difficultyId}`;
}
