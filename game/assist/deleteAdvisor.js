const CATEGORY_LABELS = {
    '動員': '体験(動員)',
    '教務': '入退差(教務)',
    '庶務': '経理(庶務)',
    '応対': '満足(応対)',
    '支障': '支障'
};

const PRO_KEEP_NAME_BIAS = {
    '振込用紙印刷': 1.2,
    '入塾手続きのご案内': 0.95,
    '保護者説明会': 0.9,
    '機材故障は本部に相談': 0.85,
    '備品注文': 0.65,
    '今だけ！体験生特典': 0.6
};

function safeInt(value) {
    return Number.isFinite(value) ? value : 0;
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
        accountingNeed: Math.max(15 - status.accounting, 0),
        satisfactionNeed: Math.max(15 - status.satisfaction, 0),
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

function hasToken(effectText = '', token) {
    return effectText.includes(token);
}

function scoreProKeepValue(card, ctx, reasonTags) {
    const needs = buildProNeeds(ctx.status);
    const turn = ctx.turn;
    const profile = ctx.profile;
    const isSmax = profile === 'smax';
    const isUpside = profile === 'upside';
    let score = 0;

    if (card.category === '動員') {
        score += needs.experienceNeed > 0 ? 1.0 + Math.min(needs.experienceNeed / 20, 2.0) : 0.2;
        if (turn >= 5 && needs.experienceNeed <= 0) score -= 0.35;
        reasonTags.push('exp');
    } else if (card.category === '教務') {
        score += needs.enrollmentDiffNeed > 0 ? 1.2 + Math.min(needs.enrollmentDiffNeed / 15, 2.2) : 0.25;
        reasonTags.push('diff');
    } else if (card.category === '庶務') {
        score += needs.accountingNeed > 0 ? 1.15 + Math.min(needs.accountingNeed / 8, 2.1) : 0.2;
        if (needs.accountingExcess > 0) score -= Math.min(needs.accountingExcess * 0.18, 1.2);
        reasonTags.push('acc');
    } else if (card.category === '応対') {
        score += needs.satisfactionNeed > 0 ? 1.0 + Math.min(needs.satisfactionNeed / 8, 1.9) : 0;
        if (needs.satisfactionNeed <= 0) score -= 1.2 + Math.min(needs.satisfactionExcess * 0.2, 1.8);
        reasonTags.push('sat');
    } else if (card.category === '支障') {
        score -= 2.0;
        reasonTags.push('risk');
    }

    if (card.rarity === 'SSR') score += isUpside ? 1.0 : isSmax ? 0.95 : 0.8;
    else if (card.rarity === 'SR') score += isSmax ? 0.55 : 0.45;
    else if (card.rarity === 'N' && turn >= 3) score -= 0.8;

    if (needs.withdrawal >= 2 && (card.category === '庶務' || card.category === '応対')) {
        score += 1.0;
        reasonTags.push('withdrawal');
    }

    if (hasToken(card.effect, '発想')) score += 1.2;
    if (hasToken(card.effect, '情熱')) score += turn <= 4 ? 1.0 : 0.6;
    if (hasToken(card.effect, '整理')) score += turn >= 3 ? 0.8 : 0.35;
    if (hasToken(card.effect, '並行')) score += 0.5;
    if (hasToken(card.effect, '疲労')) score -= turn >= 6 ? 0.35 : 1.0;

    if (needs.accountingNeed > 0) {
        if (card.effect.includes('経-2')) score -= isSmax ? 0.9 : 1.25;
        else if (card.effect.includes('経-1')) score -= isSmax ? 0.45 : 0.8;
    }

    if (PRO_KEEP_NAME_BIAS[card.cardName]) {
        score += PRO_KEEP_NAME_BIAS[card.cardName];
    }

    if (card.cardName === '経理精算の基本' && needs.accountingNeed <= 2) score -= 2.0;
    if (card.cardName === '生徒面談の基本' && needs.satisfactionNeed <= 2) score -= 1.8;
    if (card.cardName === '休み時間トーク' && needs.satisfactionNeed <= 0) score -= 1.0;
    if (card.cardName === '日々の出迎え' && needs.satisfactionNeed <= 0) score -= 0.9;
    if (card.cardName === 'スタンプ帳キャンペーン' && needs.satisfactionNeed <= 0) score -= 1.0;
    if (card.cardName === '補習大会' && needs.accountingNeed > 1) score -= 0.9;
    if (card.cardName === '褒めて励ます授業' && needs.satisfactionNeed <= 0) score -= 0.9;
    if (card.cardName === 'プロジェクター授業' && (needs.accountingNeed > 0 || needs.enrollmentDiffNeed < 6)) score -= 1.0;

    return score;
}

function scoreFreshKeepValue(card, ctx, reasonTags) {
    const needs = buildFreshNeeds(ctx.status);
    const turn = ctx.turn;
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
        score += needs.satisfactionNeed > 0 ? 0.9 + Math.min(needs.satisfactionNeed / 7, 1.5) : 0;
        if (needs.satisfactionNeed <= 0) score -= 1.0 + Math.min(needs.satisfactionExcess * 0.2, 1.5);
        reasonTags.push('sat');
    }

    if (card.rarity === 'SSR') score += 0.7;
    else if (card.rarity === 'SR') score += 0.35;
    else if (card.rarity === 'N' && turn >= 4) score -= 0.6;

    if (card.cardName === '生徒面談の基本' && needs.satisfactionNeed <= 0) score -= 1.8;
    if (card.cardName === '休み時間トーク' && needs.satisfactionNeed <= 0) score -= 0.7;
    if (card.cardName === '振込用紙印刷') score += 0.65;

    return score;
}

function buildSummary(topDelete, difficulty, mode) {
    const modeLabel = mode === 'n_only' ? 'N限定削除' : '通常削除';
    const category = CATEGORY_LABELS[topDelete.category] || topDelete.category || '不明';
    return `おすすめ削除: ${topDelete.cardName}（${category} / ${modeLabel}）`;
}

export function recommendDeleteCards(input = {}) {
    const difficulty = input.difficulty === 'fresh' ? 'fresh' : 'pro';
    const strategyProfile = input.strategyProfile === 'smax'
        ? 'smax'
        : input.strategyProfile === 'upside'
            ? 'upside'
            : 'stable';
    const deletePolicy = input.deletePolicy === 'n_only' ? 'n_only' : 'normal';
    const turn = Math.max(0, Math.min(7, safeInt(input.turn)));
    const status = normalizeStatus(input.status || {});
    const cardLookup = input.cardLookup || {};
    const deck = Array.isArray(input.deck) ? input.deck : [];
    const deleteMax = Math.max(0, safeInt(input.deleteMax || 1));

    if (deck.length === 0 || deleteMax <= 0) {
        return {
            recommendedDeleteCardNames: [],
            ranking: [],
            needsSnapshot: difficulty === 'pro' ? buildProNeeds(status) : buildFreshNeeds(status),
            summary: '削除候補がありません。'
        };
    }

    const normalizedDeck = deck
        .map((entry) => normalizeOption(entry, cardLookup))
        .filter((card) => card.cardName);

    const filteredDeck = deletePolicy === 'n_only'
        ? normalizedDeck.filter((card) => card.rarity === 'N')
        : normalizedDeck;

    if (filteredDeck.length === 0) {
        return {
            recommendedDeleteCardNames: [],
            ranking: [],
            needsSnapshot: difficulty === 'pro' ? buildProNeeds(status) : buildFreshNeeds(status),
            summary: 'N限定削除が指定されていますが、Nカードがありません。'
        };
    }

    const ranked = filteredDeck
        .map((card) => {
            const reasonTags = [];
            const keepScore = difficulty === 'pro'
                ? scoreProKeepValue(card, { difficulty, turn, status, profile: strategyProfile }, reasonTags)
                : scoreFreshKeepValue(card, { difficulty, turn, status }, reasonTags);

            return {
                cardName: card.cardName,
                category: card.category,
                rarity: card.rarity,
                keepScore,
                deletePriority: -keepScore,
                reasonTags
            };
        })
        .sort((a, b) => a.keepScore - b.keepScore);

    const picks = ranked.slice(0, Math.min(deleteMax, ranked.length));
    const needs = difficulty === 'pro' ? buildProNeeds(status) : buildFreshNeeds(status);

    return {
        recommendedDeleteCardNames: picks.map((x) => x.cardName),
        ranking: ranked,
        needsSnapshot: needs,
        summary: buildSummary(picks[0], difficulty, deletePolicy)
    };
}

export function recommendDeleteCardName(input = {}) {
    const result = recommendDeleteCards({ ...input, deleteMax: 1 });
    return result.recommendedDeleteCardNames[0] || null;
}

export function explainDeleteChoice(input = {}) {
    const result = recommendDeleteCards({ ...input, deleteMax: Math.max(1, safeInt(input.deleteMax || 1)) });
    const top = result.ranking[0];
    if (!top) return '削除候補がありません。';

    const tagLabel = {
        exp: '体験目標に対して優先度が低い',
        diff: '入退差目標に対して優先度が低い',
        acc: '経理目標に対して優先度が低い',
        sat: '満足目標に対して優先度が低い',
        withdrawal: '退塾抑制には残す価値がある',
        risk: '支障カードでリスクが高い'
    };

    const reasons = top.reasonTags
        .map((tag) => tagLabel[tag])
        .filter(Boolean)
        .filter((v, i, arr) => arr.indexOf(v) === i);

    const categoryName = CATEGORY_LABELS[top.category] || top.category || '不明カテゴリ';
    const reasonText = reasons.length > 0 ? reasons.join('、') : '総合的に保持価値が低い';
    return `${top.cardName} を削除候補として推奨。カテゴリ: ${categoryName}。理由: ${reasonText}。`;
}

if (typeof window !== 'undefined') {
    window.cdgAssist = Object.assign({}, window.cdgAssist || {}, {
        recommendDeleteCards,
        recommendDeleteCardName,
        explainDeleteChoice
    });
}
