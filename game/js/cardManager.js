/**
 * CardManager - カード管理と効果処理
 */
export class CardManager {
    constructor(logger) {
        this.logger = logger;
        this.allCards = [];
        this.trainingDecks = {
            N: [],
            R: [],
            SR: [],
            SSR: []
        };
    }

    /**
     * CSVファイルからカードデータをロード
     */
    async loadCards(csvPath) {
        try {
            const response = await fetch(csvPath);
            const csvText = await response.text();

            this.parseCSV(csvText);
            this.logger?.log(`カードデータ読み込み完了: ${this.allCards.length}枚`, 'info');

            return true;
        } catch (error) {
            this.logger?.log(`カードデータ読み込みエラー: ${error.message}`, 'error');
            return false;
        }
    }

    /**
     * CSVテキストをパース（quoted fields対応）
     */
    parseCSV(csvText) {
        const lines = csvText.trim().split('\n');

        // ヘッダー行をスキップ
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // quoted fields対応のCSVパース
            const parts = this.parseCSVLine(line);

            if (parts.length >= 5) {
                // cardsV2.csv形式: category, rarity, cardName, topEffect, effect
                const card = {
                    category: parts[0].trim(),
                    rarity: parts[1].trim(),
                    cardName: parts[2].trim(),
                    topEffect: parts[3].trim(),
                    effect: parts[4].trim()
                };

                this.allCards.push(card);
            } else if (parts.length >= 4) {
                // 旧形式（互換性維持）: category, rarity, cardName, effect
                const card = {
                    category: parts[0].trim(),
                    rarity: parts[1].trim(),
                    cardName: parts[2].trim(),
                    topEffect: '',
                    effect: parts[3].trim()
                };

                this.allCards.push(card);
            }
        }
    }

    /**
     * CSV行をパース（quoted fields対応）
     */
    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    // エスケープされたダブルクォート
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current);

        return result;
    }

    /**
     * 基本カード（N）を取得（各2枚ずつ）
     */
    getBasicCards() {
        const basicCards = [];
        const nCards = this.allCards.filter(c => c.rarity === 'N');

        // 各基本カードを2枚ずつ
        nCards.forEach(card => {
            basicCards.push({ ...card });
            basicCards.push({ ...card });
        });

        return basicCards;
    }

    /**
     * 研修候補プールを初期化（各カード2枚ずつ搭載）
     * ゲーム開始時に呼び出す
     */
    initTrainingPool() {
        this.trainingDecks = { N: [], R: [], SR: [], SSR: [] };

        this.allCards.forEach(card => {
            if (this.trainingDecks[card.rarity]) {
                this.trainingDecks[card.rarity].push({ ...card });
                this.trainingDecks[card.rarity].push({ ...card });
            }
        });

        // 各レアリティをシャッフル
        ['R', 'SR', 'SSR'].forEach(rarity => this.shuffleTrainingDeck(rarity));

        this.logger?.log('研修候補プールを初期化しました', 'info');
        for (const rarity of ['R', 'SR', 'SSR']) {
            const uniqueCount = new Set(this.trainingDecks[rarity].map(c => c.cardName)).size;
            this.logger?.log(`  ${rarity}: ${this.trainingDecks[rarity].length}枚 (${uniqueCount}種)`, 'info');
        }
    }

    /**
     * 指定レアリティのカードをシャッフル
     */
    shuffleTrainingDeck(rarity) {
        const deck = this.trainingDecks[rarity];
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
    }

    /**
     * 研修カードを引く
     * 異なるカード名を count 種選び、各1枚をプールから除外して返す
     * （デバッグモード対応）
     */
    drawTrainingCards(rarity, count) {
        if (!this.trainingDecks[rarity]) {
            this.logger?.log(`不明なレアリティ: ${rarity}`, 'error');
            return [];
        }

        const deck = this.trainingDecks[rarity];
        const drawn = [];
        const usedNames = new Set();

        // デバッグモード: 指定カードを優先的に引く
        if (window?.debugCards?.training?.length > 0) {
            for (const cardName of window.debugCards.training) {
                if (drawn.length >= count) break;
                if (usedNames.has(cardName)) continue;

                const idx = deck.findIndex(c => c.cardName === cardName);
                if (idx !== -1) {
                    const card = deck.splice(idx, 1)[0];
                    drawn.push({ ...card });
                    usedNames.add(cardName);
                    this.logger?.log(`[DEBUG] 研修カード優先引き: ${cardName}`, 'info');
                } else {
                    const searchCard = this.allCards.find(c => c.cardName === cardName);
                    if (searchCard) {
                        drawn.push({ ...searchCard });
                        usedNames.add(cardName);
                        this.logger?.log(`[DEBUG] 研修カード挿入: ${cardName} (プール外)`, 'info');
                    }
                }
            }
        }

        // 残りの枚数をプールから異なるカード名で引く
        // プール内のユニークなカード名を収集してシャッフル
        const availableNames = [...new Set(deck.map(c => c.cardName))]
            .filter(name => !usedNames.has(name));

        // シャッフル（Fisher-Yates）
        for (let i = availableNames.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [availableNames[i], availableNames[j]] = [availableNames[j], availableNames[i]];
        }

        for (let i = drawn.length; i < count; i++) {
            if (availableNames.length === 0) {
                this.logger?.log(`研修候補プールの${rarity}カードが不足しています`, 'info');
                break;
            }

            const name = availableNames.shift();
            const idx = deck.findIndex(c => c.cardName === name);
            if (idx !== -1) {
                const card = deck.splice(idx, 1)[0];
                drawn.push({ ...card });
            }
        }

        this.logger?.log(`研修カード提示: ${drawn.map(c => c.cardName).join(', ')} (${rarity}プール残: ${deck.length}枚)`, 'info');
        return drawn;
    }

    /**
     * ステータス名の日本語→英語マッピング
     */
    getStatusMap() {
        return {
            '体験': 'experience',
            '入塾': 'enrollment',
            '満足': 'satisfaction',
            '経理': 'accounting'
        };
    }

    /**
     * スタッフ名の日本語→英語マッピング
     */
    getStaffMap() {
        return {
            '室長': 'leader',
            '講師': 'teacher',
            '事務': 'staff'
        };
    }

    /**
     * カード効果をパース
     * @param {string} effectText - 効果テキスト
     * @returns {Object} パース済み効果データ
     */
    parseEffect(effectText) {
        const result = {
            staffRestrictions: [],   // 【】内のスタッフ制限
            baseEffects: [],         // 基本効果（無条件）
            conditionalBlocks: []    // 〈〉条件付きブロック
        };

        const statusMap = this.getStatusMap();
        const staffMap = this.getStaffMap();

        // 【】でスタッフ制限を抽出
        const restrictMatch = effectText.match(/【([^】]+)】/);
        if (restrictMatch) {
            const staffNames = restrictMatch[1].split('・');
            staffNames.forEach(name => {
                const mapped = staffMap[name.trim()];
                if (mapped) result.staffRestrictions.push(mapped);
            });
        }

        // 〈〉条件付きブロックを抽出して処理
        const conditionalRegex = /〈([^〉]+)〉([^。〈]+)/g;
        let condMatch;
        const conditionalRanges = [];

        while ((condMatch = conditionalRegex.exec(effectText)) !== null) {
            const condition = condMatch[1].trim();
            const effectPart = condMatch[2].trim();
            conditionalRanges.push({
                start: condMatch.index,
                end: condMatch.index + condMatch[0].length
            });

            const block = {
                condition: this.parseCondition(condition, staffMap, statusMap),
                effects: this.parseEffectPart(effectPart, statusMap)
            };
            result.conditionalBlocks.push(block);
        }

        // 基本効果を抽出（〈〉の外部にある効果）
        // まず効果テキストから〈〉ブロックを除去して基本効果を抽出
        let baseText = effectText;
        // 【】ブロックも除去
        baseText = baseText.replace(/【[^】]+】/g, '');
        // 〈〉ブロックを除去（〈条件〉効果。の形式）
        baseText = baseText.replace(/〈[^〉]+〉[^。〈]*/g, '');

        result.baseEffects = this.parseEffectPart(baseText, statusMap);

        return result;
    }

    /**
     * 条件部分をパース
     */
    parseCondition(conditionText, staffMap, statusMap) {
        // スタッフ条件（例: 室長、室長・講師）
        const staffNames = conditionText.split('・');
        const staffConditions = staffNames
            .map(name => staffMap[name.trim()])
            .filter(Boolean);

        if (staffConditions.length > 0) {
            return { type: 'staff', staffList: staffConditions };
        }

        // ステータス条件（例: 満足8以上、入塾9以下、経理13以下）
        const statusCondMatch = conditionText.match(/(体験|入塾|満足|経理)(\d+)(以上|以下)/);
        if (statusCondMatch) {
            return {
                type: 'status',
                status: statusMap[statusCondMatch[1]],
                value: parseInt(statusCondMatch[2]),
                comparison: statusCondMatch[3] === '以上' ? 'gte' : 'lte'
            };
        }

        // 不明な条件
        return { type: 'unknown', raw: conditionText };
    }

    /**
     * 効果部分をパース（「体験+2」「入塾+3、満足-1」「経理を14にする」など）
     */
    parseEffectPart(effectText, statusMap) {
        const effects = [];

        // 「経理を14にする」形式（絶対値設定）
        const setMatch = effectText.match(/(体験|入塾|満足|経理)を(\d+)にする/);
        if (setMatch) {
            effects.push({
                type: 'set',
                status: statusMap[setMatch[1]],
                value: parseInt(setMatch[2])
            });
        }

        // 「体験+2」「入塾-1」形式（相対値変更）
        const changeRegex = /(体験|入塾|満足|経理)([+\-])(\d+)/g;
        let changeMatch;
        while ((changeMatch = changeRegex.exec(effectText)) !== null) {
            const status = statusMap[changeMatch[1]];
            const sign = changeMatch[2] === '+' ? 1 : -1;
            const value = parseInt(changeMatch[3]) * sign;

            effects.push({
                type: 'change',
                status: status,
                value: value
            });
        }

        return effects;
    }

    /**
     * 条件を評価
     */
    evaluateCondition(condition, staff, gameState) {
        if (condition.type === 'staff') {
            return condition.staffList.includes(staff);
        }

        if (condition.type === 'status') {
            const currentValue = gameState.player[condition.status];
            if (condition.comparison === 'gte') {
                return currentValue >= condition.value;
            } else {
                return currentValue <= condition.value;
            }
        }

        // 不明な条件は適用しない
        return false;
    }

    /**
     * カード効果を適用
     */
    applyCardEffect(card, staff, gameState) {
        if (!card || !card.effect) {
            this.logger?.log('カード効果が空です', 'error');
            return false;
        }

        const parsed = this.parseEffect(card.effect);
        const staffNames = { leader: '室長', teacher: '講師', staff: '事務' };

        // スタッフ制限チェック
        if (parsed.staffRestrictions.length > 0 && !parsed.staffRestrictions.includes(staff)) {
            this.logger?.log(`${card.cardName}は${staffNames[staff]}に配置できません`, 'error');
            return false;
        }

        this.logger?.log(`カード効果発動: ${card.cardName} (${staffNames[staff]})`, 'action');

        // 基本効果を適用
        parsed.baseEffects.forEach(effect => {
            this.applyEffect(effect, gameState);
        });

        // 条件付き効果を評価・適用
        parsed.conditionalBlocks.forEach(block => {
            if (this.evaluateCondition(block.condition, staff, gameState)) {
                const conditionName = this.getConditionName(block.condition);
                this.logger?.log(`  条件成立: ${conditionName}`, 'info');
                block.effects.forEach(effect => {
                    this.applyEffect(effect, gameState);
                });
            }
        });

        return true;
    }

    /**
     * 単一効果を適用
     */
    applyEffect(effect, gameState) {
        const statusNames = {
            experience: '体験',
            enrollment: '入塾',
            satisfaction: '満足',
            accounting: '経理'
        };

        if (effect.type === 'set') {
            const before = gameState.player[effect.status];
            gameState.player[effect.status] = effect.value;
            this.logger?.log(`  ${statusNames[effect.status]}: ${before} → ${effect.value}`, 'status');
        } else if (effect.type === 'change') {
            const before = gameState.player[effect.status];
            gameState.updateStatus(effect.status, effect.value);
            const after = gameState.player[effect.status];
            const sign = effect.value > 0 ? '+' : '';
            this.logger?.log(`  ${statusNames[effect.status]}: ${before} → ${after} (${sign}${effect.value})`, 'status');
        }
    }

    /**
     * 条件の表示名を取得
     */
    getConditionName(condition) {
        if (condition.type === 'staff') {
            const staffNames = { leader: '室長', teacher: '講師', staff: '事務' };
            return condition.staffList.map(s => staffNames[s]).join('・');
        }
        if (condition.type === 'status') {
            const statusNames = {
                experience: '体験',
                enrollment: '入塾',
                satisfaction: '満足',
                accounting: '経理'
            };
            const comp = condition.comparison === 'gte' ? '以上' : '以下';
            return `${statusNames[condition.status]}${condition.value}${comp}`;
        }
        return condition.raw || '不明';
    }
}
