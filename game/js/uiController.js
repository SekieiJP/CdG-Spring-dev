import { submitScore } from './scoreSubmitter.js?v=20260411-0900';

/**
 * UIController - UI操作・表示制御
 */
export class UIController {
    _escapeHTML(str) {
        if (typeof str !== 'string') return str;
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    constructor(gameState, cardManager, turnManager, scoreManager, logger, saveManager) {
        this.gameState = gameState;
        this.cardManager = cardManager;
        this.turnManager = turnManager;
        this.scoreManager = scoreManager;
        this.logger = logger;
        this.saveManager = saveManager;

        this.selectedTrainingCard = null;
        this.selectedCardsForDeletion = [];
        this.slotSelectionMode = false;       // スロット手動指定モード
        this.selectedCardForPlacement = null; // 手動指定時に選択中のカード
        this.tapMode = true; // タップ順配置モード
        this.trainingSelectionMode = 'normal'; // 'normal' | 'inspiration'
        this.inspirationRemaining = 0;
    }

    /**
     * UI初期化
     */
    init() {
        this.updateStatusDisplay();
        this.updateTurnDisplay();

        // 文字サイズモードを適用
        this.applyFontMode();
        this.applyCardDesc();

        // イベントリスナー設定
        this.setupEventListeners();

        // スクロール検知設定
        this.setupScrollListener();
    }

    /**
     * スクロール検知設定
     */
    setupScrollListener() {
        const stickyHeader = document.getElementById('sticky-header');
        const fullStatusPanel = document.getElementById('full-status-panel');

        if (!stickyHeader || !fullStatusPanel) return;

        window.addEventListener('scroll', () => {
            const panelRect = fullStatusPanel.getBoundingClientRect();
            // ステータスパネルが少しでも隠れたらコンパクトヘッダーを表示
            if (panelRect.top < 0) {
                stickyHeader.classList.remove('hidden');
            } else {
                stickyHeader.classList.add('hidden');
            }
        });
    }

    /**
     * イベントリスナー設定
     */
    setupEventListeners() {
        // スタートボタン
        const startBtn = document.getElementById('start-game');
        startBtn?.addEventListener('click', () => this.onStartGame());

        // 難易度選択ボタン
        document.querySelectorAll('.difficulty-btn').forEach(btn => {
            btn.addEventListener('click', () => this.onDifficultySelect(btn.dataset.difficulty));
        });

        // 初訪問者向けFRESH吹き出し表示
        const visited = localStorage.getItem('cdg_visited');
        if (!visited) {
            const tooltip = document.getElementById('fresh-tooltip');
            if (tooltip) tooltip.classList.remove('hidden');
        }

        // 研修確定ボタン
        const confirmTrainingBtn = document.getElementById('confirm-training');
        confirmTrainingBtn?.addEventListener('click', () => this.onConfirmTraining());
        const refreshTrainingBtn = document.getElementById('btn-training-refresh');
        refreshTrainingBtn?.addEventListener('click', () => this.onTrainingRefresh());

        // アクション実行ボタン
        const confirmActionBtn = document.getElementById('confirm-action');
        confirmActionBtn?.addEventListener('click', () => this.onConfirmAction());
        const btnSlotManual = document.getElementById('btn-slot-manual');
        btnSlotManual?.addEventListener('click', () => this.toggleSlotSelectionMode());

        // 会議確定ボタン
        const confirmMeetingBtn = document.getElementById('confirm-meeting');
        confirmMeetingBtn?.addEventListener('click', () => this.onConfirmMeeting());

        // リスタートボタン
        const restartBtn = document.getElementById('restart-game');
        restartBtn?.addEventListener('click', () => this.onRestart());

        // スコア共有ボタン
        const shareBtn = document.getElementById('share-score');
        shareBtn?.addEventListener('click', () => this.onShareScore());

        // 情報表示ボタン（デッキ内訳）
        ['btn-deck-full', 'btn-deck-compact'].forEach(id => {
            const btn = document.getElementById(id);
            btn?.addEventListener('click', () => this.showDeckOverlay());
        });

        // 情報表示ボタン（スケジュール一覧）
        ['btn-schedule-full', 'btn-schedule-compact'].forEach(id => {
            const btn = document.getElementById(id);
            btn?.addEventListener('click', () => this.showScheduleOverlay());
        });

        // 設定ボタン
        ['btn-settings-full', 'btn-settings-compact'].forEach(id => {
            const btn = document.getElementById(id);
            btn?.addEventListener('click', () => this.showSettingsOverlay());
        });
    }

    /**
     * 難易度選択
     * @param {string} difficultyId - 'fresh' or 'pro'
     */
    onDifficultySelect(difficultyId) {
        this.selectedDifficulty = difficultyId;

        // ボタンのselectedクラスを切り替え
        document.querySelectorAll('.difficulty-btn').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.difficulty === difficultyId);
        });
    }

    /**
     * 現在の文字サイズモードが「標準」かどうか
     */
    isNormalMode() {
        return (localStorage.getItem('cdg_font_mode') || 'normal') === 'normal';
    }

    isShortCardDesc() {
        return localStorage.getItem('cdg_card_desc') === 'short';
    }

    setCardDesc(mode) {
        localStorage.setItem('cdg_card_desc', mode);
        this.applyCardDesc();
    }

    applyCardDesc() {
        if (this.isShortCardDesc()) {
            document.documentElement.classList.add('card-desc-short');
        } else {
            document.documentElement.classList.remove('card-desc-short');
        }
    }

    /**
     * 文字サイズモードをbodyに適用
     */
    applyFontMode() {
        if (this.isNormalMode()) {
            document.documentElement.classList.add('font-normal');
        } else {
            document.documentElement.classList.remove('font-normal');
        }
    }

    /**
     * 文字サイズモードを設定
     * @param {string} mode - 'normal' または 'small'
     */
    setFontMode(mode) {
        localStorage.setItem('cdg_font_mode', mode);
        this.applyFontMode();
    }

    /**
     * ステータス表示更新
     */
    updateStatusDisplay() {
        const statuses = ['experience', 'enrollment', 'satisfaction', 'accounting'];
        statuses.forEach(status => {
            // フル表示
            const elem = document.getElementById(`status-${status}`);
            if (elem) {
                elem.textContent = this.gameState.player[status];
            }
            // コンパクト表示
            const compactElem = document.getElementById(`compact-${status}`);
            if (compactElem) {
                compactElem.textContent = this.gameState.player[status];
            }
        });

        // ランク表示更新
        this.updateRankDisplay();
    }

    /**
     * ステータスランク表示を更新
     */
    updateRankDisplay() {
        if (!this.scoreManager?.rankTable) return;

        const difficulty = this.gameState.difficulty || 'fresh';
        const statuses = ['experience', 'enrollment', 'satisfaction', 'accounting'];

        statuses.forEach(stat => {
            const value = this.gameState.player[stat];
            const rankInfo = this.scoreManager.getStatusRank(stat, value, difficulty);
            if (!rankInfo) return;

            const container = document.getElementById(`rank-info-${stat}`);
            if (!container) return;

            // ランクラベル（全4ステータス共通で表示）
            const labelElem = container.querySelector('.rank-label');
            if (labelElem) {
                labelElem.textContent = rankInfo.grade;
            }

            // プログレスバー
            const fillElem = container.querySelector('.rank-progress-fill');
            if (fillElem) {
                const range = rankInfo.nextThreshold - rankInfo.startThreshold;
                const progress = range > 0
                    ? Math.min(((value - rankInfo.startThreshold) / range) * 100, 100)
                    : 100;
                fillElem.style.width = `${progress}%`;
            }

            // あとN表示（「Xまであと Y」形式）
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

    /**
     * ターン・フェーズ表示更新
     */
    updateTurnDisplay() {
        const turnName = document.getElementById('turn-name');
        const phaseName = document.getElementById('phase-name');
        const compactTurn = document.getElementById('compact-turn');
        const compactPhase = document.getElementById('compact-phase');
        const compactRecommended = document.getElementById('compact-recommended');
        const recommendedCategory = document.getElementById('recommended-category');

        let turnText = '準備中';
        let recommendedText = '-';
        let recommended = null;

        if (this.gameState.turn < 8) {
            const config = this.turnManager.getCurrentTurnConfig();
            turnText = config.name;
            recommendedText = config.recommended || '-';
            recommended = config.recommended;
        }

        if (turnName) turnName.textContent = turnText;
        if (compactTurn) compactTurn.textContent = turnText;

        const phaseNames = {
            start: '準備中',
            training: '研修',
            action: '教室行動',
            meeting: '教室会議',
            end: '終了'
        };

        const phaseText = phaseNames[this.gameState.phase] || '-';
        if (phaseName) phaseName.textContent = phaseText;
        if (compactPhase) compactPhase.textContent = phaseText;
        if (compactRecommended) compactRecommended.textContent = recommendedText;

        // フルヘッダーにおすすめカテゴリを表示
        if (recommendedCategory) {
            if (recommended) {
                const categoryColors = {
                    '動員': '#3B82F6',
                    '教務': '#10B981',
                    '庶務': '#EC4899',
                    '応対': '#F97316'
                };
                const color = categoryColors[recommended] || '#9CA3AF';
                recommendedCategory.innerHTML = `<span style="background:${color};color:white;padding:2px 6px;border-radius:4px;font-size:0.75rem;">🎯${recommended}</span>`;
            } else {
                recommendedCategory.innerHTML = '';
            }
        }
    }

    /**
     * フェーズエリアの表示切り替え
     */
    showPhaseArea(phase) {
        const areas = ['training-area', 'action-area', 'meeting-area', 'result-area'];
        areas.forEach(areaId => {
            const elem = document.getElementById(areaId);
            if (elem) {
                elem.classList.toggle('hidden', areaId !== `${phase}-area`);
            }
        });
    }

    /**
     * カードHTML生成
     * @param {Object} card - カードデータ
     * @param {Object} options - オプション
     * @param {boolean} options.compact - コンパクトモード（3列表示時、topEffect表示）
     * @param {string} options.recommendedCategory - おすすめ行動カテゴリ（合致時🎯表示）
     */
    createCardElement(card, options = {}) {
        const cardDiv = document.createElement('div');
        cardDiv.className = 'card';
        if (options.draggable) {
            cardDiv.draggable = true;
            cardDiv.addEventListener('dragstart', (e) => this.onCardDragStart(e, card));
            cardDiv.addEventListener('dragend', (e) => this.onCardDragEnd(e));
        }

        if (options.clickable) {
            cardDiv.addEventListener('click', () => options.onClick(card, cardDiv));
        }

        // カテゴリ色クラス
        const categoryClass = `category-${this._escapeHTML(card.category)}`;

        // おすすめ行動合致チェック
        const isRecommended = options.recommendedCategory && card.category === options.recommendedCategory;
        const recommendedMark = isRecommended ? '🎯' : '';

        // 表示する効果テキスト
        // カード説明設定が短縮時のみcompactでtopEffectを使用
        const useCompact = options.compact && this.isShortCardDesc();
        const displayEffect = useCompact && card.topEffect ? card.topEffect : card.effect;

        cardDiv.innerHTML = `
            <div class="card-header">
                <span class="card-name">${this._escapeHTML(card.cardName)}</span>
            </div>
            <div class="card-meta">
                <span class="card-category-text ${categoryClass}">${this._escapeHTML(card.category)}</span>${recommendedMark}
                <span class="card-rarity rarity-${card.rarity}">${card.rarity}</span>
            </div>
            <div class="card-effect">${this._escapeHTML(displayEffect)}</div>
        `;

        // 長押しで詳細効果を表示（短縮表示時のみ）
        if (this.isShortCardDesc() && options.compact && card.topEffect && card.effect !== card.topEffect) {
            let pressTimer;
            cardDiv.addEventListener('touchstart', (e) => {
                pressTimer = setTimeout(() => {
                    this.showEffectTooltip(card, e);
                }, 500);
            });
            cardDiv.addEventListener('touchend', () => clearTimeout(pressTimer));
            cardDiv.addEventListener('touchmove', () => clearTimeout(pressTimer));
        }

        return cardDiv;
    }

    /**
     * 効果詳細ツールチップ表示
     */
    showEffectTooltip(card, event) {
        // 既存のツールチップを削除
        const existing = document.querySelector('.effect-tooltip');
        if (existing) existing.remove();

        const tooltip = document.createElement('div');
        tooltip.className = 'effect-tooltip';
        tooltip.innerHTML = `
            <div class="tooltip-title">${this._escapeHTML(card.cardName)}</div>
            <div class="tooltip-effect">${this._escapeHTML(card.effect)}</div>
            <div class="tooltip-close">タップで閉じる</div>
        `;
        tooltip.addEventListener('click', () => tooltip.remove());
        document.body.appendChild(tooltip);
    }

    /**
     * ゲーム開始
     */
    async onStartGame() {
        const difficulty = this.selectedDifficulty || 'fresh';

        // 難易度に応じたCSVを読み込み
        if (window.game) {
            const success = await window.game.setDifficulty(difficulty);
            if (!success) {
                // CSVが見つからない場合（PRO準備中など）
                alert(`${difficulty.toUpperCase()}難易度は現在準備中です。\nFRESH難易度でお楽しみください。`);
                // FRESHにフォールバック
                this.onDifficultySelect('fresh');
                await window.game.setDifficulty('fresh');
                return;
            }
        }

        const overlay = document.getElementById('start-overlay');
        overlay?.classList.add('hidden');

        this.gameState.difficulty = difficulty;
        this.turnManager.initializeGame();
        this.gameState.recordStartTime(); // initializeGame()のreset()より後に記録
        this.slotSelectionMode = false;
        this.selectedCardForPlacement = null;
        const btnSlotManual = document.getElementById('btn-slot-manual');
        if (btnSlotManual) {
            btnSlotManual.classList.remove('active');
            btnSlotManual.title = 'スロット手動指定: OFF（タップで自動配置）';
        }

        // Bug2修正: リスタート時もステータス表示をリセット
        this.updateStatusDisplay();
        this.updateTurnDisplay();

        // 初回研修（Rカード4枚から2枚選択）
        this.showInitialTraining();
    }

    /**
     * 初回研修表示
     */
    showInitialTraining() {
        window.CDG_DEBUG && console.log('[SAVE-DEBUG] showInitialTraining: 開始');

        // フェーズを設定（保存前に必要）
        this.gameState.phase = 'training';

        const trainingCards = this.cardManager.drawTrainingCards('R', 4);
        window.CDG_DEBUG && console.log('[SAVE-DEBUG] showInitialTraining: 抽選カード:', trainingCards.map(c => c.cardName));

        // 抽選したカードをgameStateに保存（復元時に使用）
        this.gameState.currentTrainingCards = trainingCards.map(c => ({ ...c }));

        // 抽選完了直後に保存（再抽選防止）
        this.saveGameState();

        this.renderTrainingCards(trainingCards);
    }

    /**
     * 研修カード描画（共通処理）
     */
    renderTrainingCards(trainingCards) {
        const container = document.getElementById('training-cards');
        if (!container) return;

        container.innerHTML = '';

        if (this.gameState.turn === 0) {
            // 初回研修（4枚から2枚）
            this.selectedInitialCards = [];
            trainingCards.forEach(card => {
                const cardElem = this.createCardElement(card, {
                    clickable: true,
                    compact: true,
                    onClick: (c, elem) => this.onInitialCardSelect(c, elem, trainingCards)
                });
                container.appendChild(cardElem);
            });
        } else {
            // 通常研修（3枚から1枚）
            this.selectedTrainingCard = null;
            // Spec2修正: 1枚選択するまで確定ボタンを無効化
            const confirmBtn = document.getElementById('confirm-training');
            if (confirmBtn) confirmBtn.disabled = true;
            trainingCards.forEach(card => {
                const cardElem = this.createCardElement(card, {
                    clickable: true,
                    compact: true,
                    onClick: (c, elem) => this.onTrainingCardSelect(c, elem, container)
                });
                container.appendChild(cardElem);
            });
        }

        this.showPhaseArea('training');
        this.updateTurnDisplay();
        this.updateStatusDisplay();
        this.renderTokenDisplay();

        const instruction = document.querySelector('#training-area .instruction');
        if (instruction) {
            const helpText = this.isShortCardDesc() ? '<span class="help-longpress">[長押しで詳細]</span>' : '';
            if (this.gameState.turn === 0) {
                instruction.innerHTML = `初回研修: 4枚から2枚を選んで習得してください${helpText}`;
            } else {
                instruction.innerHTML = `研修: 3枚から1枚を選んで習得してください${helpText}`;
            }
        }

        // リフレッシュボタン表示更新（初回研修含む）
        const rarity = this.gameState.turn === 0 ? 'R' : this.turnManager.getCurrentTurnConfig()?.training;
        this.updateTrainingRefreshUI(rarity);
    }

    /**
     * 初回カード選択
     */
    onInitialCardSelect(card, elem, allCards) {
        const index = this.selectedInitialCards.indexOf(card);

        if (index > -1) {
            // 選択解除
            this.selectedInitialCards.splice(index, 1);
            elem.classList.remove('selected');
        } else {
            // 選択
            if (this.selectedInitialCards.length < 2) {
                this.selectedInitialCards.push(card);
                elem.classList.add('selected');
            }
        }

        // 確定ボタン有効化
        const confirmBtn = document.getElementById('confirm-training');
        if (confirmBtn) {
            confirmBtn.disabled = this.selectedInitialCards.length !== 2;
        }
    }

    /**
     * 研修確定
     */
    onConfirmTraining() {
        window.CDG_DEBUG && console.log('[SAVE-DEBUG] onConfirmTraining: 開始, turn=', this.gameState.turn);

        // 発想追加習得モードの確定処理
        if (this.trainingSelectionMode === 'inspiration') {
            this.confirmInspirationTraining();
            return;
        }

        if (this.gameState.turn === 0 && this.selectedInitialCards) {
            // 初回研修
            this.selectedInitialCards.forEach(card => {
                this.gameState.addToDeck(card);
            });
        } else {
            // 通常研修
            if (this.selectedTrainingCard) {
                this.gameState.addToDeck(this.selectedTrainingCard);
                this.selectedTrainingCard = null;
            }

            // 発想トークンがあれば追加習得フローへ
            const inspiration = this.gameState.tokens?.inspiration ?? 0;
            if (inspiration > 0) {
                this.startInspirationTrainingFlow();
                return;
            }
        }

        // 研修カードをクリア（選択済み）
        this.gameState.currentTrainingCards = null;

        this.finalizeTrainingToAction();
    }

    /**
     * 教室行動フェーズ表示
     */
    showActionPhase() {
        this.showPhaseArea('action');
        this.updateTurnDisplay();
        this.updateStatusDisplay();

        // スタッフスロットをクリア（前ターンのカード表示を削除）
        this.clearStaffSlots();

        // 配置済み状態もクリア
        this.gameState.clearPlaced();

        // ドロー変動通知を表示
        this.renderDrawNotification();

        // トークン表示更新
        this.renderTokenDisplay();

        // ターンをまたいだ選択残りをクリア
        this.selectedCardForPlacement = null;

        // 手札表示
        this.renderHand();

        // スロット指定ボタンの状態を反映
        const btnSlotManual = document.getElementById('btn-slot-manual');
        if (btnSlotManual) {
            btnSlotManual.classList.toggle('active', this.slotSelectionMode);
            btnSlotManual.title = this.slotSelectionMode
                ? 'スロット手動指定: ON（カードを選んでからスロットをタップ）'
                : 'スロット手動指定: OFF（タップで自動配置）';
        }
        this.selectedCardForPlacement = null; // 念のため再クリア

        // スタッフスロットにドロップイベント設定
        this.setupDropZones();

        // ボタン状態を更新
        this.updateActionButtonState();
    }

    /**
     * ドロー変動通知を表示
     */
    renderDrawNotification() {
        const container = document.getElementById('draw-notification');
        if (!container) return;

        const notif = this.gameState.lastDrawNotification;
        if (!notif) {
            container.innerHTML = '';
            container.classList.add('hidden');
            this.gameState.lastDrawNotification = null;
            return;
        }

        const parts = [];
        if (notif.passion > 0) parts.push(`✊情熱 +${notif.passion}`);
        if (notif.fatigue > 0) parts.push(`💤疲労 -${notif.fatigue}`);

        container.innerHTML = `<span class="draw-notif-text">${parts.join(' / ')} → ${notif.drawCount}枚ドロー</span>`;
        container.classList.remove('hidden');
        this.gameState.lastDrawNotification = null;
    }

    /**
     * アクションフェーズのトークンチップ表示を更新する
     * 保有数が0より大きいトークンのみ表示する
     */
    renderTokenDisplay() {
        const containers = ['token-display', 'token-status-display']
            .map(id => document.getElementById(id))
            .filter(Boolean);
        if (containers.length === 0) return;

        const tokens = this.gameState.tokens ?? {};
        const tokenDefs = [
            { key: 'passion',     label: '情熱✊',  cls: 'token-passion'     },
            { key: 'inspiration', label: '発想💡',  cls: 'token-inspiration' },
            { key: 'organize',    label: '整理🗑️', cls: 'token-organize'    },
            { key: 'fatigue',     label: '疲労💤',  cls: 'token-fatigue'     },
        ];

        const chips = tokenDefs
            .filter(t => (tokens[t.key] ?? 0) > 0)
            .map(t => `<span class="token-chip ${t.cls}">${t.label} ×${tokens[t.key]}</span>`)
            .join('');

        containers.forEach(container => {
            if (chips) {
                container.innerHTML = chips;
                container.classList.remove('hidden');
            } else {
                container.innerHTML = '';
                container.classList.add('hidden');
            }
        });
    }

    /**
     * スタッフスロットのUIをクリア
     */
    clearStaffSlots() {
        const staffIds = ['slot-leader', 'slot-teacher', 'slot-staff'];
        staffIds.forEach(id => {
            const slot = document.getElementById(id);
            if (slot) {
                slot.innerHTML = '<span class="slot-placeholder">タップまたはドラッグ</span>';
                slot.classList.remove('filled');
            }
        });
    }

    /**
     * 手札表示
     */
    renderHand() {
        const handContainer = document.getElementById('hand-cards');
        if (!handContainer) return;

        handContainer.innerHTML = '';

        // 教室行動フェーズではおすすめカテゴリを取得
        const config = this.turnManager.getCurrentTurnConfig();
        const recommendedCategory = this.gameState.phase === 'action' ? config?.recommended : null;

        this.gameState.player.hand.forEach(card => {
            const cardElem = this.createCardElement(card, {
                draggable: true,
                clickable: true,
                compact: false,
                recommendedCategory: recommendedCategory,
                onClick: (c) => this.onHandCardTap(c)
            });
            if (this.slotSelectionMode && this.selectedCardForPlacement === card) {
                cardElem.classList.add('selected-for-placement');
            }
            handContainer.appendChild(cardElem);
        });
    }

    /**
     * 手札カードタップ（タップ順配置）
     */
    onHandCardTap(card) {
        if (this.slotSelectionMode) {
            if (this.selectedCardForPlacement === card) {
                // 同じカードを再タップ → 選択キャンセル
                this.selectedCardForPlacement = null;
            } else {
                // 別のカードをタップ → 選択切り替え
                this.selectedCardForPlacement = card;
            }
            this.renderHand(); // ハイライト更新
            return;
        }
        // 自動配置モード（既存挙動）
        const targetSlot = this.findBestSlot(card);
        if (targetSlot !== null) {
            this.tryPlaceCardToSlot(card, targetSlot);
        }
    }

    toggleSlotSelectionMode() {
        this.slotSelectionMode = !this.slotSelectionMode;
        this.selectedCardForPlacement = null;

        const btn = document.getElementById('btn-slot-manual');
        if (btn) {
            btn.classList.toggle('active', this.slotSelectionMode);
            btn.title = this.slotSelectionMode
                ? 'スロット手動指定: ON（カードを選んでからスロットをタップ）'
                : 'スロット手動指定: OFF（タップで自動配置）';
        }
        // 選択中ハイライトを解除
        this.renderHand();
    }

    /**
     * カードをスロットに配置を試みる（職種チェック付き）
     */
    tryPlaceCardToSlot(card, staff) {
        const staffNames = { leader: '室長', teacher: '講師', staff: '事務' };
        const currentStaffName = staffNames[staff];

        // 職種条件【】のチェック
        const allowedStaff = this.parseStaffRestriction(card.effect);
        if (allowedStaff && !allowedStaff.includes(currentStaffName)) {
            this.showFloatNotification(`このカードは ${allowedStaff.join('・')} 専用です`, 'error');
            return;
        }

        // 並行効果を持たないカードは埋まったスロットに配置できない
        if (!this.hasParallelEffect(card) && this.gameState.player.placed[staff].length > 0) {
            this.showFloatNotification('このカードは重ね配置できません', 'error');
            return;
        }

        // 条件付き効果〈〉のチェック（満たしていない場合のみ警告）
        const unmetConditions = this.checkUnmetConditions(card.effect, staff);
        if (unmetConditions.length > 0) {
            this.showFloatNotification(`一部の効果が発動しない可能性があります`, 'warning');
        }

        this.placeCardToSlot(card, staff);
    }

    /**
     * 【職種】条件を解析（複数職種対応）
     * @returns {string[]|null} 許可されている職種の配列、または制限なしの場合はnull
     */
    parseStaffRestriction(effect) {
        const match = effect.match(/【(.+?)】/);
        if (match) {
            const staffText = match[1];
            const allowedStaff = [];

            // 「・」区切りで複数職種を解析
            const parts = staffText.split('・');
            for (const part of parts) {
                const name = part.trim();
                if (['室長', '講師', '事務'].includes(name)) {
                    allowedStaff.push(name);
                }
            }

            if (allowedStaff.length > 0) {
                return allowedStaff;
            }
        }
        return null;
    }

    /**
     * カードが並行効果を持つか判定
     */
    hasParallelEffect(card) {
        return !!(card.effect && card.effect.includes('並行'));
    }

    /**
     * 最適な配置スロットを探索
     * - 並行カード: 配置枚数が最少のスロット（同数なら室長>講師>事務）
     * - 非並行カード: 空きスロットのみ（室長>講師>事務の優先順）
     * - 職種制限【】も考慮
     * @returns {string|null} 'leader'|'teacher'|'staff' または null（配置不可）
     */
    findBestSlot(card) {
        const isParallel = this.hasParallelEffect(card);
        const staffOrder = ['leader', 'teacher', 'staff'];
        const staffNames = { leader: '室長', teacher: '講師', staff: '事務' };
        const allowedStaff = this.parseStaffRestriction(card.effect);

        let bestSlot = null;
        let bestCount = Infinity;

        for (const slotKey of staffOrder) {
            if (allowedStaff && !allowedStaff.includes(staffNames[slotKey])) continue;
            const count = this.gameState.player.placed[slotKey].length;
            if (!isParallel && count > 0) continue; // 非並行は空きスロットのみ
            if (count < bestCount) {
                bestCount = count;
                bestSlot = slotKey;
            }
        }
        return bestSlot;
    }

    /**
     * 〈条件〉を解析し、現時点で満たしていない条件を返す
     * @param {string} effect - カード効果テキスト
     * @param {string} staff - 配置先スタッフ（leader/teacher/staff）
     * @returns {string[]} 満たしていない条件のリスト
     */
    checkUnmetConditions(effect, staff) {
        const unmetConditions = [];
        const staffNames = { leader: '室長', teacher: '講師', staff: '事務' };
        const currentStaffName = staffNames[staff];

        // 〈〉内の条件を抽出
        const conditionalRegex = /〈([^〉]+)〉/g;
        let match;

        while ((match = conditionalRegex.exec(effect)) !== null) {
            const condition = match[1].trim();

            // 職種条件をチェック
            if (['室長', '講師', '事務'].includes(condition)) {
                if (condition !== currentStaffName) {
                    unmetConditions.push(condition);
                }
                continue;
            }

            // ステータス条件をチェック（例：「満足10以下」「入塾3以上」）
            const statusMatch = condition.match(/(体験|入塾|満足|経理)(\d+)(以上|以下)/);
            if (statusMatch) {
                const statusName = statusMatch[1];
                const threshold = parseInt(statusMatch[2]);
                const comparison = statusMatch[3];

                const statusMap = {
                    '体験': 'experience',
                    '入塾': 'enrollment',
                    '満足': 'satisfaction',
                    '経理': 'accounting'
                };

                const currentValue = this.gameState.player[statusMap[statusName]];

                if (comparison === '以上' && currentValue < threshold) {
                    unmetConditions.push(condition);
                } else if (comparison === '以下' && currentValue > threshold) {
                    unmetConditions.push(condition);
                }
                continue;
            }
        }

        return unmetConditions;
    }

    /**
     * フロート通知を表示
     */
    showFloatNotification(message, type = 'info') {
        // 既存の通知を削除
        const existing = document.querySelector('.float-notification');
        if (existing) existing.remove();

        const notification = document.createElement('div');
        notification.className = `float-notification float-${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        // 3秒後に消える
        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    /**
     * カードをスロットに配置
     */
    placeCardToSlot(card, staff) {
        if (this.selectedCardForPlacement === card) {
            this.selectedCardForPlacement = null;
        }
        this.gameState.placeCard(card, staff);
        this.gameState.removeFromHand(card);

        this.renderStaffSlot(staff);
        this.renderHand();
        this.updateActionButtonState();
    }

    /**
     * スタッフスロットのUI再描画
     */
    renderStaffSlot(staff) {
        const slot = document.getElementById(`slot-${staff}`);
        if (!slot) return;
        const cards = this.gameState.player.placed[staff];
        slot.innerHTML = '';
        if (cards.length === 0) {
            slot.innerHTML = '<span class="slot-placeholder">タップまたはドラッグ</span>';
            slot.classList.remove('filled');
        } else {
            cards.forEach(card => {
                const cardElem = this.createCardElement(card, {
                    clickable: true,
                    compact: true,
                    onClick: () => this.onPlacedCardClick(card, staff)
                });
                slot.appendChild(cardElem);
            });
            slot.classList.add('filled');
        }
    }

    /**
     * 配置済みカードクリック（取り消し）
     */
    onPlacedCardClick(card, staff) {
        // スロット指定モードでカード選択中の場合、slot.onclickに処理を任せる
        if (this.slotSelectionMode && this.selectedCardForPlacement !== null) {
            return;
        }

        this.gameState.removePlacedCard(card, staff);
        this.gameState.addToHand(card);

        const slot = document.getElementById(`slot-${staff}`);
        if (slot) {
            if (this.gameState.player.placed[staff].length === 0) {
                slot.innerHTML = '<span class="slot-placeholder">タップまたはドラッグ</span>';
                slot.classList.remove('filled');
            } else {
                // まだカードが残っている場合はスロットを再描画
                this.renderStaffSlot(staff);
            }
        }

        this.renderHand();
        this.updateActionButtonState();
    }

    /**
     * ドロップゾーン設定
     */
    setupDropZones() {
        const slots = ['leader', 'teacher', 'staff'];

        slots.forEach(staff => {
            const slot = document.getElementById(`slot-${staff}`);
            if (!slot) return;

            // プロパティ代入で上書きし、累積登録を防ぐ
            slot.ondragover = (e) => {
                e.preventDefault();
                slot.classList.add('drag-over');
            };

            slot.ondragleave = () => {
                slot.classList.remove('drag-over');
            };

            slot.ondrop = (e) => {
                e.preventDefault();
                slot.classList.remove('drag-over');

                if (this.draggedCard) {
                    this.tryPlaceCardToSlot(this.draggedCard, staff);
                }
            };

            slot.onclick = () => {
                // 手動指定モードON かつ カード選択中 のときのみ処理
                if (!this.slotSelectionMode || !this.selectedCardForPlacement) return;
                // クリックが子要素（配置済みカード）由来でも親スロットのstaffを使う
                const card = this.selectedCardForPlacement;
                this.selectedCardForPlacement = null;
                this.renderHand(); // ハイライト解除
                this.tryPlaceCardToSlot(card, staff);
            };
        });
    }

    /**
     * カードドラッグ開始
     */
    onCardDragStart(e, card) {
        this.draggedCard = card;
        e.currentTarget.classList.add('dragging');
    }

    /**
     * カードドラッグ終了
     */
    onCardDragEnd(e) {
        e.currentTarget.classList.remove('dragging');
        this.draggedCard = null;
    }

    /**
     * アクションボタン状態更新（常に有効）
     */
    updateActionButtonState() {
        const confirmBtn = document.getElementById('confirm-action');
        if (confirmBtn) {
            // ボタンは常に有効（未配置時は警告表示）
            confirmBtn.disabled = false;
        }
    }

    /**
     * 手札の中で、現在配置可能なカード枚数を返す
     * 並行カードは常に配置可能、非並行カードは空きスロットがある場合のみ
     */
    getPlaceableCardCountInHand() {
        const staffMap = { leader: '室長', teacher: '講師', staff: '事務' };
        return this.gameState.player.hand.filter(card => {
            const isParallel = this.hasParallelEffect(card);
            const allowedStaff = this.parseStaffRestriction(card.effect);
            return ['leader', 'teacher', 'staff'].some(slotKey => {
                if (allowedStaff && !allowedStaff.includes(staffMap[slotKey])) return false;
                const count = this.gameState.player.placed[slotKey].length;
                return isParallel || count === 0;
            });
        }).length;
    }

    /**
     * 全スタッフ配置済みチェック
     */
    isAllStaffPlaced() {
        const placed = this.gameState.player.placed;
        return Object.values(placed).every(cards => cards.length > 0);
    }

    /**
     * アクション実行
     */
    onConfirmAction() {
        const placeableCount = this.getPlaceableCardCountInHand();
        if (placeableCount > 0) {
            const confirmed = confirm(`まだ配置できるカードがあります（${placeableCount}枚）。このまま教室行動を確定しますか？`);
            if (!confirmed) {
                return;
            }
        }

        // 実行前のステータスを記録
        const beforeStats = {
            experience: this.gameState.player.experience,
            enrollment: this.gameState.player.enrollment,
            satisfaction: this.gameState.player.satisfaction,
            accounting: this.gameState.player.accounting
        };

        // アクション実行
        const actionInfo = this.turnManager.executeActions();

        // 実行後のステータス
        const afterStats = {
            experience: this.gameState.player.experience,
            enrollment: this.gameState.player.enrollment,
            satisfaction: this.gameState.player.satisfaction,
            accounting: this.gameState.player.accounting
        };

        // ステータス変動演出を表示
        this.showStatusAnimation(beforeStats, afterStats, actionInfo);
    }

    /**
     * ステータス変動演出を表示
     */
    async showStatusAnimation(beforeStats, afterStats, actionInfo) {
        const overlay = document.getElementById('status-animation-overlay');
        const header = document.getElementById('animation-header');
        const cards = document.getElementById('animation-cards');

        if (!overlay || !header || !cards) {
            // 演出要素がなければスキップして次へ進む
            this.finishActionPhase();
            return;
        }

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
            header.innerHTML = `${this.gameState.turn + 1}/8ターン ${config.week}`;

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
            const staffOrder = ['leader', 'teacher', 'staff'];
            const staffNames = { leader: '室長', teacher: '講師', staff: '事務' };

            for (const staff of staffOrder) {
                const staffCards = placed[staff]; // 配列
                const cardEffectInfo = actionInfo?.cardEffects?.[staff];
                if (staffCards.length === 0 || !cardEffectInfo) continue;

                const statusName = statusNames[config.recommendedStatus] || config.recommendedStatus;
                for (let cardIdx = 0; cardIdx < staffCards.length; cardIdx += 1) {
                    const card = staffCards[cardIdx];
                    const perCardInfo = cardEffectInfo.cards?.[cardIdx];
                    const categoryColor = categoryColors[card.category] || '#9CA3AF';
                    const categoryBadge = `<span style="background:${categoryColor};color:white;padding:1px 4px;border-radius:4px;font-size:0.7em;margin-left:4px;">${this._escapeHTML(card.category)}</span>`;
                    const isRecommended = perCardInfo?.isRecommended || false;
                    const recommendedMark = isRecommended ? ' 🎯' : '';
                    const bonusText = isRecommended ? `<div class="anim-bonus-text">🎯 おすすめボーナス ${statusName}+1</div>` : '';

                    cards.innerHTML = `
                        <div class="animation-card-item">
                            <div class="anim-staff-name">${staffNames[staff]}${staffCards.length > 1 ? ` (${cardIdx + 1}/${staffCards.length})` : ''}</div>
                            <div class="anim-card-name">${this._escapeHTML(card.cardName)}${categoryBadge}${recommendedMark}</div>
                            <div class="anim-card-effect">${this._escapeHTML(card.effect)}</div>
                            ${bonusText}
                        </div>
                    `;

                    if (perCardInfo) {
                        const beforeCardStats = { ...currentStats };
                        const delta = this.calculateDelta(perCardInfo.beforeStats, perCardInfo.afterStats);
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

            // 演出終了（📊行動結果ステップを除去）
            await this._sleep(500);
        } finally {
            overlay.classList.add('hidden');
            this.finishActionPhase();
        }
    }

    /**
     * 指定時間待機
     */
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
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

    /**
     * ステータス差分を計算
     */
    calculateDelta(before, after) {
        return {
            experience: after.experience - before.experience,
            enrollment: after.enrollment - before.enrollment,
            satisfaction: after.satisfaction - before.satisfaction,
            accounting: after.accounting - before.accounting
        };
    }

    /**
     * ステータス更新アニメーション
     */
    animateStatusUpdate(before, after) {
        const statMap = {
            experience: 'exp',
            enrollment: 'enr',
            satisfaction: 'sat',
            accounting: 'acc'
        };

        Object.entries(statMap).forEach(([key, id]) => {
            const valueElem = document.getElementById(`anim-${id}-value`);
            const deltaElem = document.getElementById(`anim-${id}-delta`);
            const delta = after[key] - before[key];

            if (valueElem) {
                valueElem.textContent = after[key];
                valueElem.classList.add('updating');
                setTimeout(() => valueElem.classList.remove('updating'), 300);
            }

            if (deltaElem && delta !== 0) {
                deltaElem.textContent = delta > 0 ? `+${delta}` : `${delta}`;
                deltaElem.classList.add(delta > 0 ? 'positive' : 'negative');
            }
        });
    }

    /**
     * アクションフェーズ終了処理
     */
    finishActionPhase() {
        this.updateStatusDisplay();
        this.turnManager.advancePhase();

        // advancePhaseの結果に応じてUIを切り替え
        if (this.gameState.phase === 'end') {
            this.showResultPhase();
        } else if (this.gameState.phase === 'meeting') {
            this.showMeetingPhase();
        } else if (this.gameState.phase === 'training') {
            // delete=0でmeetingがスキップされた場合
            this.showTrainingPhase();
        }
    }

    /**
     * 教室会議フェーズ表示
     */
    showMeetingPhase() {
        this.showPhaseArea('meeting');
        this.updateTurnDisplay();
        this.updateStatusDisplay();
        this.renderTokenDisplay();

        const maxDelete = this.turnManager.getCurrentDeleteMax();
        const organizeBonus = this.gameState.tokens?.organize || 0;
        this.gameState.tokens.organize = 0;  // 消費
        const bonusInfo = document.getElementById('organize-bonus-info');
        if (bonusInfo) {
            if (organizeBonus > 0) {
                bonusInfo.textContent = `🗑️ 整理トークン効果: +${organizeBonus}枚追加削除できます`;
                bonusInfo.classList.remove('hidden');
            } else {
                bonusInfo.classList.add('hidden');
            }
        }

        const deleteCountElem = document.getElementById('delete-count');
        const maxDeleteElem = document.getElementById('max-delete');

        if (deleteCountElem) deleteCountElem.textContent = maxDelete;
        if (maxDeleteElem) maxDeleteElem.textContent = maxDelete;

        this.selectedCardsForDeletion = [];
        // Bug3修正: 選択済み枚数の表示を0にリセット
        const selectedCountElem = document.getElementById('selected-count');
        if (selectedCountElem) selectedCountElem.textContent = '0';
        this.renderDeck(maxDelete);

        // フェーズ開始時に保存（思考場面の維持）
        this.saveGameState();
    }

    /**
     * デッキ表示（獲得ターン順にソート）
     */
    renderDeck(maxDelete) {
        const deckContainer = document.getElementById('deck-cards');
        if (!deckContainer) return;

        deckContainer.innerHTML = '';

        // 獲得ターン順（古い順）にソート
        const sortedDeck = [...this.gameState.player.deck].sort((a, b) => {
            const turnA = a.acquiredTurn ?? 0;
            const turnB = b.acquiredTurn ?? 0;
            return turnA - turnB;
        });

        sortedDeck.forEach(card => {
            const cardElem = this.createCardElement(card, {
                clickable: maxDelete > 0,
                compact: true,
                onClick: (c, elem) => this.onDeckCardSelect(c, elem, maxDelete)
            });
            deckContainer.appendChild(cardElem);
        });
    }

    /**
     * デッキカード選択（削除用）
     */
    onDeckCardSelect(card, elem, maxDelete) {
        const index = this.selectedCardsForDeletion.indexOf(card);

        if (index > -1) {
            this.selectedCardsForDeletion.splice(index, 1);
            elem.classList.remove('selected');
        } else {
            if (this.selectedCardsForDeletion.length < maxDelete) {
                this.selectedCardsForDeletion.push(card);
                elem.classList.add('selected');
            }
        }

        const selectedCountElem = document.getElementById('selected-count');
        if (selectedCountElem) {
            selectedCountElem.textContent = this.selectedCardsForDeletion.length;
        }
    }

    /**
     * 会議確定
     */
    onConfirmMeeting() {
        // Spec1修正: 最大枚数未満の場合は確認ダイアログを表示
        const maxDelete = this.turnManager.getCurrentDeleteMax();
        if (maxDelete > 0 && this.selectedCardsForDeletion.length < maxDelete) {
            const confirmed = confirm('まだ削除できる枚数が残っています。次のターンに進んでよろしいですか？');
            if (!confirmed) return;
        }

        // カード削除
        this.selectedCardsForDeletion.forEach(card => {
            this.gameState.removeFromDeck(card);
        });

        this.selectedCardsForDeletion = [];
        this.gameState.tokens.organize = 0;

        // 手札補充は削除（アクションフェーズ開始時に引くため）
        // 代わりに、残りの手札をデッキに戻す
        this.gameState.player.hand.forEach(card => {
            this.gameState.player.deck.push(card);
        });
        this.gameState.player.hand = [];

        // 次のターンへ
        this.turnManager.advancePhase();

        if (this.gameState.phase === 'end') {
            this.showResultPhase();
        } else {
            this.showTrainingPhase();
        }
    }

    /**
     * 研修フェーズ表示（2ターン目以降）
     */
    showTrainingPhase() {
        this.trainingSelectionMode = 'normal';
        this.inspirationRemaining = 0;
        const config = this.turnManager.getCurrentTurnConfig();
        window.CDG_DEBUG && console.log('[SAVE-DEBUG] showTrainingPhase: 開始, turn=', this.gameState.turn, ', training=', config.training);

        // ターン概要オーバーレイを表示
        this.showTurnOverlay(config);

        const trainingCards = this.cardManager.drawTrainingCards(config.training, 3);
        window.CDG_DEBUG && console.log('[SAVE-DEBUG] showTrainingPhase: 抽選カード:', trainingCards.map(c => c.cardName));

        // 抽選したカードをgameStateに保存（復元時に使用）
        this.gameState.currentTrainingCards = trainingCards.map(c => ({ ...c }));

        // 抽選完了直後に保存（再抽選防止）
        this.saveGameState();

        const container = document.getElementById('training-cards');
        if (!container) return;

        container.innerHTML = '';
        this.selectedTrainingCard = null;
        // Spec2修正: 1枚選択するまで確定ボタンを無効化
        const confirmBtnTraining = document.getElementById('confirm-training');
        if (confirmBtnTraining) confirmBtnTraining.disabled = true;

        trainingCards.forEach(card => {
            const cardElem = this.createCardElement(card, {
                clickable: true,
                compact: true,
                onClick: (c, elem) => this.onTrainingCardSelect(c, elem, container)
            });
            container.appendChild(cardElem);
        });

        // リフレッシュボタン表示制御
        this.updateTrainingRefreshUI(config.training);
        this.showPhaseArea('training');
        this.updateTurnDisplay();
        this.updateStatusDisplay();
        this.renderTokenDisplay();

        const instruction = document.querySelector('#training-area .instruction');
        if (instruction) {
            const helpText = this.isShortCardDesc() ? '<span class="help-longpress">[長押しで詳細]</span>' : '';
            instruction.innerHTML = `3枚から1枚を選んで習得してください${helpText}`;
        }
    }

    /**
     * ターン概要オーバーレイを表示
     */
    showTurnOverlay(config) {
        // 既存のオーバーレイを削除
        const existing = document.querySelector('.turn-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'turn-overlay';

        // 表示内容: 「2/8ターン 2月上旬 {weekTopic} 🎯おすすめ:◯◯」
        const recommendedText = config.recommended ? `🎯おすすめ: ${config.recommended}` : '';
        const trainingText = config.training ? `習得: ${config.training}` : '';
        const deleteText = config.delete ? `削除: ${config.delete}枚` : '';

        overlay.innerHTML = `
            <div class="turn-overlay-content">
                <div class="turn-overlay-turn">${this.gameState.turn + 1}/8 ターン</div>
                <div class="turn-overlay-week">${config.week}</div>
                <div class="turn-overlay-topic">${config.topic || ''}</div>
                <div class="turn-overlay-info">
                    ${recommendedText ? `<span class="turn-overlay-recommended">${recommendedText}</span>` : ''}
                    <span>${trainingText}</span>
                    <span>${deleteText}</span>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // 1.5秒後に自動で非表示
        setTimeout(() => {
            overlay.classList.add('fade-out');
            setTimeout(() => overlay.remove(), 300);
        }, 1500);
    }

    /**
     * 研修カード選択
     */
    onTrainingCardSelect(card, elem, container) {
        // 前の選択をクリア
        container.querySelectorAll('.card').forEach(c => c.classList.remove('selected'));

        this.selectedTrainingCard = card;
        elem.classList.add('selected');

        const confirmBtn = document.getElementById('confirm-training');
        if (confirmBtn) {
            confirmBtn.disabled = false;
        }
    }

    /**
     * 研修リフレッシュボタンの表示状態を更新
     */
    updateTrainingRefreshUI(rarity) {
        const row = document.getElementById('training-refresh-row');
        const countElem = document.getElementById('training-refresh-count');
        if (!row) return;

        const remaining = this.gameState.trainingRefreshRemaining ?? 0;
        const enabled = this.gameState.difficulty === 'pro' && remaining > 0 && rarity !== 'N';

        if (enabled) {
            row.classList.remove('hidden');
            if (countElem) countElem.textContent = `残り${remaining}回`;
        } else {
            row.classList.add('hidden');
        }
    }

    /**
     * 研修リフレッシュ実行
     */
    onTrainingRefresh() {
        const config = this.turnManager.getCurrentTurnConfig();
        const remaining = this.gameState.trainingRefreshRemaining ?? 0;
        if (remaining <= 0) return;

        // 現在の候補カードを取得してリフレッシュ
        const currentCards = this.gameState.currentTrainingCards || [];
        const isInspiration = this.trainingSelectionMode === 'inspiration';
        const isInitialTraining = this.gameState.turn === 0;
        const rarity = isInspiration ? 'SR' : (isInitialTraining ? 'R' : config.training);
        const count = (isInspiration || !isInitialTraining) ? 3 : 4;
        const newCards = this.cardManager.refreshTrainingCards(rarity, currentCards, count);

        // 残り回数を減らす
        this.gameState.trainingRefreshRemaining = remaining - 1;

        // 新カードで表示を更新
        this.gameState.currentTrainingCards = newCards.map(c => ({ ...c }));

        const container = document.getElementById('training-cards');
        if (container) {
            container.innerHTML = '';
            if (isInitialTraining) {
                // 初回研修: 2枚選択モード
                this.selectedInitialCards = [];
                newCards.forEach(card => {
                    const cardElem = this.createCardElement(card, {
                        clickable: true,
                        compact: true,
                        onClick: (c, elem) => this.onInitialCardSelect(c, elem, newCards)
                    });
                    container.appendChild(cardElem);
                });
                // 初回研修は selectedInitialCards が2枚になるまで確定ボタン無効
                const confirmBtn = document.getElementById('confirm-training');
                if (confirmBtn) confirmBtn.disabled = true;
            } else {
                // 通常研修: 1枚選択モード
                this.selectedTrainingCard = null;
                newCards.forEach(card => {
                    const cardElem = this.createCardElement(card, {
                        clickable: true,
                        compact: true,
                        onClick: (c, elem) => this.onTrainingCardSelect(c, elem, container)
                    });
                    container.appendChild(cardElem);
                });
                const confirmBtn = document.getElementById('confirm-training');
                if (confirmBtn) confirmBtn.disabled = true;
            }
        }

        this.updateTrainingRefreshUI(rarity);
        this.saveGameState();
        this.logger?.log(`研修リフレッシュ実行: 残り${this.gameState.trainingRefreshRemaining}回`, 'action');
    }

    /**
     * 発想トークン追加習得フロー開始
     */
    startInspirationTrainingFlow() {
        this.trainingSelectionMode = 'inspiration';
        this.inspirationRemaining = this.gameState.tokens?.inspiration ?? 0;
        this.showInspirationTrainingRound();
    }

    /**
     * 発想追加習得ラウンドの表示
     */
    showInspirationTrainingRound() {
        const candidates = this.drawInspirationCandidates();
        if (candidates.length === 0) {
            // カードが引けない場合はスキップ
            this.gameState.tokens.inspiration = 0;
            this.finalizeTrainingToAction();
            return;
        }

        this.gameState.currentTrainingCards = candidates.map(c => ({ ...c }));
        this.selectedTrainingCard = null;

        const container = document.getElementById('training-cards');
        if (container) {
            container.innerHTML = '';
            candidates.forEach(card => {
                const cardElem = this.createCardElement(card, {
                    clickable: true,
                    compact: true,
                    onClick: (c, elem) => this.onTrainingCardSelect(c, elem, container)
                });
                container.appendChild(cardElem);
            });
        }

        const confirmBtn = document.getElementById('confirm-training');
        if (confirmBtn) confirmBtn.disabled = true;

        const instruction = document.querySelector('#training-area .instruction');
        if (instruction) {
            const helpText = this.isShortCardDesc() ? '<span class="help-longpress">[長押しで詳細]</span>' : '';
            instruction.innerHTML = `💡 発想追加習得 (残り${this.inspirationRemaining}回): SRカード3枚から1枚を選んで習得してください${helpText}`;
        }

        this.updateTrainingRefreshUI('SR');

        this.showPhaseArea('training');
        this.updateTurnDisplay();
        this.updateStatusDisplay();
        this.renderTokenDisplay();
        this.saveGameState();
    }

    /**
     * SRカードを3枚抽選して返す
     */
    drawInspirationCandidates() {
        return this.cardManager.drawTrainingCards('SR', 3);
    }

    /**
     * 発想追加習得の確定
     */
    confirmInspirationTraining() {
        if (!this.selectedTrainingCard) return;

        this.gameState.addToDeck({ ...this.selectedTrainingCard });
        this.selectedTrainingCard = null;
        this.inspirationRemaining -= 1;

        if (this.inspirationRemaining > 0) {
            this.gameState.tokens.inspiration = this.inspirationRemaining;
            this.showInspirationTrainingRound();
        } else {
            this.gameState.tokens.inspiration = 0;
            this.trainingSelectionMode = 'normal';
            this.gameState.currentTrainingCards = null;
            this.finalizeTrainingToAction();
        }
    }

    /**
     * 研修フェーズ終了→行動フェーズへ遷移する共通処理
     */
    finalizeTrainingToAction() {
        this.trainingSelectionMode = 'normal';
        // advancePhaseはtraining→action遷移を前提としている
        this.gameState.phase = 'training';
        this.turnManager.advancePhase();
        this.showActionPhase();
        this.saveGameState();
    }

    /**
     * 結果フェーズ表示
     */
    showResultPhase() {
        // Bug1修正: 最終ターンのカード情報を保存（deck + hand + placed を含める）
        const placedCards = Object.values(this.gameState.player.placed)
            .flatMap(cards => cards.map(c => ({ ...c })));
        const finalDeck = [
            ...this.gameState.player.deck.map(c => ({ ...c })),
            ...this.gameState.player.hand.map(c => ({ ...c })),
            ...placedCards
        ];

        const score = this.scoreManager.calculateScore(this.gameState);

        this.showPhaseArea('result');
        this.updateStatusDisplay();
        this.renderTokenDisplay();

        // ランク表示
        const rankElem = document.getElementById('result-rank');
        if (rankElem) {
            rankElem.innerHTML = `
                <div class="rank-grade rank-${score.rank.grade.replace('+', 'plus')}">${score.rank.grade}</div>
                <div class="rank-name">${score.rank.name}</div>
            `;
        }

        // 得点内訳表示
        const breakdownElem = document.getElementById('result-breakdown');
        if (breakdownElem) {
            const difficulty = this.gameState.difficulty || 'fresh';
            if (difficulty === 'pro') {
                breakdownElem.innerHTML = this.renderProBreakdown(score);
            } else {
                breakdownElem.innerHTML = `
                    <table class="breakdown-table">
                        <thead>
                            <tr>
                                <th>達成項目</th>
                                <th>結果</th>
                                <th>ポイント</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>退塾目標</td>
                                <td>退塾 ${score.withdrawal}</td>
                                <td>${this.renderPointRange('withdrawal', score.withdrawal, score.breakdown.withdrawalPoints)}</td>
                            </tr>
                            <tr>
                                <td>動員目標</td>
                                <td>体験 ${score.mobilization}</td>
                                <td>${this.renderPointRange('mobilization', score.mobilization, score.breakdown.mobilizationPoints)}</td>
                            </tr>
                            <tr>
                                <td>入退目標</td>
                                <td>入退差 ${score.enrollmentDiff}</td>
                                <td>${this.renderPointRange('enrollmentDiff', score.enrollmentDiff, score.breakdown.enrollmentDiffPoints)}</td>
                            </tr>
                            ${score.splusBreakdown ? `
                            <tr class="splus-breakdown-row">
                                <td colspan="2">S+ 精度スコア内訳</td>
                                <td>基礎8.0 + 体験+${score.splusBreakdown.expBonus}（体験${score.splusBreakdown.expUsed}）+ 入退差+${score.splusBreakdown.diffBonus}（入退差${score.splusBreakdown.diffUsed}）</td>
                            </tr>` : ''}
                            <tr class="total-row">
                                <td colspan="2">合計スコア</td>
                                <td><strong>${score.displayScore}</strong></td>
                            </tr>
                        </tbody>
                    </table>
                `;
            }
        }

        // ハイスコア保存・表示
        const difficulty = this.gameState.difficulty || 'fresh';
        this.scoreManager.saveHighScore(score, difficulty);
        const highScore = this.scoreManager.getHighScore(difficulty);
        const highScoreElem = document.getElementById('high-score');
        if (highScoreElem && highScore) {
            highScoreElem.textContent = `${highScore.displayScore ?? highScore.points}ポイント`;
        }

        // スコア自動送信（fire-and-forget）
        submitScore(this.gameState, score, finalDeck, this.logger);

        // セーブデータクリア（ゲーム終了）
        this.saveManager?.clear();

        // 最終ターンのカード一覧表示
        this.renderFinalCards(finalDeck);
    }

    /**
     * 最終結果画面に所有カード一覧を表示
     * @param {Array} cards - 最終ターンの全カード
     */
    renderFinalCards(cards) {
        const container = document.getElementById('result-cards');
        if (!container) return;

        container.innerHTML = '';

        if (cards.length === 0) return;

        const heading = document.createElement('h3');
        heading.className = 'result-cards-heading';
        heading.textContent = `所有カード一覧（${cards.length}枚）`;
        container.appendChild(heading);

        const grid = document.createElement('div');
        grid.className = 'result-cards-grid';

        // レアリティ順→カテゴリ順にソート
        const rarityOrder = { SSR: 0, SR: 1, R: 2, N: 3 };
        cards.sort((a, b) => {
            const rDiff = (rarityOrder[a.rarity] ?? 9) - (rarityOrder[b.rarity] ?? 9);
            if (rDiff !== 0) return rDiff;
            return a.category.localeCompare(b.category);
        });

        cards.forEach(card => {
            const cardElem = this.createCardElement(card, { compact: true });
            grid.appendChild(cardElem);
        });

        container.appendChild(grid);
    }

    /**
     * ポイントレンジを表示（該当ポイントを強調）
     */
    renderPointRange(type, value, earnedPoints) {
        const ranges = {
            withdrawal: [
                { min: 4, max: Infinity, points: -3 },
                { min: 2, max: 3, points: 0 },
                { min: 0, max: 1, points: 1 }
            ],
            mobilization: [
                { min: 0, max: 9, points: 0 },
                { min: 10, max: 11, points: 1 },
                { min: 12, max: Infinity, points: 2 }
            ],
            enrollmentDiff: [
                { min: -Infinity, max: 7, points: 0 },
                { min: 8, max: 9, points: 3 },
                { min: 10, max: 11, points: 4 },
                { min: 12, max: Infinity, points: 5 }
            ]
        };

        return ranges[type].map(r => {
            const isActive = earnedPoints === r.points;
            const pointStr = r.points >= 0 ? `+${r.points}` : `${r.points}`;
            if (isActive) {
                return `<span class="point-active">${pointStr}</span>`;
            }
            return `<span class="point-inactive">${pointStr}</span>`;
        }).join(' | ');
    }

    /**
     * PRO難易度の結果内訳テーブルを生成
     * @param {Object} score - calculateScorePro() の戻り値
     * @returns {string} HTML文字列
     */
    renderProBreakdown(score) {
        const b = score.breakdown;
        const formatPoints = (pts) => {
            if (pts > 0) return `<span class="point-active">+${pts}</span>`;
            if (pts < 0) return `<span class="point-active">${pts}</span>`;
            return `<span class="point-inactive">0</span>`;
        };

        return `
            <table class="breakdown-table">
                <thead>
                    <tr>
                        <th>達成項目</th>
                        <th>結果</th>
                        <th>スコア</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>動員</td>
                        <td>体験 ${score.experience}</td>
                        <td>${formatPoints(b.mobilizationPoints)}</td>
                    </tr>
                    <tr>
                        <td>退塾</td>
                        <td>退塾 ${score.withdrawal}</td>
                        <td>${formatPoints(b.withdrawalPoints)}</td>
                    </tr>
                    <tr>
                        <td>入退差</td>
                        <td>入退差 ${score.enrollmentDiff}</td>
                        <td>${formatPoints(b.enrollmentDiffPoints)}</td>
                    </tr>
                    <tr>
                        <td>満足</td>
                        <td>満足 ${score.satisfaction}</td>
                        <td>${formatPoints(b.satisfactionPoints)}</td>
                    </tr>
                    <tr class="total-row">
                        <td colspan="2">合計スコア</td>
                        <td><strong>${score.displayScore}</strong></td>
                    </tr>
                </tbody>
            </table>
        `;
    }

    /**
     * スコア共有
     */
    onShareScore() {
        const score = this.scoreManager.calculateScore(this.gameState);
        const url = this.scoreManager.generateShareURL(score);

        if (navigator.clipboard) {
            navigator.clipboard.writeText(url).then(() => {
                alert('スコア共有URLをクリップボードにコピーしました！');
            }).catch(() => {
                this.showShareURL(url);
            });
        } else {
            this.showShareURL(url);
        }
    }

    /**
     * 共有URL表示
     */
    showShareURL(url) {
        const message = `スコア共有URL:\n${url}`;
        alert(message);
    }

    /**
     * リスタート
     */
    onRestart() {
        this.logger.clear();

        // 全フェーズエリアを非表示
        ['training-area', 'action-area', 'meeting-area', 'result-area'].forEach(id => {
            const elem = document.getElementById(id);
            if (elem) elem.classList.add('hidden');
        });

        // タイトル画面を再表示（難易度選択から）
        const overlay = document.getElementById('start-overlay');
        overlay?.classList.remove('hidden');
    }

    /**
     * デッキ内訳オーバーレイを表示
     */
    showDeckOverlay() {
        const overlay = this.createInfoOverlay('デッキ内訳');
        const content = overlay.querySelector('.info-overlay-content');

        // 手札と山札を分離
        const hand = this.gameState.player.hand || [];
        const deck = this.gameState.player.deck || [];

        // 手札セクション
        if (hand.length > 0) {
            const handSection = document.createElement('div');
            handSection.className = 'deck-section';
            handSection.innerHTML = `<div class="deck-section-title">手札 (${hand.length}枚)</div>`;
            const handCards = document.createElement('div');
            handCards.className = 'deck-cards';
            hand.forEach(card => {
                const cardElem = this.createCardElement(card, { compact: true });
                handCards.appendChild(cardElem);
            });
            handSection.appendChild(handCards);
            content.appendChild(handSection);
        }

        // 山札セクション
        if (deck.length > 0) {
            const deckSection = document.createElement('div');
            deckSection.className = 'deck-section';
            deckSection.innerHTML = `<div class="deck-section-title">山札 (${deck.length}枚)</div>`;
            const deckCards = document.createElement('div');
            deckCards.className = 'deck-cards';

            // 獲得ターン順にソート
            const sortedDeck = [...deck].sort((a, b) => {
                const turnA = a.acquiredTurn ?? 0;
                const turnB = b.acquiredTurn ?? 0;
                return turnA - turnB;
            });

            sortedDeck.forEach(card => {
                const cardElem = this.createCardElement(card, { compact: true });
                deckCards.appendChild(cardElem);
            });
            deckSection.appendChild(deckCards);
            content.appendChild(deckSection);
        }

        if (hand.length === 0 && deck.length === 0) {
            content.innerHTML = '<p style="text-align:center;color:var(--color-text-secondary);">デッキが空です</p>';
        }

        document.body.appendChild(overlay);
    }

    /**
     * スケジュール一覧オーバーレイを表示
     */
    showScheduleOverlay() {
        const overlay = this.createInfoOverlay('スケジュール一覧');
        const content = overlay.querySelector('.info-overlay-content');

        // ターン設定を取得
        const turnConfigs = this.turnManager.getTurnConfigs();

        const table = document.createElement('table');
        table.className = 'schedule-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th>ターン</th>
                    <th>週</th>
                    <th>習得</th>
                    <th>削除</th>
                    <th>おすすめ</th>
                </tr>
            </thead>
            <tbody>
            </tbody>
        `;

        const tbody = table.querySelector('tbody');
        turnConfigs.forEach((config, i) => {
            const turn = i + 1;
            const currentTurn = this.gameState.turn + 1; // turnは0-indexedなので+1
            const isCurrent = turn === currentTurn;
            const isPast = turn < currentTurn;
            const tr = document.createElement('tr');
            if (isCurrent) {
                tr.className = 'current';
            } else if (isPast) {
                tr.className = 'past';
            }
            tr.innerHTML = `
                <td>${turn}/8</td>
                <td>${config.week}</td>
                <td>${config.training || '-'}</td>
                <td>${config.delete || 0}枚</td>
                <td class="recommended-cell">${config.recommended || '-'}</td>
            `;
            tbody.appendChild(tr);
        });

        content.appendChild(table);
        this.renderScoreSection(content);
        document.body.appendChild(overlay);
    }

    /**
     * スコア換算表セクションをスケジュールオーバーレイに追加
     */
    renderScoreSection(content) {
        const difficulty = this.gameState.difficulty || 'fresh';
        const withdrawal = this.scoreManager?.calculateWithdrawal?.(this.gameState) ?? 0;
        const mobilization = this.gameState.player.experience;
        const enrollmentDiff = this.gameState.player.enrollment - withdrawal;
        const satisfaction = this.gameState.player.satisfaction;

        // ---- セクションタイトル ----
        const title = document.createElement('div');
        title.className = 'score-section-title';
        title.textContent = '📊 スコア換算表';
        content.appendChild(title);

        // ---- サマリー行 ----
        const summary = document.createElement('div');
        summary.className = 'score-summary';

        if (difficulty === 'fresh') {
            summary.textContent = `退塾${withdrawal}名 / 体験${mobilization} / 入退差${enrollmentDiff}`;
        } else {
            summary.textContent = `退塾${withdrawal}名 / 体験${mobilization} / 入退差${enrollmentDiff} / 満足${satisfaction}`;
        }
        content.appendChild(summary);

        if (difficulty === 'fresh') {
            this._renderFreshScoreTable(content, withdrawal, mobilization, enrollmentDiff);
        } else {
            this._renderProScoreTable(content, withdrawal, mobilization, enrollmentDiff, satisfaction);
        }
    }

    /**
     * FRESHのスコア換算表を描画
     */
    _renderFreshScoreTable(content, withdrawal, mobilization, enrollmentDiff) {
        // ---- 退塾 + 動員 の2列グリッド ----
        const grid1 = document.createElement('div');
        grid1.className = 'score-grid';

        // 退塾ポイントテーブル
        const withdrawalRows = [
            { label: '0〜1', min: 0, max: 1, pts: 1 },
            { label: '2〜3', min: 2, max: 3, pts: 0 },
            { label: '4以上', min: 4, max: Infinity, pts: -3 },
        ];
        grid1.appendChild(this._buildScoreTable(
            '退塾ポイント',
            [{ header: '退塾数' }, { header: 'pt' }],
            withdrawalRows.map(r => ({
                cells: [r.label, this._fmtPts(r.pts)],
                current: withdrawal >= r.min && withdrawal <= r.max,
            }))
        ));

        // 動員ポイントテーブル
        const mobilizationRows = [
            { label: '12以上', min: 12, max: Infinity, pts: 2 },
            { label: '10〜11', min: 10, max: 11, pts: 1 },
            { label: '9以下', min: 0, max: 9, pts: 0 },
        ];
        grid1.appendChild(this._buildScoreTable(
            '動員ポイント',
            [{ header: '体験' }, { header: 'pt' }],
            mobilizationRows.map(r => ({
                cells: [r.label, this._fmtPts(r.pts)],
                current: mobilization >= r.min && mobilization <= r.max,
            }))
        ));
        content.appendChild(grid1);

        // ---- 入退差（全幅） ----
        const enrollmentRows = [
            { label: '12以上', min: 12, max: Infinity, pts: 5 },
            { label: '10〜11', min: 10, max: 11, pts: 4 },
            { label: '8〜9', min: 8, max: 9, pts: 3 },
            { label: '7以下', min: -Infinity, max: 7, pts: 0 },
        ];
        const fullTable = this._buildScoreTable(
            '入退差ポイント',
            [{ header: '入退差（入塾−退塾）' }, { header: 'pt' }],
            enrollmentRows.map(r => ({
                cells: [r.label, this._fmtPts(r.pts)],
                current: enrollmentDiff >= (r.min === -Infinity ? -999 : r.min) && enrollmentDiff <= (r.max === Infinity ? 999 : r.max),
            }))
        );
        fullTable.style.marginBottom = '6px';
        content.appendChild(fullTable);

        // S+条件ノート
        const note = document.createElement('div');
        note.className = 'score-note';
        note.textContent = '★ S+条件: 観点別得点8点時の精度計算で合計9.0以上';
        content.appendChild(note);
    }

    /**
     * PROのスコア換算表を描画
     */
    _renderProScoreTable(content, withdrawal, mobilization, enrollmentDiff, satisfaction) {
        // ---- 動員 + 満足 の2列グリッド ----
        const grid1 = document.createElement('div');
        grid1.className = 'score-grid';

        // 動員ポイント（体験数 → scores.mobilization）
        // rankPro.csv: C=15→1, B=20→2, B+=23→2(同), A=25→3, A+=32→3(同), S=40→4, S+=50→5
        const mobilizationRows = [
            { label: '50以上', min: 50, max: Infinity, pts: 5 },
            { label: '40〜49', min: 40, max: 49, pts: 4 },
            { label: '25〜39', min: 25, max: 39, pts: 3 },
            { label: '20〜24', min: 20, max: 24, pts: 2 },
            { label: '15〜19', min: 15, max: 19, pts: 1 },
            { label: '14以下', min: 0, max: 14, pts: 0 },
        ];
        grid1.appendChild(this._buildScoreTable(
            '動員ポイント',
            [{ header: '体験' }, { header: 'pt' }],
            mobilizationRows.map(r => ({
                cells: [r.label, this._fmtPts(r.pts)],
                current: mobilization >= r.min && mobilization <= r.max,
            }))
        ));

        // 満足ポイント（rankPro.csv基準: SS=35以上→2pt, S+=25以上→1pt, それ以外→0pt）
        const satisfactionRows = [
            { label: '35以上', min: 35, max: Infinity, pts: 2 },
            { label: '25〜34', min: 25, max: 34, pts: 1 },
            { label: '24以下', min: 0, max: 24, pts: 0 },
        ];
        grid1.appendChild(this._buildScoreTable(
            '満足ポイント',
            [{ header: '満足' }, { header: 'pt' }],
            satisfactionRows.map(r => ({
                cells: [r.label, this._fmtPts(r.pts)],
                current: satisfaction >= r.min && satisfaction <= r.max,
            }))
        ));
        content.appendChild(grid1);

        // ---- 退塾 + 入退差 の2列グリッド ----
        const grid2 = document.createElement('div');
        grid2.className = 'score-grid';

        // 退塾ポイント（withdrawal <= withdrawalThreshold → score）
        // rankPro.csv: S+=0→+1, S=1→0, A=2→-1, B=3→-3, C=4→-5, F=30→-13（E行はscore空欄でスキップ→Fにフォールスルー）
        const withdrawalRows = [
            { label: '0', min: 0, max: 0, pts: 1 },
            { label: '1', min: 1, max: 1, pts: 0 },
            { label: '2', min: 2, max: 2, pts: -1 },
            { label: '3', min: 3, max: 3, pts: -3 },
            { label: '4', min: 4, max: 4, pts: -5 },
            { label: '5以上', min: 5, max: Infinity, pts: -13 },
        ];
        grid2.appendChild(this._buildScoreTable(
            '退塾ポイント',
            [{ header: '退塾数' }, { header: 'pt' }],
            withdrawalRows.map(r => ({
                cells: [r.label, this._fmtPts(r.pts)],
                current: withdrawal >= r.min && withdrawal <= (r.max === Infinity ? 9999 : r.max),
            }))
        ));

        // 入退差ポイント（enrollmentDiff >= enrollmentDiffThreshold → score）
        // rankPro.csv: F=0→0, E=4→0, D=8→0, C=12→1, B=16→2, B+=18→3, A=20→4, A+=26→5, S=32→6, S+=40→7, SS=48→8
        const enrollmentRows = [
            { label: '48以上', min: 48, max: Infinity, pts: 8 },
            { label: '40〜47', min: 40, max: 47, pts: 7 },
            { label: '32〜39', min: 32, max: 39, pts: 6 },
            { label: '26〜31', min: 26, max: 31, pts: 5 },
            { label: '20〜25', min: 20, max: 25, pts: 4 },
            { label: '18〜19', min: 18, max: 19, pts: 3 },
            { label: '16〜17', min: 16, max: 17, pts: 2 },
            { label: '12〜15', min: 12, max: 15, pts: 1 },
            { label: '11以下', min: -Infinity, max: 11, pts: 0 },
        ];
        grid2.appendChild(this._buildScoreTable(
            '入退差ポイント',
            [{ header: '入退差' }, { header: 'pt' }],
            enrollmentRows.map(r => ({
                cells: [r.label, this._fmtPts(r.pts)],
                current: enrollmentDiff >= (r.min === -Infinity ? -9999 : r.min) && enrollmentDiff <= (r.max === Infinity ? 9999 : r.max),
            }))
        ));
        content.appendChild(grid2);
    }

    /**
     * スコアテーブルを生成するヘルパー
     * @param {string} categoryTitle - テーブルタイトル
     * @param {Array<{header:string}>} headers - ヘッダー列定義
     * @param {Array<{cells:string[], current:boolean}>} rows - 行データ
     * @returns {HTMLElement} テーブル要素を内包するラッパーdiv
     */
    _buildScoreTable(categoryTitle, headers, rows) {
        const wrapper = document.createElement('div');

        const catTitle = document.createElement('div');
        catTitle.className = 'score-category-title';
        catTitle.textContent = categoryTitle;
        wrapper.appendChild(catTitle);

        const table = document.createElement('table');
        table.className = 'score-table';

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headers.forEach(h => {
            const th = document.createElement('th');
            th.textContent = h.header;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        rows.forEach(row => {
            const tr = document.createElement('tr');
            if (row.current) tr.className = 'current';
            row.cells.forEach(cell => {
                const td = document.createElement('td');
                td.textContent = cell;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrapper.appendChild(table);
        return wrapper;
    }

    /**
     * ポイント値を表示用文字列に変換（正数は+付き）
     */
    _fmtPts(pts) {
        return pts > 0 ? `+${pts}` : `${pts}`;
    }

    /**
     * 情報オーバーレイを作成
     */
    createInfoOverlay(title) {
        // 既存のオーバーレイを削除
        const existing = document.querySelector('.info-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'info-overlay';
        overlay.innerHTML = `
            <div class="info-overlay-header">
                <span class="info-overlay-title">${title}</span>
                <button class="info-overlay-close">×</button>
            </div>
            <div class="info-overlay-content"></div>
        `;

        overlay.querySelector('.info-overlay-close').addEventListener('click', () => {
            overlay.remove();
        });

        return overlay;
    }

    /**
     * ゲーム状態復元後のUI更新
     */
    restoreUI() {
        window.CDG_DEBUG && console.log('[SAVE-DEBUG] restoreUI: 開始');
        window.CDG_DEBUG && console.log('[SAVE-DEBUG] restoreUI: phase=', this.gameState.phase, ', turn=', this.gameState.turn);
        window.CDG_DEBUG && console.log('[SAVE-DEBUG] restoreUI: currentTrainingCards=', this.gameState.currentTrainingCards?.map(c => c.cardName));
        window.CDG_DEBUG && console.log('[SAVE-DEBUG] restoreUI: hand=', this.gameState.player.hand.map(c => c.cardName));
        window.CDG_DEBUG && console.log('[SAVE-DEBUG] restoreUI: deck=', this.gameState.player.deck.map(c => c.cardName));

        // スタートオーバーレイを非表示
        const overlay = document.getElementById('start-overlay');
        overlay?.classList.add('hidden');

        // 復元中フラグを設定（再保存を防止）
        this.isRestoring = true;

        // ステータスとターン表示を更新
        this.updateStatusDisplay();
        this.updateTurnDisplay();
        this.renderTokenDisplay();

        // 現在のフェーズに応じてUIを表示
        const phase = this.gameState.phase;
        this.showPhaseArea(phase);

        if (phase === 'training') {
            // 研修フェーズの場合は保存された研修カードを描画
            this.restoreTrainingUI();
        } else if (phase === 'action') {
            // 教室行動フェーズの場合
            this.restoreActionUI();
        } else if (phase === 'meeting') {
            // 教室会議フェーズの場合
            this.showMeetingPhase();
        }

        // 復元中フラグを解除
        this.isRestoring = false;

        // 通知フロートを表示
        this.showFloatNotification('前回の続きから再開します', 'info');

        this.logger?.log('UIを復元しました', 'info');
        window.CDG_DEBUG && console.log('[SAVE-DEBUG] restoreUI: 完了');
    }

    /**
     * 研修フェーズUI復元（保存された抽選カードを表示）
     */
    restoreTrainingUI() {
        // gameState.currentTrainingCards から復元
        const trainingCards = this.gameState.currentTrainingCards;
        window.CDG_DEBUG && console.log('[SAVE-DEBUG] restoreTrainingUI: trainingCards=', trainingCards?.map(c => c.cardName));

        if (!trainingCards || trainingCards.length === 0) {
            window.CDG_DEBUG && console.error('[SAVE-DEBUG] restoreTrainingUI: 研修カードが見つかりません！');
            // フォールバック: 新規抽選（本来ありえない）
            this.showInitialTraining();
            return;
        }

        // 発想追加習得フロー中の復元
        if ((this.gameState.tokens?.inspiration ?? 0) > 0) {
            this.trainingSelectionMode = 'inspiration';
            this.inspirationRemaining = this.gameState.tokens.inspiration;
            // showInspirationTrainingRound は currentTrainingCards を再抽選するが、
            // 復元時はすでに保存済みのカードを使う
            const container = document.getElementById('training-cards');
            if (container) {
                container.innerHTML = '';
                trainingCards.forEach(card => {
                    const cardElem = this.createCardElement(card, {
                        clickable: true,
                        compact: true,
                        onClick: (c, elem) => this.onTrainingCardSelect(c, elem, container)
                    });
                    container.appendChild(cardElem);
                });
            }
            const confirmBtn = document.getElementById('confirm-training');
            if (confirmBtn) confirmBtn.disabled = true;
            const instruction = document.querySelector('#training-area .instruction');
            if (instruction) {
                const helpText = this.isShortCardDesc() ? '<span class="help-longpress">[長押しで詳細]</span>' : '';
                instruction.innerHTML = `💡 発想追加習得 (残り${this.inspirationRemaining}回): SRカード3枚から1枚を選んで習得してください${helpText}`;
            }
            this.updateTrainingRefreshUI('SR');
            return;
        }

        // renderTrainingCards を使って描画
        this.renderTrainingCards(trainingCards);
    }

    /**
     * 教室行動フェーズUI復元（手札・配置済みカードを表示）
     */
    restoreActionUI() {
        this.showPhaseArea('action');
        this.updateTurnDisplay();
        this.updateStatusDisplay();
        this.renderTokenDisplay();

        // スタッフスロットをクリア
        this.clearStaffSlots();

        // 配置済みカードを復元
        const placed = this.gameState.player.placed;
        for (const staff of ['leader', 'teacher', 'staff']) {
            for (const card of placed[staff]) {
                this.placeCardToSlot(card, staff);
            }
        }

        this.selectedCardForPlacement = null;

        // 手札表示
        this.renderHand();
        const btnSlotManual = document.getElementById('btn-slot-manual');
        if (btnSlotManual) {
            btnSlotManual.classList.toggle('active', this.slotSelectionMode);
            btnSlotManual.title = this.slotSelectionMode
                ? 'スロット手動指定: ON（カードを選んでからスロットをタップ）'
                : 'スロット手動指定: OFF（タップで自動配置）';
        }
        this.selectedCardForPlacement = null;

        // スタッフスロットにドロップイベント設定
        this.setupDropZones();

        // ボタン状態を更新
        this.updateActionButtonState();
    }

    /**
     * 設定オーバーレイを表示
     */
    showSettingsOverlay() {
        const overlay = this.createInfoOverlay('⚙️ 設定');
        const content = overlay.querySelector('.info-overlay-content');

        const buildVersion = window.BUILD_VERSION || 'unknown';
        const currentFontMode = localStorage.getItem('cdg_font_mode') || 'normal';
        const currentCardDesc = localStorage.getItem('cdg_card_desc') || 'full';

        // バッジ表示判定
        const showTutorialBadge = !localStorage.getItem('cdg_visited');
        const showReleaseBadge = !!localStorage.getItem('cdg_version_updated');

        content.innerHTML = `
            <div class="settings-content">
                <div class="settings-section">
                    <h3>文字サイズ</h3>
                    <div class="font-toggle">
                        <button class="font-toggle-option${currentFontMode === 'small' ? ' active' : ''}" data-mode="small">小さめ</button>
                        <button class="font-toggle-option${currentFontMode === 'normal' ? ' active' : ''}" data-mode="normal">標準</button>
                    </div>
                    <p class="font-toggle-note">変更した文字サイズは次回再読み込み時に適用されます</p>
                </div>
                <div class="settings-section">
                    <h3>カード説明</h3>
                    <div class="font-toggle">
                        <button class="font-toggle-option${currentCardDesc === 'full' ? ' active' : ''}" data-card-desc="full">全文</button>
                        <button class="font-toggle-option${currentCardDesc === 'short' ? ' active' : ''}" data-card-desc="short">短縮</button>
                    </div>
                    <p class="font-toggle-note">短縮表示時は長押しで全文を確認できます</p>
                </div>
                <div class="settings-section">
                    <h3>リンク</h3>
                    <div class="settings-links">
                        <a class="settings-link-btn" href="tutorial.html" id="settings-link-tutorial">
                            📖 遊び方
                            ${showTutorialBadge ? '<span class="notify-badge">！</span>' : ''}
                        </a>
                        <a class="settings-link-btn" href="releaseNote.html" id="settings-link-release">
                            📢 アップデート情報
                            ${showReleaseBadge ? '<span class="notify-badge">！</span>' : ''}
                        </a>
                    </div>
                </div>
                <div class="settings-section">
                    <h3>ビルド情報</h3>
                    <p class="build-version">バージョン: ${buildVersion}</p>
                </div>
                <div class="settings-section">
                    <h3>ゲームリセット</h3>
                    <p class="settings-warning">⚠️ 進行中のゲームデータがすべて削除されます</p>
                    <button id="reset-game-btn" class="btn-danger">はじめからやり直す</button>
                </div>
            </div>
        `;

        // リンククリック時にバッジフラグ更新
        const tutorialLink = content.querySelector('#settings-link-tutorial');
        if (tutorialLink) {
            tutorialLink.addEventListener('click', () => {
                localStorage.setItem('cdg_visited', 'true');
            });
        }
        const releaseLink = content.querySelector('#settings-link-release');
        if (releaseLink) {
            releaseLink.addEventListener('click', () => {
                localStorage.removeItem('cdg_version_updated');
            });
        }

        content.querySelector('#reset-game-btn').addEventListener('click', () => {
            if (confirm('本当にはじめからやり直しますか？\n\n現在の進行状況はすべて失われます。')) {
                this.resetGame();
            }
        });

        // 設定トグルのイベント
        content.addEventListener('click', (e) => {
            const settingsElem = e.currentTarget;

            // data-mode ボタン（文字サイズ）
            const fontBtn = e.target.closest('[data-mode]');
            if (fontBtn) {
                const mode = fontBtn.dataset.mode;
                this.setFontMode(mode);
                settingsElem.querySelectorAll('[data-mode]').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.mode === mode);
                });
            }

            // data-card-desc ボタン（カード説明）
            const cardDescBtn = e.target.closest('[data-card-desc]');
            if (cardDescBtn) {
                const mode = cardDescBtn.dataset.cardDesc;
                this.setCardDesc(mode);
                settingsElem.querySelectorAll('[data-card-desc]').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.cardDesc === mode);
                });
            }
        });

        document.body.appendChild(overlay);
    }

    /**
     * ゲームをリセット（中断データ削除＋リロード）
     */
    resetGame() {
        this.saveManager?.clear();
        this.logger?.log('ゲームをリセットします', 'info');
        location.reload();
    }

    /**
     * ゲーム状態を保存（抽選完了後に呼び出し）
     */
    saveGameState() {
        // 復元中は保存しない
        if (this.isRestoring) return;

        if (this.saveManager) {
            this.saveManager.save(this.gameState, this.cardManager);
        }
    }
}
