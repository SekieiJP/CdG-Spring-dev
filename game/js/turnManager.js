/**
 * TurnManager - ターン進行管理
 */
import { resolveCardAction } from './actionResolver.js?v=20261110-0066';
import { DEFAULT_TURNS } from './defaultRules.js?v=20261110-0066';
import { beginReplayAction, captureReplayAction, captureReplayBoundary, completeReplayTurn, bindReplayCardManager } from './replayRecorder.js?v=20261110-0066';

export class TurnManager {
    static TURN_CONFIG = DEFAULT_TURNS;

    constructor(gameState, cardManager, logger) {
        this.gameState = gameState;
        this.cardManager = cardManager;
        this.cardManager.gameState = gameState;
        bindReplayCardManager(gameState, cardManager);
        this.logger = logger;
    }

    /**
     * 現在のターン設定を取得
     */
    getCurrentTurnConfig() {
        return this.getTurnConfigs()[this.gameState.turn];
    }

    /**
     * 現在の削除上限を取得（整理トークン込み）
     */
    getCurrentDeleteMax() {
        const config = this.getCurrentTurnConfig();
        const customMax = this.gameState.config.rules.getDeleteMax?.(this.gameState, config);
        if (Number.isInteger(customMax)) return customMax;
        return config.delete + (this.gameState.tokens?.organize || 0);
    }

    getTrainingOfferConfig({ mode = this.gameState.trainingSelectionMode || 'normal' } = {}) {
        const customOffer = this.gameState.config.rules.getTrainingOfferConfig?.(this.gameState, mode);
        if (customOffer) return customOffer;
        const turn = this.getCurrentTurnConfig();
        if (!turn?.training) return null;
        if (mode === 'inspiration') return { rarity: 'SR', offerCount: 3, pickCount: 1, allowSkip: true };
        return { rarity: turn.training, offerCount: turn.offerCount ?? 3, pickCount: turn.pickCount ?? 1, allowSkip: false };
    }

    isOutingTurn() { return this.gameState.config.rules.isOutingTurn?.(this.gameState) === true; }

    getOutingConfig() { return this.gameState.config.rules.getOutingConfig?.(this.gameState) || null; }

    getActionValidationError() {
        return this.gameState.config.rules.getActionValidationError?.(this.gameState) || null;
    }

    getMeetingDeleteCandidates() {
        return this.gameState.config.rules.getDeleteCandidates?.(this.gameState, 'meeting') || [...this.gameState.player.deck];
    }

    getOutingDeleteCandidates() {
        return this.gameState.config.rules.getDeleteCandidates?.(this.gameState, 'outing') || this.getMeetingDeleteCandidates();
    }

    deleteMeetingCard(card) { return this.gameState.removeOwnedCard(card); }

    deleteOutingCard(card) {
        const outing = this.gameState.ruleState.int?.outing;
        if (this.gameState.phase !== 'outing' || outing?.stage !== 'delete') return false;
        if (!this.gameState.removeOwnedCard(card)) return false;
        const result = { deleted: card, acquired: outing.selectedCards || [outing.selectedCard].filter(Boolean) };
        this.completeOuting();
        return result;
    }

    beginOuting(placeId) {
        const config = this.getOutingConfig();
        const place = config?.outingOptions?.find(option => option.id === placeId);
        if (this.gameState.phase !== 'outing' || !place || this.gameState.ruleState.int?.outing) return null;
        const offer = { rarity: place.rarity, offerCount: place.offerCount, pickCount: place.pickCount, allowSkip: false };
        const candidates = this.cardManager.drawTrainingOffer(offer);
        if (candidates.length === 0) {
            if (place.id === 'bookstore') {
                this.gameState.ruleState.int.outing = { place: place.id, stage: 'delete', candidates: [], selectedCard: null,
                    selectedCards: [], pickCount: 0 };
                this.gameState.currentTrainingCards = null;
                return { place, stage: 'delete', candidates: [], deleteCount: 1,
                    deleteCandidates: this.getOutingDeleteCandidates() };
            }
            this.gameState.ruleState.int.outing = { place: place.id, stage: 'complete', candidates: [], selectedCard: null,
                selectedCards: [], pickCount: 0 };
            const nextPhase = this.completeOuting();
            return { place, stage: 'complete', candidates: [], nextPhase };
        }
        this.gameState.currentTrainingCards = candidates.map(card => ({ ...card }));
        this.gameState.ruleState.int.outing = { place: place.id, stage: 'card', candidates: this.gameState.currentTrainingCards,
            selectedCard: null, selectedCards: [] };
        this.gameState.record('outing', { place: place.id, rarity: place.rarity, cards: candidates.map(card => ({ cardNo: card.cardNo, cardName: card.cardName })) });
        return { place, stage: 'card', candidates: this.gameState.currentTrainingCards };
    }

    selectOutingCard(card) {
        const outing = this.gameState.ruleState.int?.outing;
        if (this.gameState.phase !== 'outing' || outing?.stage !== 'card') return null;
        const candidates = outing.candidates || [];
        const selected = candidates.find(candidate => candidate === card ||
            (card?.poolId && candidate.poolId === card.poolId) ||
            (!card?.poolId && candidate.cardNo === card?.cardNo && candidate.cardName === card?.cardName));
        if (!selected) return null;
        const place = this.getOutingConfig()?.outingOptions?.find(option => option.id === outing.place);
        if (!place) return null;
        outing.selectedCards ||= [];
        const selectedIndex = outing.selectedCards.findIndex(candidate => candidate === selected ||
            (candidate.poolId && candidate.poolId === selected.poolId));
        if (selectedIndex > -1) outing.selectedCards.splice(selectedIndex, 1);
        else if (outing.selectedCards.length < place.pickCount) outing.selectedCards.push(selected);
        return outing.selectedCards;
    }

    confirmOutingCards() {
        const outing = this.gameState.ruleState.int?.outing;
        if (this.gameState.phase !== 'outing' || outing?.stage !== 'card') return;
        const place = this.getOutingConfig()?.outingOptions?.find(option => option.id === outing.place);
        if (!place) return;
        const selectedCards = outing.selectedCards || [];
        const required = Math.min(place.pickCount, outing.candidates.length);
        if (selectedCards.length !== required) return;
        if (required === 0 && place.id !== 'bookstore') {
            this.completeOuting();
            return { stage: 'complete' };
        }
        outing.selectedCard = selectedCards[0] || null;
        this.gameState.currentTrainingCards = null;
        if (place.id === 'headquarters') {
            outing.stage = 'staff';
            return { stage: 'staff', selectedCard: outing.selectedCard, selectedCards, staffIds: this.gameState.slotIds };
        }
        selectedCards.forEach(selectedCard => this.gameState.addToDeck(selectedCard));
        if (place.id === 'bookstore') {
            outing.stage = 'delete';
            return { stage: 'delete', acquired: selectedCards, selectedCards, deleteCount: 1,
                deleteCandidates: this.getOutingDeleteCandidates() };
        }
        const result = { stage: 'complete', acquired: selectedCards, selectedCards };
        result.nextPhase = this.completeOuting();
        return result;
    }

    selectOutingStaff(staffId) {
        const outing = this.gameState.ruleState.int?.outing;
        if (this.gameState.phase !== 'outing' || outing?.stage !== 'staff' || !this.gameState.slotIds.includes(staffId)) return null;
        const card = this.gameState.identifyCard(outing.selectedCard);
        const action = this.resolveCardAction(card, staffId);
        const result = { stage: 'complete', selectedCard: card, staffId, action };
        result.nextPhase = this.completeOuting();
        return result;
    }

    completeOuting() {
        if (this.gameState.phase !== 'outing' || !this.gameState.ruleState.int?.outing) return null;
        this.gameState.ruleState.int.outing = null;
        this.gameState.currentTrainingCards = null;
        this.advancePhase();
        return this.gameState.phase;
    }

    /**
     * 全ターン設定を取得
     */
    getTurnConfigs() {
        return this.gameState.config.turns;
    }

    /**
     * フェーズを進める
     */
    advancePhase() {
        const currentPhase = this.gameState.phase;
        this.logger?.log(`[DEBUG] advancePhase呼び出し: currentPhase=${currentPhase}`, 'info');
        globalThis.window?.CDG_DEBUG && console.log('[DEBUG] advancePhase: currentPhase=', currentPhase);

        if (currentPhase === 'start') {
            this.gameState.phase = 'training';
            this.logger?.log('[DEBUG] start→training遷移', 'info');
            this.startTrainingPhase();
        } else if (currentPhase === 'training') {
            this.gameState.phase = 'action';
            this.logger?.log('[DEBUG] training→action遷移、startActionPhaseを呼び出し', 'info');
            globalThis.window?.CDG_DEBUG && console.log('[DEBUG] training→action遷移、startActionPhaseを呼び出し');
            this.startActionPhase();
        } else if (currentPhase === 'action') {
            this.gameState.pendingAction = null;
            this.gameState.config.rules.finishAction?.(this.gameState, this.cardManager);
            const maxDelete = this.getCurrentDeleteMax();
            const finalTurn = this.gameState.config.rules.isFinalTurn?.(this.gameState) ??
                this.gameState.turn === this.gameState.totalTurns - 1;
            const skipFinalDeletion = this.gameState.config.rules.skipFinalDeletion?.(this.gameState) ?? true;
            // 最終ターンは会議削除を省略。それ以外は削除上限がある日に開く
            if (maxDelete === 0 || (finalTurn && skipFinalDeletion)) {
                this.logger?.log('[DEBUG] 会議フェーズをスキップして次ターンへ遷移', 'info');
                if (!this.gameState.config.rules.skipReturnAllToDeck?.(this.gameState)) this.gameState.returnAllToDeck();
                if (finalTurn) {
                    if (this.gameState.config.rules.resetFinalTokens) this.gameState.config.rules.resetFinalTokens(this.gameState);
                    else this.gameState.tokens.organize = 0;
                } else this.gameState.tokens.organize = 0;
                this.gameState.phase = 'meeting'; // 一時的にmeetingへ
                this.advancePhase(); // 即座に次のターンへ
            } else {
                this.gameState.phase = 'meeting';
                this.startMeetingPhase();
            }
        } else if (currentPhase === 'meeting') {
            this.advanceToNextTurn();
        } else if (currentPhase === 'outing') {
            if (this.gameState.ruleState.int?.outing) {
                this.logger?.log('行き先の処理を完了してから進めてください', 'warning');
                return;
            }
            this.advanceToNextTurn();
        } else {
            this.logger?.log(`[DEBUG] 未知のフェーズ: ${currentPhase}`, 'error');
            globalThis.window?.CDG_DEBUG && console.error('[DEBUG] 未知のフェーズ:', currentPhase);
        }
    }

    advanceToNextTurn() {
        completeReplayTurn(this.gameState);
        const previousTurn = this.gameState.turn;
        this.gameState.turn++;

        if (this.gameState.turn >= this.gameState.totalTurns) {
            this.gameState.phase = 'end';
            this.logger?.log(`ゲーム終了: ${this.gameState.totalTurns}ターン完了`, 'info');
            return;
        }

        const config = this.getCurrentTurnConfig();
        this.gameState.config.rules.beforeNextTurn?.(this.gameState, config, previousTurn);
        if (this.isOutingTurn()) {
            this.gameState.phase = 'outing';
            this.gameState.currentTrainingCards = null;
            this.logger?.log(`ターン${this.gameState.turn + 1}開始: ${config.name}（行き先選択）`, 'info');
            return;
        }
        this.gameState.phase = 'training';
        this.logger?.log(`ターン${this.gameState.turn + 1}開始: ${config.name}`, 'info');
        this.startTrainingPhase();
    }

    /**
     * 研修フェーズ開始
     */
    startTrainingPhase() {
        const config = this.getCurrentTurnConfig();
        const offer = this.getTrainingOfferConfig({ mode: 'normal' });
        if (offer) this.logger?.log(`研修フェーズ: ${offer.rarity}カード${offer.offerCount}枚から${offer.pickCount}枚を習得`, 'info');
    }

    /**
     * 教室行動フェーズ開始
     */
    startActionPhase() {
        this.logger?.log('教室行動フェーズ開始', 'info');
        globalThis.window?.CDG_DEBUG && console.log('[DEBUG] startActionPhase: 実行開始');
        globalThis.window?.CDG_DEBUG && console.log('[DEBUG] デッキ枚数（シャッフル前）:', this.gameState.player.deck.length);
        globalThis.window?.CDG_DEBUG && console.log('[DEBUG] 手札枚数（ドロー前）:', this.gameState.player.hand.length);

        if (!this.gameState.tokens) {
            this.gameState.tokens = { passion: 0, inspiration: 0, organize: 0, fatigue: 0 };
        }
        if (this.gameState.config.rules.prepareActionPhase?.(this.gameState, this) === true) {
            captureReplayBoundary(this.gameState, 'action-start');
            return;
        }

        // 情熱・疲労トークン消費
        const passion = this.gameState.tokens.passion || 0;
        const fatigue = this.gameState.tokens.fatigue || 0;
        const drawCount = Math.max(0, 4 + passion - fatigue);
        if (passion > 0) {
            this.logger?.log(`✊情熱発動: ドロー+${passion} → ${drawCount}枚`, 'action');
            this.gameState.tokens.passion = 0;
        }
        if (fatigue > 0) {
            this.logger?.log(`💤疲労発動: ドロー-${fatigue} → ${drawCount}枚`, 'action');
            this.gameState.tokens.fatigue = 0;
        }

        // 次回の行動フェーズ表示時に、ドロー変動通知を出すための一時情報
        if (passion > 0 || fatigue > 0) {
            this.gameState.lastDrawNotification = { passion, fatigue, drawCount };
        } else {
            this.gameState.lastDrawNotification = null;
        }

        // デッキをシャッフル
        this.gameState.shuffleDeck();
        globalThis.window?.CDG_DEBUG && console.log('[DEBUG] デッキシャッフル完了');

        // 手札を引く
        this.gameState.drawCards(drawCount);
        captureReplayBoundary(this.gameState, 'action-start');
        globalThis.window?.CDG_DEBUG && console.log(`[DEBUG] 手札を${drawCount}枚引いた後の手札枚数:`, this.gameState.player.hand.length);
        globalThis.window?.CDG_DEBUG && console.log('[DEBUG] 手札内容:', this.gameState.player.hand);
    }

    /**
     * 教室会議フェーズ開始
     */
    startMeetingPhase() {
        const organizeBonus = this.gameState.tokens?.organize || 0;
        if (organizeBonus > 0) {
            this.logger?.log(`🗑️整理発動: 削除上限+${organizeBonus}`, 'action');
            // トークンはUIが削除処理完了後にリセット
        }
        this.logger?.log('教室会議フェーズ開始', 'info');

        // 全カードをデッキに戻す
        if (this.gameState.config.rules.startMeetingPhase?.(this.gameState, this) !== true) this.gameState.returnAllToDeck();
        captureReplayBoundary(this.gameState, 'meeting-start');
    }

    /**
     * アクション実行
     * @returns {Object} 各カードの効果情報
     */
    executeActions() {
        if (this.gameState.pendingAction?.turn === this.gameState.turn) return this.gameState.pendingAction.actionInfo;
        beginReplayAction(this.gameState);
        this.gameState.config.rules.beforeAction?.(this.gameState, this.cardManager);
        const placed = this.gameState.player.placed;
        const actionInfo = {
            cardEffects: {} // staff -> { beforeStats, afterStats, isRecommended, cards }
        };

        this.logger?.log('--- アクション実行開始 ---', 'info');

        // 各スタッフのカード効果を実行（おすすめボーナスも含めて記録）
        const staffOrder = this.gameState.slotIds;
        staffOrder.forEach(staff => {
            const cards = Array.isArray(placed[staff]) ? placed[staff] : (placed[staff] ? [placed[staff]] : []);
            if (cards.length > 0) {
                const staffBeforeStats = {
                    experience: this.gameState.player.experience,
                    enrollment: this.gameState.player.enrollment,
                    satisfaction: this.gameState.player.satisfaction,
                    accounting: this.gameState.player.accounting
                };

                let recommendedApplied = false;
                const perCard = [];

                cards.forEach(card => {
                    const resolved = this.resolveCardAction(card, staff);
                    recommendedApplied ||= resolved.recommendedApplied;
                    perCard.push(resolved);
                });

                const staffAfterStats = {
                    experience: this.gameState.player.experience,
                    enrollment: this.gameState.player.enrollment,
                    satisfaction: this.gameState.player.satisfaction,
                    accounting: this.gameState.player.accounting
                };

                actionInfo.cardEffects[staff] = {
                    beforeStats: staffBeforeStats,
                    afterStats: staffAfterStats,
                    isRecommended: recommendedApplied,
                    cards: perCard
                };
            }
        });

        this.logger?.log('--- アクション実行完了 ---', 'info');
        // アイテム条件に用いるのは、実際に有効解決されたカードだけ。
        const usage = {};
        Object.values(actionInfo.cardEffects).forEach(info => info.cards.forEach(card => {
            if (!card.applied) return;
            const category = card.category;
            if (category) usage[category] = (usage[category] || 0) + 1;
        }));
        this.gameState.eventCardUsage = usage;
        this.logger?.log(`イベント用有効カード枚数: ${JSON.stringify(usage)}`, 'info');
        this.gameState.config.rules.afterAction?.(this.gameState, actionInfo);
        this.gameState.pendingAction = { turn: this.gameState.turn, actionInfo };
        captureReplayAction(this.gameState, actionInfo);
        return actionInfo;
    }

    /** 本体とsolverが同じコスト・条件・おすすめ順序で1枚を解決する入口。 */
    resolveCardAction(card, staff, state = this.gameState) {
        const isSimulation = state !== this.gameState;
        const manager = isSimulation
            ? Object.assign(Object.create(this.cardManager), { logger: null, gameState: state,
                ...(this.gameState.config.rules.resolveCard ? {
                    trainingDecks: structuredClone(this.cardManager.trainingDecks),
                    trainingDiscards: structuredClone(this.cardManager.trainingDiscards)
                } : {}) })
            : this.cardManager;
        const resolver = this.gameState.config.rules.resolveCard || resolveCardAction;
        return resolver(manager, state, card, staff, this.getTurnConfigs()[state.turn], isSimulation ? null : this.logger);
    }

    createSimulationState() {
        const state = this.gameState;
        return Object.assign(Object.create(Object.getPrototypeOf(state)), state, {
            player: structuredClone(state.player), tokens: { ...state.tokens },
            ruleState: structuredClone(state.ruleState), pendingAction: null, logger: null, playRecord: null, replayRecord: null,
            rng: state.rng.constructor.restore(state.rng.snapshot())
        });
    }

    /**
     * おすすめ行動ボーナス計算
     */
    calculateRecommendedBonus(placedCards, recommendedCategory) {
        let count = 0;
        Object.values(placedCards).forEach(cards => {
            const list = Array.isArray(cards) ? cards : (cards ? [cards] : []);
            list.forEach(card => {
                if (card && card.category === recommendedCategory) {
                    count++;
                }
            });
        });
        return count;
    }

    /**
     * ゲーム初期化
     */
    initializeGame(options = {}) {
        this.gameState.reset(this.gameState.difficulty, options);

        // 研修候補プールを初期化（各カード2枚ずつ）
        this.cardManager.initTrainingPool();
        this.gameState.startRecording({ cardVersion: this.cardManager.dataVersion, rankVersion: this.cardManager.rankVersion,
            catalog: this.cardManager.allCards.map(card => ({ ...card })) });

        // 基本カード（N）を取得
        const basicCards = this.cardManager.getBasicCards();
        basicCards.forEach(card => {
            this.gameState.addToDeck(card);
        });

        this.logger?.log(`基本カード${basicCards.length}枚をデッキに追加`, 'info');

        const openingOffer = this.getTrainingOfferConfig({ mode: 'normal' });
        if (this.gameState.config.rules.getTrainingOfferConfig) {
            this.logger?.log(`ゲーム開始: ${openingOffer.rarity}カード${openingOffer.offerCount}枚から${openingOffer.pickCount}枚を選んでください`, 'info');
        } else {
            this.logger?.log('ゲーム開始: 初回研修でRカード4枚から2枚選択してください', 'info');
        }
    }
}
