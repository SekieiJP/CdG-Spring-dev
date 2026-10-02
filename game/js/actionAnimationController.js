import { AnimationClock } from './animationClock.js?v=20260815-0053';
/** 確定した解決結果を表示する。通常のカード効果はここでは再適用しない。 */
export class ActionAnimationController {
    constructor(ui) {
        this.ui = ui;
        this.gameState = ui.gameState;
        this.turnManager = ui.turnManager;
        this.scoreManager = ui.scoreManager;
        this.clock = new AnimationClock();
    }
    async showStatusAnimation(beforeStats, afterStats, actionInfo) {
        const overlay = document.getElementById('status-animation-overlay');
        const header = document.getElementById('animation-header');
        const cards = document.getElementById('animation-cards');

        if (!overlay || !header || !cards) {
            // 演出要素がなければスキップして次へ進む
            await this.ui.finishActionPhase();
            return;
        }

        let eventEffectsResolved = false;
        this.clock.start();
        cards.onclick = event => { if (event.target.closest('.animation-card-item')) this.clock.skipCard(); };
        const skipButton = document.getElementById('btn-animation-skip');
        if (skipButton) skipButton.onclick = () => this.clock.skipTurn();
        try {
            // 現在のステータス（リアルタイム更新用）
            const currentStats = { ...beforeStats };

            // ステータス表示を初期化
            this.updateAnimationStats(currentStats, {});

            // オーバーレイ表示
            overlay.classList.remove('hidden');
            header.innerHTML = '';
            cards.innerHTML = '';

            // 演出シーケンス
            const config = this.turnManager.getCurrentTurnConfig();
            const placed = this.gameState.player.placed;

            // ターン情報表示
            await this._sleep(300);
            header.innerHTML = `${this.gameState.turn + 1}/${this.gameState.totalTurns}ターン ${config.week}`;

            // おすすめ行動表示
            if (config.recommended) {
                await this._sleep(500);
                header.innerHTML += `<br>🎯 おすすめ行動: ${config.recommended}`;
                await this._sleep(800);
            }

            // カテゴリ色マップ（CSS変数と統一）
            const categoryColors = {
                '動員': '#3B82F6',  // --color-mobilization
                '教務': '#10B981',  // --color-teaching
                '庶務': '#EC4899',  // --color-affairs
                '応対': '#F97316'   // --color-response
            };

            // ステータス日本語名マップ
            const statusNames = {
                'experience': '体験',
                'enrollment': '入塾',
                'satisfaction': '満足',
                'accounting': '経理'
            };

            // 各カード効果をリアルタイムで表示
            const staffOrder = this.gameState.slotIds;
            const staffNames = this.gameState.staffNames;

            for (const staff of staffOrder) {
                const staffCards = placed[staff]; // 配列
                const cardEffectInfo = actionInfo?.cardEffects?.[staff];
                if (staffCards.length === 0 || !cardEffectInfo) continue;

                const statusName = statusNames[config.recommendedStatus] || config.recommendedStatus;
                for (let cardIdx = 0; cardIdx < staffCards.length; cardIdx += 1) {
                    this.clock.beginCard();
                    const card = staffCards[cardIdx];
                    const perCardInfo = cardEffectInfo.cards?.[cardIdx];
                    const categoryColor = categoryColors[card.category] || '#9CA3AF';
                    const categoryBadge = `<span style="background:${categoryColor};color:white;padding:1px 4px;border-radius:4px;font-size:0.7em;margin-left:4px;">${this.ui._escapeHTML(card.category)}</span>`;
                    const isRecommended = perCardInfo?.isRecommended || false;
                    const recommendedApplied = perCardInfo?.recommendedApplied || false;
                    const skippedByCost = perCardInfo?.skippedReason === 'cost_shortage';
                    const recommendedMark = isRecommended ? ' 🎯' : '';
                    const bonusText = recommendedApplied ? `<div class="anim-bonus-text">🎯 おすすめボーナス ${statusName}+1</div>` : '';
                    const skipText = skippedByCost ? '<div class="anim-skip-text">コスト不足のため効果なし</div>' : '';
                    const thumbnailHTML = this.ui.buildCardThumbnailHTML(card, 'anim-card-thumbnail');

                    cards.innerHTML = `
                        <div class="animation-card-item">
                            <div class="anim-card-copy">
                                <div class="anim-staff-name">${staffNames[staff]}${staffCards.length > 1 ? ` (${cardIdx + 1}/${staffCards.length})` : ''}</div>
                                <div class="anim-card-name">${this.ui._escapeHTML(card.cardName)}${categoryBadge}${recommendedMark}</div>
                                <div class="anim-card-effect">${this.ui._escapeHTML(card.effect)}</div>
                                ${bonusText}
                                ${skipText}
                            </div>
                            ${thumbnailHTML}
                        </div>
                    `;
                    this.ui.setupCardThumbnailFallback(cards);

                    if (perCardInfo) {
                        const beforeCardStats = { ...currentStats };
                        const delta = this.ui.calculateDelta(perCardInfo.beforeStats, perCardInfo.afterStats);
                        Object.entries(delta).forEach(([key, value]) => {
                            if (Object.prototype.hasOwnProperty.call(currentStats, key)) {
                                currentStats[key] += value;
                            }
                        });
                        this.updateAnimationStats(currentStats, delta, { skipRankDisplay: true });
                        await this.animateRankUpsIfNeeded(beforeCardStats, { ...currentStats });
                        await this._sleep(800);
                    } else {
                        await this._sleep(2000);
                    }
                }
            }

            // カード効果に続けて、同じ画面・同じ体裁で塾アイテム効果を表示する。
            await this.ui.resolveEventActionEffects({ overlay, header, cards, currentStats });
            eventEffectsResolved = true;

            // 演出終了（📊行動結果ステップを除去）
            await this._sleep(500);
        } finally {
            overlay.classList.add('hidden');
            this.clock.finish(); cards.onclick = null;
            await this.ui.finishActionPhase({ eventEffectsResolved });
        }
    }

    /**
     * 指定時間待機
     */
    _sleep(ms) {
        return this.clock.wait(ms);
    }

    /**
     * ランクバーを段階的にアニメーション
     */
    async _animateStatBar(containerId, statKey, fromValue, toValue, difficulty) {
        if (!this.scoreManager?.rankTable) return;

        const container = document.getElementById(containerId);
        if (!container) return;

        const fillElem = container.querySelector('.rank-progress-fill');
        const labelElem = container.querySelector('.rank-label');
        const deficitElem = container.querySelector('.rank-deficit');
        if (!fillElem) return;

        const updateDeficit = (rankInfo) => {
            if (!deficitElem || !rankInfo) return;
            if (rankInfo.deficit > 0) {
                deficitElem.textContent = `${rankInfo.targetGrade}まであと${rankInfo.deficit}`;
                deficitElem.classList.remove('hidden');
            } else {
                deficitElem.textContent = '';
                deficitElem.classList.add('hidden');
            }
        };

        const updateProgress = (rankInfo, value, withTransition = true) => {
            if (!rankInfo) return;
            const range = rankInfo.nextThreshold - rankInfo.startThreshold;
            const progress = range > 0
                ? Math.max(Math.min(((value - rankInfo.startThreshold) / range) * 100, 100), 0)
                : 100;
            fillElem.style.transition = withTransition ? 'width 0.35s ease' : 'none';
            fillElem.style.width = `${progress}%`;
        };

        let currentValue = fromValue;

        while (true) {
            const prevRank = this.scoreManager.getStatusRank(statKey, currentValue, difficulty);
            const finalRank = this.scoreManager.getStatusRank(statKey, toValue, difficulty);
            if (!prevRank || !finalRank) break;

            // 終点（nextThreshold）を跨ぐ場合のみ演出を行う
            const nextThr = prevRank.nextThreshold;
            const hasThresholdCrossing = Number.isFinite(nextThr) && currentValue < nextThr && toValue >= nextThr;
            if (!hasThresholdCrossing) {
                if (labelElem) labelElem.textContent = finalRank.grade;
                updateProgress(finalRank, toValue, true);
                await this._sleep(1000); // 跨ぎ1回分（550+50+400ms）と同程度の継続時間
                updateDeficit(finalRank);
                break;
            }

            // 終点を跨いだ: 100%へアニメーション
            fillElem.style.transition = 'width 0.35s ease';
            fillElem.style.width = '100%';
            await this._sleep(550); // 350ms遷移 + 200ms静止

            // 0%にリセット（瞬時）
            fillElem.style.transition = 'none';
            fillElem.style.width = '0%';

            // 次のランク閾値へ進める
            const nextThreshold = prevRank.nextThreshold;
            if (nextThreshold <= currentValue) break;
            currentValue = nextThreshold;

            const nextRank = this.scoreManager.getStatusRank(statKey, currentValue, difficulty);
            if (nextRank && labelElem) {
                labelElem.textContent = nextRank.grade;
            }

            await this._sleep(50); // transition: none を確定させる

            // 最終値がこのランクに収まるかチェック
            const afterNextRank = this.scoreManager.getStatusRank(statKey, toValue, difficulty);
            if (!afterNextRank || afterNextRank.grade === nextRank?.grade) {
                // 最後のランク → 最終値に対応するバー位置まで伸ばす
                if (afterNextRank && labelElem) {
                    labelElem.textContent = afterNextRank.grade;
                }
                updateProgress(afterNextRank, toValue, true);
                await this._sleep(400);
                updateDeficit(afterNextRank);
                break;
            }
            // まだランクアップが残っている → ループ継続
        }
    }

    /**
     * ランクアップが必要なステータスのバーを並列アニメーション
     */
    async animateRankUpsIfNeeded(prevStats, newStats) {
        const difficulty = this.gameState.difficulty || 'fresh';
        const statMap = {
            experience: 'exp',
            enrollment: 'enr',
            satisfaction: 'sat',
            accounting: 'acc'
        };

        await Promise.all(
            Object.entries(statMap).map(([statKey, id]) => this._animateStatBar(
                `anim-${id}-rank`,
                statKey,
                prevStats[statKey] ?? 0,
                newStats[statKey] ?? 0,
                difficulty
            ))
        );
    }

    /**
     * アニメーションステータス更新
     */
    updateAnimationStats(stats, delta, options = {}) {
        const statMap = {
            experience: 'exp',
            enrollment: 'enr',
            satisfaction: 'sat',
            accounting: 'acc'
        };

        Object.entries(statMap).forEach(([key, id]) => {
            const valueElem = document.getElementById(`anim-${id}-value`);
            const deltaElem = document.getElementById(`anim-${id}-delta`);

            if (valueElem) {
                valueElem.textContent = stats[key];
                if (delta[key] !== undefined && delta[key] !== 0) {
                    valueElem.classList.add('updating');
                    setTimeout(() => valueElem.classList.remove('updating'), 300);
                }
            }

            if (deltaElem) {
                const d = delta[key] || 0;
                if (d !== 0) {
                    deltaElem.textContent = d > 0 ? `+${d}` : `${d}`;
                    deltaElem.className = `anim-delta ${d > 0 ? 'positive' : 'negative'}`;
                } else {
                    deltaElem.textContent = '';
                    deltaElem.className = 'anim-delta';
                }
            }
        });

        if (!options.skipRankDisplay) {
            this.updateAnimationRankDisplay(stats);
        }
    }

    /**
     * アニメーション画面のランク表示を更新
     */
    updateAnimationRankDisplay(stats) {
        if (!this.scoreManager?.rankTable) return;
        const difficulty = this.gameState.difficulty || 'fresh';
        const statMap = {
            experience: 'exp',
            enrollment: 'enr',
            satisfaction: 'sat',
            accounting: 'acc'
        };

        Object.entries(statMap).forEach(([stat, id]) => {
            const container = document.getElementById(`anim-${id}-rank`);
            if (!container) return;

            const value = stats[stat] ?? 0;
            const rankInfo = this.scoreManager.getStatusRank(stat, value, difficulty);
            if (!rankInfo) return;

            const labelElem = container.querySelector('.rank-label');
            if (labelElem) labelElem.textContent = rankInfo.grade;

            const fillElem = container.querySelector('.rank-progress-fill');
            if (fillElem) {
                const range = rankInfo.nextThreshold - rankInfo.startThreshold;
                const progress = range > 0
                    ? Math.min(((value - rankInfo.startThreshold) / range) * 100, 100)
                    : 100;
                fillElem.style.width = `${progress}%`;
            }

            const deficitElem = container.querySelector('.rank-deficit');
            if (deficitElem) {
                if (rankInfo.deficit > 0) {
                    deficitElem.textContent = `${rankInfo.targetGrade}まであと${rankInfo.deficit}`;
                    deficitElem.classList.remove('hidden');
                } else {
                    deficitElem.textContent = '';
                    deficitElem.classList.add('hidden');
                }
            }
        });
    }

}
