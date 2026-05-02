function formatNum(value, digits = 3) {
    if (typeof value !== 'number' || Number.isNaN(value)) return '-';
    return value.toFixed(digits);
}

function formatPct(value, digits = 1) {
    if (typeof value !== 'number' || Number.isNaN(value)) return '-';
    return `${(value * 100).toFixed(digits)}%`;
}

function rankOrderValue(rank) {
    const order = [
        'F', 'E', 'D', 'C', 'B', 'B+', 'A', 'A+', 'S', 'S+', 'SS'
    ];
    const idx = order.indexOf(rank);
    return idx >= 0 ? idx : 999;
}

function sortRankEntries(rankDist) {
    const entries = Object.entries(rankDist || {});
    return entries.sort((a, b) => rankOrderValue(a[0]) - rankOrderValue(b[0]));
}

function getScoreTargets(difficulty, sim = null, settings = null) {
    if (sim?.scoreTargets) return sim.scoreTargets;
    if (settings?.scoreTargets) return settings.scoreTargets;
    if (difficulty === 'pro') {
        return { aPoints: 8, sClearPoints: 12, aPlusPoints: 10, sPlusPoints: 14 };
    }
    return { aPoints: 7, sClearPoints: 8, aPlusPoints: 7, sPlusPoints: 9 };
}

function policySummaryLine(sim, targets) {
    const s = sim.scoreSummary || {};
    const m = sim.milestones || {};
    const label = sim.effectivePolicy && sim.effectivePolicy !== sim.policy
        ? `${sim.policy} -> ${sim.effectivePolicy}`
        : sim.policy;
    return `${label}: A率(>=${targets.aPoints}pt) ${formatPct(m.aRate)}, S達成率(>=${targets.sClearPoints}pt) ${formatPct(m.sClearRate)} (50%まで ${formatPct(m.sClearGapTo50)}), A+率(>=${targets.aPlusPoints}pt) ${formatPct(m.aPlusRate)}, S+率(>=${targets.sPlusPoints}pt) ${formatPct(m.sPlusRate)}, S達成時満足>15 ${formatPct(m.satOver15GivenSClearRate)}, 平均 ${formatNum(s.mean)}`;
}

export function buildNaturalLanguageReport(payload) {
    const lines = [];
    const generatedAt = payload?.generatedAt || new Date().toISOString();
    const settings = payload?.settings || {};
    const simulations = Array.isArray(payload?.simulations) ? payload.simulations : [];

    lines.push('# 自律プレイ評価レポート');
    lines.push('');
    lines.push(`- 生成日時: ${generatedAt}`);
    lines.push(`- 難易度: ${settings.difficulty || '-'}`);
    lines.push(`- 試行回数: ${settings.episodes ?? '-'}`);
    lines.push(`- 比較ポリシー: ${(settings.policies || []).join(', ') || '-'}`);
    lines.push('');

    if (simulations.length === 0) {
        lines.push('シミュレーション結果が空です。');
        lines.push('');
        return `${lines.join('\n')}\n`;
    }

    const sortedByTarget = [...simulations].sort((a, b) => {
        const aRate = a?.milestones?.sClearRate ?? -Infinity;
        const bRate = b?.milestones?.sClearRate ?? -Infinity;
        if (bRate !== aRate) return bRate - aRate;
        return (b.scoreSummary?.mean ?? -Infinity) - (a.scoreSummary?.mean ?? -Infinity);
    });
    const best = sortedByTarget[0];
    const worst = sortedByTarget[sortedByTarget.length - 1];
    const sClearGap = (best?.milestones?.sClearRate ?? 0) - (worst?.milestones?.sClearRate ?? 0);
    const globalTargets = getScoreTargets(settings.difficulty, best, settings);

    lines.push('## 総評');
    lines.push('');
    lines.push(`目標指標（${globalTargets.sClearPoints}pt以上）で最良なのは **${best.policy}** で、S達成率は ${formatPct(best?.milestones?.sClearRate)} です。`);
    const bestGapTo50 = best?.milestones?.sClearGapTo50 ?? 0;
    if (bestGapTo50 <= 0) {
        lines.push('目標の **S達成率50%** は達成済みです。');
    } else {
        lines.push(`目標の **S達成率50%** までは残り ${formatPct(bestGapTo50)} です。`);
    }
    if (sortedByTarget.length >= 2) {
        lines.push(`最下位との差は ${formatPct(sClearGap)} です。`);
        if (sClearGap >= 0.08) {
            lines.push('戦略差は大きく、方略選択がS到達率を明確に左右しています。');
        } else {
            lines.push('戦略差は中程度で、さらなるチューニング余地があります。');
        }
    }
    lines.push('');

    lines.push('## ポリシー比較');
    lines.push('');
    lines.push(`| Policy | A率(>=${globalTargets.aPoints}pt) | S達成率(>=${globalTargets.sClearPoints}pt) | 50%ギャップ | A+率(>=${globalTargets.aPlusPoints}pt) | S+率(>=${globalTargets.sPlusPoints}pt) | S達成時満足>15率 | Mean | P50 | P90 |`);
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    sortedByTarget.forEach((sim) => {
        const s = sim.scoreSummary || {};
        const m = sim.milestones || {};
        const label = sim.effectivePolicy && sim.effectivePolicy !== sim.policy
            ? `${sim.policy} -> ${sim.effectivePolicy}`
            : sim.policy;
        lines.push(`| ${label} | ${formatPct(m.aRate)} | ${formatPct(m.sClearRate)} | ${formatPct(m.sClearGapTo50)} | ${formatPct(m.aPlusRate)} | ${formatPct(m.sPlusRate)} | ${formatPct(m.satOver15GivenSClearRate)} | ${formatNum(s.mean)} | ${formatNum(s.p50)} | ${formatNum(s.p90)} |`);
    });
    lines.push('');

    lines.push('## 主要インサイト');
    lines.push('');
    lines.push(`- ${policySummaryLine(best, getScoreTargets(settings.difficulty, best, settings))}`);
    if (sortedByTarget.length > 1) {
        lines.push(`- ${policySummaryLine(sortedByTarget[1], getScoreTargets(settings.difficulty, sortedByTarget[1], settings))}`);
    }
    if (sortedByTarget.length > 2) {
        lines.push(`- ${policySummaryLine(sortedByTarget[2], getScoreTargets(settings.difficulty, sortedByTarget[2], settings))}`);
    }
    lines.push('');

    sortedByTarget.forEach((sim) => {
        const s = sim.scoreSummary || {};
        const rankEntries = sortRankEntries(sim.rankDist);
        const topCards = (sim.topCards || []).slice(0, 10);
        const minPlays = Math.max(3, Math.floor((sim.episodes || 0) * 0.1));
        const stableCards = topCards.filter((c) => (c.plays || 0) >= minPlays);

        const label = sim.effectivePolicy && sim.effectivePolicy !== sim.policy
            ? `${sim.policy} -> ${sim.effectivePolicy}`
            : sim.policy;
        lines.push(`## 詳細: ${label}`);
        lines.push('');
        lines.push(`- 平均 ${formatNum(s.mean)}, p90 ${formatNum(s.p90)}, 最小 ${formatNum(s.min)}, 最大 ${formatNum(s.max)}`);

        if (rankEntries.length > 0) {
            const rankText = rankEntries
                .map(([rank, count]) => `${rank}:${count}`)
                .join(' / ');
            lines.push(`- ランク分布: ${rankText}`);
        } else {
            lines.push('- ランク分布: 取得なし');
        }

        const m = sim.milestones || {};
        const fs = sim.finalStatusAverages || {};
        const fe = sim.finalExcessAverages || {};
        const dt = sim.decisionTelemetry || {};
        const targets = getScoreTargets(settings.difficulty, sim, settings);
        lines.push(`- 最終ステータス平均: 体験 ${formatNum(fs.experience, 2)} / 入塾 ${formatNum(fs.enrollment, 2)} / 満足 ${formatNum(fs.satisfaction, 2)} / 経理 ${formatNum(fs.accounting, 2)}`);
        if (Object.keys(fe).length > 0) {
            lines.push(`- 過剰平均: 満足超過(>15) ${formatNum(fe.satisfactionExcess, 2)} / 経理超過(>15) ${formatNum(fe.accountingExcess, 2)}`);
        }
        if (Object.keys(m).length > 0) {
            lines.push(`- 目標達成率: A率(>=${targets.aPoints}pt) ${formatPct(m.aRate)} / A厳密 ${formatPct(m.aStrictRate)} / ${targets.sClearPoints}pt以上 ${formatPct(m.sClearRate)} / 50%ギャップ ${formatPct(m.sClearGapTo50)} / A+率(>=${targets.aPlusPoints}pt) ${formatPct(m.aPlusRate)} / A+厳密 ${formatPct(m.aPlusStrictRate)} / S+率(>=${targets.sPlusPoints}pt) ${formatPct(m.sPlusRate)} / S達成時満足>15 ${formatPct(m.satOver15GivenSClearRate)} / S達成時満足<=15 ${formatPct(m.sClearSatControlledRate)} / 体験12+ ${formatPct(m.exp12Rate)} / 体験25+ ${formatPct(m.exp25Rate)} / 体験40+ ${formatPct(m.exp40Rate)} / 入退差12+ ${formatPct(m.diff12Rate)} / 入退差20+ ${formatPct(m.diff20Rate)} / 入退差32+ ${formatPct(m.diff32Rate)} / 退塾1以下 ${formatPct(m.lowWithdrawalRate)} / 満足>15 ${formatPct(m.satOver15Rate)} / 満足25+ ${formatPct(m.sat25Rate)} / S+近似 ${formatPct(m.sPlusLikeRate)}`);
        }
        if (dt.training || dt.action || dt.meeting) {
            lines.push(`- 選択肢観測: 研修 平均候補 ${formatNum(dt?.training?.avgCandidatesPerRound ?? 0, 2)} / リフレッシュ使用 ${dt?.training?.refreshUsed ?? 0} (初回${dt?.training?.refreshByPhase?.initial ?? 0}, 通常${dt?.training?.refreshByPhase?.main ?? 0}, 発想${dt?.training?.refreshByPhase?.inspiration ?? 0}) / 行動 平均合法手 ${formatNum(dt?.action?.avgOptionsPerPhase ?? 0, 2)} / 並行配置率 ${formatPct(dt?.action?.parallelPlacementRate ?? 0)} / 会議 平均削除 ${formatNum(dt?.meeting?.avgDeletedPerPhase ?? 0, 2)}`);
        }

        lines.push('');
        lines.push('主力カード（プレイ回数が十分なもの）:');
        lines.push('');
        lines.push('| カード | Plays | 同伴平均スコア | 平均寄与(体験/入塾/満足/経理) |');
        lines.push('|---|---:|---:|---|');

        const cardRows = (stableCards.length > 0 ? stableCards : topCards).slice(0, 6);
        if (cardRows.length === 0) {
            lines.push('| (データなし) | - | - | - |');
        } else {
            cardRows.forEach((card) => {
                const d = card.avgDelta || {};
                const deltaText = `${formatNum(d.experience, 2)}/${formatNum(d.enrollment, 2)}/${formatNum(d.satisfaction, 2)}/${formatNum(d.accounting, 2)}`;
                lines.push(`| ${card.cardName} | ${card.plays} | ${formatNum(card.avgEpisodeScoreWhenPlayed)} | ${deltaText} |`);
            });
        }

        lines.push('');
        lines.push('短評:');
        if (cardRows.length > 0) {
            const bestCard = cardRows[0];
            lines.push(`- 最頻出カードは「${bestCard.cardName}」で、採用時の平均スコアは ${formatNum(bestCard.avgEpisodeScoreWhenPlayed)}。`);
        }
        if ((s.min ?? 0) < 0) {
            lines.push('- 下振れ時はマイナススコア域に入るため、会議フェーズの削除判断と経理/満足の維持が安定化の鍵。');
        } else {
            lines.push('- 最低スコアが0以上で、安定した運用ができています。');
        }
        const sPlus = sim.sPlusHoldings || {};
        const sPlusCards = (sPlus.topCards || []).slice(0, 10);
        const low = sim.lowHoldings || {};
        const lowCards = (low.topCards || []).slice(0, 10);
        const rarityRows = (sPlus.rarityBalance || [])
            .slice()
            .sort((a, b) => {
                const order = ['N', 'R', 'SR', 'SSR', 'T'];
                const ai = order.indexOf(a.key);
                const bi = order.indexOf(b.key);
                return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
            });
        const lowRarityRows = (low.rarityBalance || [])
            .slice()
            .sort((a, b) => {
                const order = ['N', 'R', 'SR', 'SSR', 'T'];
                const ai = order.indexOf(a.key);
                const bi = order.indexOf(b.key);
                return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
            });

        lines.push('');
        lines.push(`S+達成時(${targets.sPlusPoints}点以上)の所持カードランキング:`);
        lines.push('');
        lines.push(`- S+達成エピソード: ${sPlus.episodes || 0} / ${sim.episodes || 0} (${formatPct(sPlus.rate)})`);
        lines.push(`- S+時平均スコア: ${formatNum(sPlus.averageDisplayScore)} / 平均所持枚数: ${formatNum(sPlus.averageHeldCards, 2)}`);
        lines.push('');
        lines.push('| カード | レア | カテゴリ | 所持枚数 | 出現EP率 | 出現時平均所持枚数 |');
        lines.push('|---|---|---|---:|---:|---:|');
        if (sPlusCards.length === 0) {
            lines.push('| (データなし) | - | - | - | - | - |');
        } else {
            sPlusCards.forEach((card) => {
                lines.push(`| ${card.cardName} | ${card.rarity || '-'} | ${card.category || '-'} | ${card.heldCount} | ${formatPct(card.presentRate)} | ${formatNum(card.avgCopiesWhenPresent, 2)} |`);
            });
        }

        lines.push('');
        lines.push('レアリティ別バランス（S+所持シェア vs プール供給シェア）:');
        lines.push('');
        lines.push('| レア | S+所持枚数 | S+シェア | 供給シェア | リフト |');
        lines.push('|---|---:|---:|---:|---:|');
        if (rarityRows.length === 0) {
            lines.push('| (データなし) | - | - | - | - |');
        } else {
            rarityRows.forEach((row) => {
                lines.push(`| ${row.key} | ${row.observed} | ${formatPct(row.observedShare)} | ${formatPct(row.baselineShare)} | ${row.lift === null ? '-' : formatNum(row.lift, 2)} |`);
            });
        }
        lines.push('');

        lines.push('低得点時(<=0点)の所持カードランキング:');
        lines.push('');
        lines.push(`- 低得点エピソード: ${low.episodes || 0} / ${sim.episodes || 0} (${formatPct(low.rate)})`);
        lines.push(`- 低得点時平均スコア: ${formatNum(low.averageDisplayScore)} / 平均所持枚数: ${formatNum(low.averageHeldCards, 2)}`);
        lines.push('');
        lines.push('| カード | レア | カテゴリ | 所持枚数 | 出現EP率 | 出現時平均所持枚数 |');
        lines.push('|---|---|---|---:|---:|---:|');
        if (lowCards.length === 0) {
            lines.push('| (データなし) | - | - | - | - | - |');
        } else {
            lowCards.forEach((card) => {
                lines.push(`| ${card.cardName} | ${card.rarity || '-'} | ${card.category || '-'} | ${card.heldCount} | ${formatPct(card.presentRate)} | ${formatNum(card.avgCopiesWhenPresent, 2)} |`);
            });
        }
        lines.push('');
        lines.push('レアリティ別バランス（低得点所持シェア vs プール供給シェア）:');
        lines.push('');
        lines.push('| レア | 低得点所持枚数 | 低得点シェア | 供給シェア | リフト |');
        lines.push('|---|---:|---:|---:|---:|');
        if (lowRarityRows.length === 0) {
            lines.push('| (データなし) | - | - | - | - |');
        } else {
            lowRarityRows.forEach((row) => {
                lines.push(`| ${row.key} | ${row.observed} | ${formatPct(row.observedShare)} | ${formatPct(row.baselineShare)} | ${row.lift === null ? '-' : formatNum(row.lift, 2)} |`);
            });
        }
        lines.push('');
    });

    const sortedByAPlus = [...simulations].sort((a, b) => {
        const am = a?.milestones?.aPlusRate ?? -Infinity;
        const bm = b?.milestones?.aPlusRate ?? -Infinity;
        if (bm !== am) return bm - am;
        return (b.scoreSummary?.mean ?? -Infinity) - (a.scoreSummary?.mean ?? -Infinity);
    });
    const bestAPlus = sortedByAPlus[0];
    lines.push('## 安定/上振れ比較');
    lines.push('');
    if (best && bestAPlus) {
        lines.push(`- S達成率トップ: **${best.policy}** (${formatPct(best?.milestones?.sClearRate)})`);
        lines.push(`- A+率トップ: **${bestAPlus.policy}** (${formatPct(bestAPlus?.milestones?.aPlusRate)})`);
    }
    if (settings.difficulty === 'pro') {
        lines.push('- 解釈: A+率は `score.points>=10` を採用。A+厳密はランク表記ベース（A+/S/S+）を併記。');
    } else {
        lines.push('- 解釈: A+率は `displayScore>=7` を採用。A+厳密はランク表記ベース（A+/S/S+）を併記。');
    }
    lines.push('');

    const hasFreshStrategy = simulations.some((sim) => ['fresh_adaptive', 'deep_beam', 'deep_beam_satcap', 'fresh_rule_nonly', 'fresh_s50', 'fresh_stable', 'fresh_stable_classic', 'fresh_stable_push', 'fresh_upside'].includes(sim.policy));
    const hasProStrategy = simulations.some((sim) => ['pro_foundation', 'pro_stable', 'pro_adaptive', 'pro_smax', 'pro_hybrid', 'pro_upside', 'pro_strategic1', 'pro_strategic1_stable', 'pro_strategic1_upside', 'pro_compress', 'pro_expand'].includes(sim.policy));
    if (hasFreshStrategy) {
        lines.push('## FRESH攻略ロジック（実装方針）');
        lines.push('');
        lines.push('- 取得戦略: 体験不足時は動員、入退差不足時は教務、退塾リスク時は庶務/応対の評価を強める。');
        lines.push('- 配置戦略: 先読み幅を拡張したビーム探索で、FRESHの観点別得点(退塾/体験/入退差)に直結する進捗シグナルを重視。');
        lines.push('- 削除戦略: 低価値カード優先に加えて、満足過剰局面では応対カードを削除候補に寄せる。N限定削除方針も比較対象として継続評価。');
        lines.push('- 幅広い方略: `fresh_stable`（安定重視）と `fresh_upside`（上振れ重視）を追加し、S率/A+率のトレードオフを比較。');
        lines.push('- 目的: 「体験12+」「入退差12+」「退塾1以下」の同時達成確率を上げる。');
        lines.push('');
    }
    if (hasProStrategy) {
        lines.push('## PRO攻略ロジック（基盤）');
        lines.push('');
        lines.push('- 研修選択: 毎ラウンドで候補評価を行い、期待値差がある場合のみリフレッシュを実行。初回研修・通常研修・発想追加習得を同一ロジックで処理。');
        lines.push('- 配置選択: 合法配置（スタッフ制限/並行重ね置き）を列挙し、ビーム探索で手順を決定。');
        lines.push('- 削除選択: 削除上限内で「削除しない」も許容し、低価値カードのみ削除する保守的ルールを導入。');
        lines.push('- 観測: 研修候補数、リフレッシュ使用内訳、行動フェーズ合法手数、並行配置率、会議削除枚数をレポート。');
        lines.push('');
    }

    lines.push('## 次アクション案');
    lines.push('');
    lines.push('1. S達成率50%ギャップが最小のポリシーを固定し、終盤(ターン6-8)の教務/動員評価重みを微調整する。');
    lines.push('2. S+ランキング上位カードのレアリティ偏りを見て、取得時重み（SR/SSRボーナス、N削除優先）を調整する。');
    lines.push('3. 1200〜2000試行で再測定し、S+サンプル数を確保した上でカードランキングの安定性を確認する。');
    lines.push('');

    return `${lines.join('\n')}\n`;
}
