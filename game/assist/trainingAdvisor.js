const CATEGORY_LABELS = {
    '動員': '体験(動員)',
    '教務': '入退差(教務)',
    '庶務': '経理(庶務)',
    '応対': '満足(応対)',
    '支障': '支障'
};

const PRO_POSITIVE_NAME_BIAS = {
    '振込用紙印刷': 1.2,
    '入塾手続きのご案内': 1.0,
    '保護者説明会': 1.0,
    '今だけ！体験生特典': 0.95,
    '備品注文': 0.7,
    '教室清掃': 0.5,
    '未入金家庭へ電話': 0.45,
    '友人紹介': 0.5,
    '進学相談フェア出展': 0.45,
    '努力の結晶 合格実績掲示': 0.4
};

const PRO_NEGATIVE_NAME_BIAS = {
    '生徒面談の基本': -3.0,
    '休み時間トーク': -0.9,
    '日々の出迎え': -0.8,
    '補習大会': -0.75
};

function safeInt(value) {
    return Number.isFinite(value) ? value : 0;
}

function normalizeStrategyProfile(difficulty = 'pro', profile = '') {
    if (difficulty === 'fresh') return 'fresh_default';
    const normalized = String(profile || '').trim().toLowerCase();
    const aliasMap = {
        stable: 'strategic1_stable',
        smax: 'strategic1',
        upside: 'strategic1_upside',
        pro_stable: 'strategic1_stable',
        pro_strategic1: 'strategic1',
        pro_strategic1_stable: 'strategic1_stable',
        pro_strategic1_upside: 'strategic1_upside',
        strategic1: 'strategic1',
        strategic1_stable: 'strategic1_stable',
        strategic1_upside: 'strategic1_upside'
    };
    return aliasMap[normalized] || 'strategic1_stable';
}

function normalizeStatus(status = {}) {
    const experience = Math.max(0, safeInt(status.experience));
    const enrollment = Math.max(0, Math.min(experience, safeInt(status.enrollment)));
    const satisfaction = Math.max(0, safeInt(status.satisfaction));
    const accounting = Math.max(0, safeInt(status.accounting));
    return { experience, enrollment, satisfaction, accounting };
}

function calcWithdrawal(status) {
    return Math.max(15 - status.accounting, 0) + Math.max(15 - status.satisfaction, 0);
}

function buildProNeeds(status) {
    const withdrawal = calcWithdrawal(status);
    const enrollmentDiff = status.enrollment - withdrawal;
    return {
        withdrawal,
        enrollmentDiff,
        experienceNeed: Math.max(40 - status.experience, 0),
        enrollmentDiffNeed: Math.max(32 - enrollmentDiff, 0),
        enrollmentDiffNeed40: Math.max(40 - enrollmentDiff, 0),
        accountingNeed: Math.max(15 - status.accounting, 0),
        satisfactionNeed: Math.max(15 - status.satisfaction, 0),
        satisfactionBridgeNeed: Math.max(25 - status.satisfaction, 0),
        satisfactionExcess: Math.max(status.satisfaction - 25, 0),
        accountingExcess: Math.max(status.accounting - 18, 0)
    };
}

function buildFreshNeeds(status) {
    const withdrawal = calcWithdrawal(status);
    const enrollmentDiff = status.enrollment - withdrawal;
    return {
        withdrawal,
        enrollmentDiff,
        experienceNeed: Math.max(12 - status.experience, 0),
        enrollmentDiffNeed: Math.max(12 - enrollmentDiff, 0),
        accountingNeed: Math.max(15 - status.accounting, 0),
        satisfactionNeed: Math.max(15 - status.satisfaction, 0),
        satisfactionExcess: Math.max(status.satisfaction - 15, 0)
    };
}

function normalizeOption(option, cardLookup = {}) {
    if (typeof option === 'string') {
        const ref = cardLookup[option] || {};
        return {
            cardName: option,
            category: ref.category || 'UNKNOWN',
            rarity: ref.rarity || 'UNKNOWN',
            effect: ref.effect || ''
        };
    }

    const name = option?.cardName || option?.name || '';
    const ref = cardLookup[name] || {};
    return {
        cardName: name,
        category: option?.category || ref.category || 'UNKNOWN',
        rarity: option?.rarity || ref.rarity || 'UNKNOWN',
        effect: option?.effect || ref.effect || ''
    };
}

export function buildCardLookup(cards = []) {
    const lookup = {};
    cards.forEach((card) => {
        if (!card?.cardName) return;
        lookup[card.cardName] = {
            category: card.category || 'UNKNOWN',
            rarity: card.rarity || 'UNKNOWN',
            effect: card.effect || ''
        };
    });
    return lookup;
}

function hasToken(effectText = '', token) {
    return effectText.includes(token);
}

function getProNameBias(card, needs, turn, profile = 'strategic1_stable') {
    const isStrategic1 = profile === 'strategic1' || profile === 'strategic1_stable' || profile === 'strategic1_upside';
    const isStrategic1Stable = profile === 'strategic1_stable';
    const isStrategic1Upside = profile === 'strategic1_upside';
    const name = card.cardName;
    let bias = 0;

    if (PRO_POSITIVE_NAME_BIAS[name]) {
        bias += PRO_POSITIVE_NAME_BIAS[name];
    }
    if (PRO_NEGATIVE_NAME_BIAS[name]) {
        bias += PRO_NEGATIVE_NAME_BIAS[name];
    }

    if (name === '保護者説明会' && needs.experienceNeed <= 0) {
        bias -= turn >= 5 ? 0.35 : 0.2;
    }
    if (name === '入塾手続きのご案内' && needs.enrollmentDiffNeed <= 0 && needs.accountingNeed <= 0) {
        bias -= 0.6;
    }
    if (name === '今だけ！体験生特典' && needs.accountingNeed > 2) {
        bias -= 0.45;
    }
    if (name === '学力確認＆向上 公開模試') {
        if (needs.enrollmentDiffNeed > 6 && needs.accountingNeed <= 1) bias += 0.95;
        if (needs.accountingNeed > 2) bias -= 1.35;
    }
    if (name === 'できるまで居残り！') {
        if (needs.enrollmentDiffNeed > 8) bias += 0.75;
        if (needs.accountingNeed > 3) bias -= 0.45;
    }
    if (name === '友人紹介') {
        if (needs.satisfactionNeed > 0 && needs.accountingNeed > 1) bias -= 0.55;
        else bias += 0.45;
    }
    if (isStrategic1 && name === '学力確認＆向上 公開模試' && needs.accountingNeed <= 2) {
        bias += 0.35;
    }
    if (isStrategic1 && name === '今だけ！体験生特典' && needs.accountingNeed <= 1) {
        bias += 0.25;
    }
    if (name === '未入金家庭へ電話' && needs.satisfactionNeed > 0) {
        bias -= 0.35;
    }
    if (name === 'プロジェクター授業') {
        if (needs.accountingNeed > 0) bias -= 0.8;
        if (needs.enrollmentDiffNeed < 6) bias -= 0.8;
        if (needs.enrollmentDiffNeed >= 8 && needs.accountingNeed <= 0) bias += 1.1;
    }
    if (name === '生徒面談の基本' && needs.satisfactionNeed <= 0) {
        bias -= 0.4 + Math.min(needs.satisfactionExcess * 0.1, 0.8);
    }
    if (isStrategic1 && name === '学力確認＆向上 公開模試') {
        bias += 1.0;
        if (turn >= 5 && needs.enrollmentDiffNeed40 > 0) bias += 1.0;
        if (needs.accountingNeed > 2) bias -= isStrategic1Stable ? 0.7 : 0.4;
    }
    if (isStrategic1 && name === '締切間近の書類リマインド') {
        bias += turn <= 5 ? 1.0 : 0.35;
    }
    if (isStrategic1 && name === '笑顔伝わる教室通信') {
        if (turn >= 2 && turn <= 5 && needs.satisfactionNeed > 0) bias += 0.85;
        if (turn >= 6) bias -= 0.35;
    }
    if (isStrategic1 && name === '提出書類ファイリング') {
        bias += turn <= 4 ? 0.8 : 0.2;
    }
    if (isStrategic1 && name === '質問対応の基本' && turn <= 2) {
        bias -= 1.0;
    }
    if (isStrategic1Upside && card.rarity === 'SSR') {
        bias += 0.2;
    }

    return bias;
}

function getFreshNameBias(card, needs) {
    const name = card.cardName;
    let bias = 0;

    if (name === '生徒面談の基本' && needs.satisfactionNeed <= 0) bias -= 1.8;
    if (name === '休み時間トーク' && needs.satisfactionNeed <= 0) bias -= 0.7;
    if (name === '振込用紙印刷') bias += 0.7;
    if (name === '入塾手続きのご案内' && (needs.enrollmentDiffNeed > 0 || needs.accountingNeed > 0)) bias += 0.6;

    return bias;
}

function scoreProCard(card, context, reasonTags) {
    const needs = buildProNeeds(context.status);
    const turn = context.turn;
    const profile = context.profile || 'strategic1_stable';
    const isStrategic1 = profile === 'strategic1' || profile === 'strategic1_stable' || profile === 'strategic1_upside';
    const isStrategic1Stable = profile === 'strategic1_stable';
    const isStrategic1Upside = profile === 'strategic1_upside';
    let score = 0;

    if (card.category === '動員') {
        score += needs.experienceNeed > 0 ? 0.9 + Math.min(needs.experienceNeed / 20, 2.0) : 0.2;
        if (turn >= 6 && needs.experienceNeed > 0) score += 0.8;
        if (isStrategic1) score += 0.35;
        if (isStrategic1Upside) score += 0.4;
        reasonTags.push('exp');
    } else if (card.category === '教務') {
        score += needs.enrollmentDiffNeed > 0 ? 1.2 + Math.min(needs.enrollmentDiffNeed / 14, 2.2) : 0.2;
        if (turn >= 5 && needs.enrollmentDiffNeed > 0) score += 0.9;
        if (isStrategic1) score += 0.75;
        if (turn >= 5 && needs.enrollmentDiffNeed40 > 0) score += 1.0;
        if (isStrategic1Upside) score += 0.35;
        reasonTags.push('diff');
    } else if (card.category === '庶務') {
        score += needs.accountingNeed > 0 ? 1.1 + Math.min(needs.accountingNeed / 8, 2.0) : 0.1;
        if (needs.accountingExcess > 0) score -= Math.min(needs.accountingExcess * 0.2, 1.2);
        if (isStrategic1Stable && needs.accountingNeed > 0) score += 0.25;
        reasonTags.push('acc');
    } else if (card.category === '応対') {
        score += needs.satisfactionNeed > 0 ? 1.0 + Math.min(needs.satisfactionNeed / 8, 1.8) : 0;
        const stableBridgeMode =
            isStrategic1Stable &&
            needs.withdrawal <= 1 &&
            needs.satisfactionBridgeNeed > 0 &&
            needs.satisfactionBridgeNeed <= 8 &&
            (needs.experienceNeed <= 15 || needs.enrollmentDiffNeed <= 10);
        if (needs.satisfactionNeed <= 0) score -= stableBridgeMode ? 0.35 : 1.3;
        if (stableBridgeMode) score += 1.0;
        if (needs.satisfactionExcess > 0) score -= Math.min(needs.satisfactionExcess * 0.3, 2.2);
        reasonTags.push('sat');
    } else if (card.category === '支障') {
        score -= 1.8;
        reasonTags.push('risk');
    }

    if (card.rarity === 'SSR') score += isStrategic1Upside ? 1.1 : isStrategic1 ? 0.95 : 0.75;
    else if (card.rarity === 'SR') score += isStrategic1 ? 0.5 : 0.4;
    else if (card.rarity === 'N' && turn >= 3) score -= 0.6;

    if (needs.withdrawal >= 2 && (card.category === '庶務' || card.category === '応対')) {
        score += 1.0;
        reasonTags.push('withdrawal');
    }

    if (hasToken(card.effect, '発想')) score += 1.25;
    if (hasToken(card.effect, '情熱')) score += turn <= 4 ? 1.0 : 0.6;
    if (hasToken(card.effect, '整理')) score += turn >= 3 ? 0.8 : 0.3;
    if (hasToken(card.effect, '疲労')) score -= 1.1;
    if (hasToken(card.effect, '並行')) score += isStrategic1 ? 0.7 : 0.5;
    if (hasToken(card.effect, '発想') && hasToken(card.effect, '並行')) score += isStrategic1 ? 0.35 : 0.1;
    if (hasToken(card.effect, '情熱') && hasToken(card.effect, '並行')) score += isStrategic1 ? 0.25 : 0;
    if (needs.accountingNeed > 0) {
        const accountingPenaltyScale = isStrategic1Stable ? 0.78 : isStrategic1 ? 0.72 : 1;
        if (card.effect.includes('経-2')) score -= (isStrategic1 ? 0.9 : 1.3) * accountingPenaltyScale;
        else if (card.effect.includes('経-1')) score -= (isStrategic1 ? 0.45 : 0.85) * accountingPenaltyScale;
    }
    if (hasToken(card.effect, '疲労') && turn >= 6) {
        score += 0.9;
    }
    if (isStrategic1) {
        if (turn <= 2 && card.category === '動員') score += 1.15;
        if (turn <= 2 && card.category === '教務') score -= 0.35;
        if (turn >= 2 && turn <= 4 && card.category === '応対') score += needs.satisfactionNeed > 0 ? 1.0 : -0.3;
        if (turn >= 5 && card.category === '教務') score += 1.2;
        if (turn >= 5 && needs.enrollmentDiffNeed40 > 0 && card.category === '教務') score += 0.65;
        if (isStrategic1Stable && turn >= 5 && card.category === '教務') score += 0.45;
        if (isStrategic1Stable && needs.accountingNeed <= 0 && card.category === '庶務') score -= 0.15;
        if (turn >= 6 && card.category === '応対' && needs.satisfactionNeed <= 0) score -= 0.6;
    }

    score += getProNameBias(card, needs, turn, profile);
    return score;
}

function scoreFreshCard(card, context, reasonTags) {
    const needs = buildFreshNeeds(context.status);
    const turn = context.turn;
    let score = 0;

    if (card.category === '動員') {
        score += needs.experienceNeed > 0 ? 1.0 + Math.min(needs.experienceNeed / 6, 1.4) : 0.2;
        reasonTags.push('exp');
    } else if (card.category === '教務') {
        score += needs.enrollmentDiffNeed > 0 ? 1.2 + Math.min(needs.enrollmentDiffNeed / 6, 1.8) : 0.2;
        reasonTags.push('diff');
    } else if (card.category === '庶務') {
        score += needs.accountingNeed > 0 ? 1.0 + Math.min(needs.accountingNeed / 7, 1.5) : 0.1;
        reasonTags.push('acc');
    } else if (card.category === '応対') {
        score += needs.satisfactionNeed > 0 ? 0.95 + Math.min(needs.satisfactionNeed / 7, 1.5) : 0;
        if (needs.satisfactionNeed <= 0) score -= 1.0 + Math.min(needs.satisfactionExcess * 0.2, 1.6);
        reasonTags.push('sat');
    }

    if (card.rarity === 'SSR') score += 0.7;
    else if (card.rarity === 'SR') score += 0.35;
    else if (card.rarity === 'N' && turn >= 4) score -= 0.65;

    score += getFreshNameBias(card, needs);
    return score;
}

function buildSummary(top, needs, difficulty) {
    const focus = [];
    if (difficulty === 'pro') {
        if (needs.enrollmentDiffNeed > 0) focus.push('入退差');
        if (needs.experienceNeed > 0) focus.push('体験');
        if (needs.accountingNeed > 0 || needs.satisfactionNeed > 0) focus.push('退塾抑制');
        if (needs.satisfactionExcess > 0) focus.push('満足過剰抑制');
    } else {
        if (needs.enrollmentDiffNeed > 0) focus.push('入退差');
        if (needs.experienceNeed > 0) focus.push('体験');
        if (needs.accountingNeed > 0 || needs.satisfactionNeed > 0) focus.push('退塾抑制');
    }

    const major = focus.length > 0 ? focus.join('・') : '全体バランス';
    return `おすすめ: ${top.cardName}（重視: ${major}）`;
}

export function recommendTrainingCard(input = {}) {
    const difficulty = input.difficulty === 'fresh' ? 'fresh' : 'pro';
    const strategyProfile = normalizeStrategyProfile(difficulty, input.strategyProfile);
    const turn = Math.max(0, Math.min(7, safeInt(input.turn)));
    const status = normalizeStatus(input.status || {});
    const cardLookup = input.cardLookup || {};
    const options = Array.isArray(input.options) ? input.options : [];

    if (options.length === 0) {
        return {
            recommendedCardName: null,
            ranking: [],
            needsSnapshot: difficulty === 'pro' ? buildProNeeds(status) : buildFreshNeeds(status),
            summary: '候補カードがありません。'
        };
    }

    const scored = options
        .map((rawOption) => {
            const card = normalizeOption(rawOption, cardLookup);
            const reasonTags = [];
            const score = difficulty === 'pro'
                ? scoreProCard(card, { difficulty, turn, status, profile: strategyProfile }, reasonTags)
                : scoreFreshCard(card, { difficulty, turn, status }, reasonTags);

            return {
                cardName: card.cardName,
                category: card.category,
                rarity: card.rarity,
                score,
                reasonTags
            };
        })
        .sort((a, b) => b.score - a.score);

    const needs = difficulty === 'pro' ? buildProNeeds(status) : buildFreshNeeds(status);
    const top = scored[0];

    return {
        recommendedCardName: top.cardName,
        ranking: scored,
        needsSnapshot: needs,
        summary: buildSummary(top, needs, difficulty)
    };
}

export function recommendCardName(input = {}) {
    return recommendTrainingCard(input).recommendedCardName;
}

export function explainTopChoice(input = {}) {
    const result = recommendTrainingCard(input);
    const top = result.ranking[0];
    if (!top) return '候補がありません。';

    const tagLabel = {
        exp: '体験不足の補完',
        diff: '入退差不足の補完',
        acc: '経理不足の補完',
        sat: '満足不足の補完',
        withdrawal: '退塾リスク低減',
        risk: 'リスク回避'
    };

    const reasons = top.reasonTags
        .map((tag) => tagLabel[tag])
        .filter(Boolean)
        .filter((v, i, arr) => arr.indexOf(v) === i);

    const categoryName = CATEGORY_LABELS[top.category] || top.category || '不明カテゴリ';
    const reasonText = reasons.length > 0 ? reasons.join('、') : '総合スコアが最も高い';
    return `${top.cardName} を推奨。カテゴリ: ${categoryName}。理由: ${reasonText}。`;
}

if (typeof window !== 'undefined') {
    window.cdgAssist = Object.assign({}, window.cdgAssist || {}, {
        recommendTrainingCard,
        recommendCardName,
        explainTopChoice
    });
}
