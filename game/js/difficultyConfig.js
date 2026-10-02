import { DEFAULT_SLOTS, DEFAULT_TURNS } from './defaultRules.js?v=20260815-0051';
/**
 * DifficultyConfig - 難易度設定の一元管理
 */
export const DIFFICULTY_CONFIG = {
    FRESH: {
        id: 'fresh',
        name: 'FRESH',
        csvPath: 'data/cards_fresh.csv',
        rankCsvPath: 'data/rankFresh.csv',
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
        rankCsvPath: 'data/rankPro.csv',
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
export function getDifficultyConfig(difficultyId = 'fresh') {
    const config = DIFFICULTY_CONFIG[String(difficultyId).toUpperCase()];
    if (!config) throw new Error(`未登録の難易度: ${difficultyId}`);
    return config;
}

/** 固有ルールは別モジュールから登録する。FRESHへの暗黙変換はしない。 */
export function registerDifficulty(config) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(config?.id || '') || !config.name || !config.csvPath || !config.rankCsvPath) {
        throw new Error('難易度にはid・name・csvPath・rankCsvPathが必要です');
    }
    if (DIFFICULTY_CONFIG[config.id.toUpperCase()]) throw new Error(`登録済みの難易度: ${config.id}`);
    const slots = config.slots || DEFAULT_SLOTS;
    if (!slots.length || slots.length > 4 || new Set(slots.map(slot => slot.id)).size !== slots.length ||
        slots.some(slot => !/^[a-z][a-z0-9-]*$/.test(slot.id) || !slot.name || !(slot.capacity > 0))) {
        throw new Error('配置先は固有のid・name・正のcapacityを持つ1〜4件です');
    }
    if (!config.turns?.length) throw new Error('ターン構成が必要です');
    if (!['fresh', 'pro', 'custom'].includes(config.scoringModel || 'fresh')) throw new Error('得点方式が不明です');
    if (config.scoringModel === 'custom' && typeof config.rules?.calculateScore !== 'function') throw new Error('customの得点方式にはcalculateScoreが必要です');
    DIFFICULTY_CONFIG[config.id.toUpperCase()] = {
        initialStatus: { experience: 0, enrollment: 0, satisfaction: 3, accounting: 3 },
        trainingRefresh: { enabled: false }, cardZones: [], rules: {},
        ...config, slots: slots.map(slot => ({ allowParallel: false, persistent: false, ...slot }))
    };
    return getDifficultyConfig(config.id);
}

export function listDifficulties() { return Object.values(DIFFICULTY_CONFIG); }

for (const config of Object.values(DIFFICULTY_CONFIG)) {
    config.slots = DEFAULT_SLOTS.map(slot => ({ ...slot }));
    config.turns = DEFAULT_TURNS.map(turn => ({ ...turn }));
    config.cardZones = [];
    config.rules = {};
    config.scoringModel = config.id;
}

/**
 * ハイスコアのLocalStorageキーを生成
 * @param {string} difficultyId - 'fresh' or 'pro'
 * @returns {string} LocalStorageキー
 */
export function getHighScoreKey(difficultyId) {
    return `bdrinkai_highscore_${difficultyId}`;
}
