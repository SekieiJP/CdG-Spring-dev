/**
 * UIController - UI操作・表示制御
 */
export class UIController {
    constructor(gameState, cardManager, turnManager, scoreManager, logger, saveManager) {
        this.gameState = gameState;
        this.cardManager = cardManager;
        this.turnManager = turnManager;
        this.scoreManager = scoreManager;
        this.logger = logger;
        this.saveManager = saveManager;

        this.selectedTrainingCard = null;
        this.selectedCardsForDeletion = [];
        this.tapMode = true; // タップ順配置モード
    }

    /**
     * UI初期化
     */
    init() {
        this.updateStatusDisplay();
        this.updateTurnDisplay();

        // 文字サイズモードを適用
        this.applyFontMode();

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
        const categoryClass = `category-${card.category}`;

        // おすすめ行動合致チェック
        const isRecommended = options.recommendedCategory && card.category === options.recommendedCategory;
        const recommendedMark = isRecommended ? '🎯' : '';

        // 表示する効果テキスト
        // 標準モードではcompactでもフル表示（topEffect不使用）
        const useCompact = options.compact && !this.isNormalMode();
        const displayEffect = useCompact && card.topEffect ? card.topEffect : card.effect;

        cardDiv.innerHTML = `
            <div class="card-header">
                <span class="card-name">${card.cardName}</span>
            </div>
            <div class="card-meta">
                <span class="card-category-text ${categoryClass}">${card.category}</span>${recommendedMark}
                <span class="card-rarity rarity-${card.rarity}">${card.rarity}</span>
            </div>
            <div class="card-effect">${displayEffect}</div>
        `;

        // 長押しで詳細効果を表示（compactモード時のみ、標準モードでは無効）
        if (!this.isNormalMode() && options.compact && card.topEffect && card.effect !== card.topEffect) {
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
            <div class="tooltip-title">${card.cardName}</div>
            <div class="tooltip-effect">${card.effect}</div>
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
        console.log('[SAVE-DEBUG] showInitialTraining: 開始');

        // フェーズを設定（保存前に必要）
        this.gameState.phase = 'training';

        const trainingCards = this.cardManager.drawTrainingCards('R', 4);
        console.log('[SAVE-DEBUG] showInitialTraining: 抽選カード:', trainingCards.map(c => c.cardName));

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

        const instruction = document.querySelector('#training-area .instruction');
        if (instruction) {
            const helpText = this.isNormalMode() ? '' : '<span class="help-longpress">[長押しで詳細]</span>';
            if (this.gameState.turn === 0) {
                instruction.innerHTML = `初回研修: 4枚から2枚を選んで習得してください${helpText}`;
            } else {
                instruction.innerHTML = `研修: 3枚から1枚を選んで習得してください${helpText}`;
            }
        }
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
        console.log('[SAVE-DEBUG] onConfirmTraining: 開始, turn=', this.gameState.turn);

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
        }

        // 研修カードをクリア（選択済み）
        this.gameState.currentTrainingCards = null;

        // フェーズをtrainingに設定してからadvancePhaseを呼ぶ
        // これによりadvancePhaseがtraining→actionへ正しく遷移する
        this.gameState.phase = 'training';

        this.turnManager.advancePhase();
        this.showActionPhase();

        // 手札ドロー完了直後に保存（再抽選防止）
        console.log('[SAVE-DEBUG] onConfirmTraining: 手札ドロー完了, hand=', this.gameState.player.hand.map(c => c.cardName));
        this.saveGameState();
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

        // 手札表示
        this.renderHand();

        // スタッフスロットにドロップイベント設定
        this.setupDropZones();

        // ボタン状態を更新
        this.updateActionButtonState();
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
            handContainer.appendChild(cardElem);
        });
    }

    /**
     * 手札カードタップ（タップ順配置）
     */
    onHandCardTap(card) {
        const staffOrder = ['leader', 'teacher', 'staff'];

        // 空いている最初のスロットに配置
        for (const staff of staffOrder) {
            if (this.gameState.player.placed[staff].length === 0) {
                this.tryPlaceCardToSlot(card, staff);
                break;
            }
        }
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
                    this.placeCardToSlot(this.draggedCard, staff);
                }
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
        // 未配置スタッフがいる場合は警告
        if (!this.isAllStaffPlaced()) {
            const confirmed = confirm('カードが配置されていないスタッフがいます。教室行動を確定させてよろしいですか？');
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
    showStatusAnimation(beforeStats, afterStats, actionInfo) {
        const overlay = document.getElementById('status-animation-overlay');
        const header = document.getElementById('animation-header');
        const cards = document.getElementById('animation-cards');

        if (!overlay) {
            // 演出要素がなければスキップして次へ進む
            this.finishActionPhase();
            return;
        }

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

        let delay = 300;

        // ターン情報表示
        setTimeout(() => {
            header.innerHTML = `${this.gameState.turn + 1}/8ターン ${config.week}`;
        }, delay);
        delay += 500;

        // おすすめ行動表示
        if (config.recommended) {
            setTimeout(() => {
                header.innerHTML += `<br>🎯 おすすめ行動: ${config.recommended}`;
            }, delay);
            delay += 800;
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

        // アニメーション表示: スタッフ×カード単位で順番に表示
        let animStep = 0;
        staffOrder.forEach(staff => {
            const staffCards = placed[staff]; // 配列
            const cardEffectInfo = actionInfo?.cardEffects?.[staff];
            if (staffCards.length > 0 && cardEffectInfo) {
                const statusName = statusNames[config.recommendedStatus] || config.recommendedStatus;
                staffCards.forEach((card, cardIdx) => {
                    const perCardInfo = cardEffectInfo.cards?.[cardIdx];
                    setTimeout(() => {
                        const categoryColor = categoryColors[card.category] || '#9CA3AF';
                        const categoryBadge = `<span style="background:${categoryColor};color:white;padding:1px 4px;border-radius:4px;font-size:0.7em;margin-left:4px;">${card.category}</span>`;
                        const isRecommended = perCardInfo?.isRecommended || false;
                        const recommendedMark = isRecommended ? ' 🎯' : '';
                        const bonusText = isRecommended ? `<div class="anim-bonus-text">🎯 おすすめボーナス ${statusName}+1</div>` : '';

                        cards.innerHTML = `
                            <div class="animation-card-item">
                                <div class="anim-staff-name">${staffNames[staff]}${staffCards.length > 1 ? ` (${cardIdx + 1}/${staffCards.length})` : ''}</div>
                                <div class="anim-card-name">${card.cardName}${categoryBadge}${recommendedMark}</div>
                                <div class="anim-card-effect">${card.effect}</div>
                                ${bonusText}
                            </div>
                        `;

                        if (perCardInfo) {
                            const delta = this.calculateDelta(perCardInfo.beforeStats, perCardInfo.afterStats);
                            Object.entries(delta).forEach(([key, value]) => {
                                if (currentStats.hasOwnProperty(key)) currentStats[key] += value;
                            });
                            this.updateAnimationStats(currentStats, delta);
                        }
                    }, delay + animStep * 2000);
                    animStep++;
                });
            }
        });
        delay += animStep * 2000;

        // 演出終了（📊行動結果ステップを除去）
        setTimeout(() => {
            overlay.classList.add('hidden');
            this.finishActionPhase();
        }, delay + 500);
    }

    /**
     * アニメーションステータス更新
     */
    updateAnimationStats(stats, delta) {
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

        const config = this.turnManager.getCurrentTurnConfig();
        const deleteCountElem = document.getElementById('delete-count');
        const maxDeleteElem = document.getElementById('max-delete');

        if (deleteCountElem) deleteCountElem.textContent = config.delete;
        if (maxDeleteElem) maxDeleteElem.textContent = config.delete;

        this.selectedCardsForDeletion = [];
        // Bug3修正: 選択済み枚数の表示を0にリセット
        const selectedCountElem = document.getElementById('selected-count');
        if (selectedCountElem) selectedCountElem.textContent = '0';
        this.renderDeck(config.delete);

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
        const config = this.turnManager.getCurrentTurnConfig();
        if (config.delete > 0 && this.selectedCardsForDeletion.length < config.delete) {
            const confirmed = confirm('まだ削除できる枚数が残っています。次のターンに進んでよろしいですか？');
            if (!confirmed) return;
        }

        // カード削除
        this.selectedCardsForDeletion.forEach(card => {
            this.gameState.removeFromDeck(card);
        });

        this.selectedCardsForDeletion = [];

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
        const config = this.turnManager.getCurrentTurnConfig();
        console.log('[SAVE-DEBUG] showTrainingPhase: 開始, turn=', this.gameState.turn, ', training=', config.training);

        // ターン概要オーバーレイを表示
        this.showTurnOverlay(config);

        const trainingCards = this.cardManager.drawTrainingCards(config.training, 3);
        console.log('[SAVE-DEBUG] showTrainingPhase: 抽選カード:', trainingCards.map(c => c.cardName));

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

        const instruction = document.querySelector('#training-area .instruction');
        if (instruction) {
            const helpText = this.isNormalMode() ? '' : '<span class="help-longpress">[長押しで詳細]</span>';
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
        const newCards = this.cardManager.refreshTrainingCards(config.training, currentCards, 3);

        // 残り回数を減らす
        this.gameState.trainingRefreshRemaining = remaining - 1;

        // 新カードで表示を更新
        this.gameState.currentTrainingCards = newCards.map(c => ({ ...c }));
        this.selectedTrainingCard = null;

        const container = document.getElementById('training-cards');
        if (container) {
            container.innerHTML = '';
            newCards.forEach(card => {
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

        this.updateTrainingRefreshUI(config.training);
        this.saveGameState();
        this.logger?.log(`研修リフレッシュ実行: 残り${this.gameState.trainingRefreshRemaining}回`, 'action');
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
                        <tr class="total-row">
                            <td colspan="2">合計スコア</td>
                            <td><strong>${score.displayScore}</strong></td>
                        </tr>
                    </tbody>
                </table>
            `;
        }

        // ハイスコア保存・表示
        const difficulty = this.gameState.difficulty || 'fresh';
        this.scoreManager.saveHighScore(score, difficulty);
        const highScore = this.scoreManager.getHighScore(difficulty);
        const highScoreElem = document.getElementById('high-score');
        if (highScoreElem && highScore) {
            highScoreElem.textContent = `${highScore.displayScore ?? highScore.points}ポイント`;
        }

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
        document.body.appendChild(overlay);
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
        console.log('[SAVE-DEBUG] restoreUI: 開始');
        console.log('[SAVE-DEBUG] restoreUI: phase=', this.gameState.phase, ', turn=', this.gameState.turn);
        console.log('[SAVE-DEBUG] restoreUI: currentTrainingCards=', this.gameState.currentTrainingCards?.map(c => c.cardName));
        console.log('[SAVE-DEBUG] restoreUI: hand=', this.gameState.player.hand.map(c => c.cardName));
        console.log('[SAVE-DEBUG] restoreUI: deck=', this.gameState.player.deck.map(c => c.cardName));

        // スタートオーバーレイを非表示
        const overlay = document.getElementById('start-overlay');
        overlay?.classList.add('hidden');

        // 復元中フラグを設定（再保存を防止）
        this.isRestoring = true;

        // ステータスとターン表示を更新
        this.updateStatusDisplay();
        this.updateTurnDisplay();

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
        console.log('[SAVE-DEBUG] restoreUI: 完了');
    }

    /**
     * 研修フェーズUI復元（保存された抽選カードを表示）
     */
    restoreTrainingUI() {
        // gameState.currentTrainingCards から復元
        const trainingCards = this.gameState.currentTrainingCards;
        console.log('[SAVE-DEBUG] restoreTrainingUI: trainingCards=', trainingCards?.map(c => c.cardName));

        if (!trainingCards || trainingCards.length === 0) {
            console.error('[SAVE-DEBUG] restoreTrainingUI: 研修カードが見つかりません！');
            // フォールバック: 新規抽選（本来ありえない）
            this.showInitialTraining();
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

        // スタッフスロットをクリア
        this.clearStaffSlots();

        // 配置済みカードを復元
        const placed = this.gameState.player.placed;
        for (const staff of ['leader', 'teacher', 'staff']) {
            for (const card of placed[staff]) {
                this.placeCardToSlot(card, staff);
            }
        }

        // 手札表示
        this.renderHand();

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

        // 文字サイズトグルのイベント
        content.querySelectorAll('.font-toggle-option').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setFontMode(btn.dataset.mode);
                // トグルUI更新
                content.querySelectorAll('.font-toggle-option').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
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
