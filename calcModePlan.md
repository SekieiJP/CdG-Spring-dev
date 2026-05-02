# 計算機モード実装プラン

## Context

`calcModeRequirement.txt` に定義された「計算機モード」を実装する。紙製カードでプレイしながらスマートフォンをスコア計算機として使うモード。カード番号をテンキーで入力し、アプリが配置検証・ステータス計算を行う。

---

## 依存関係の把握

### 現状

- `cardNo` は CSV に存在する（6列目: `cards_fresh.csv`, `cards_pro.csv` 共通）が `parseCSV` で読み込まれていない
- 計算機モードは未実装（`cdg_calc_mode` localStorage キーも存在しない）
- `turnManager.TURN_CONFIG` にターン毎の研修レアリティ（`training` フィールド）がある
- `cardManager.parseEffect()` でスタッフ制限（`staffRestrictions[]`）を抽出できる
- `gameState.placeCard(card, staff)` で配置、`returnAllToDeck()` で手札・配置済みをデッキへ戻す
- `finalizeTrainingToAction()` → `turnManager.advancePhase()` → `startActionPhase()`（ドロー） → `showActionPhase()` → `saveGameState()` の順で研修→行動フェーズが遷移

### フェーズ別データフロー（計算機モード）

```
[研修フェーズ]
  通常モード: drawTrainingCards(pool) → カード選択UI → deck.push(card)
  計算機モード: (poolドロー省略) → レアリティ/枚数だけ表示 → No入力 → 検証 → deck.push(card)

[行動フェーズ]
  通常モード: startActionPhase() → hand.push(cards) → 配置UI → placed[staff].push(card)
  計算機モード: startActionPhase() → hand に引いたカードを即座にdeck.push → No入力 → 検証 → deck.pop(card) → placed[staff].push(card)

[会議フェーズ]  共通: deck一覧からカード削除（変更なし）

[アクション実行・アニメーション]  共通: executeActions() → placed のカード効果適用（変更なし）
```

---

## 変更ファイル一覧

| ファイル | 変更の概要 |
|---|---|
| `game/js/cardManager.js` | `parseCSV` で `cardNo` (parts[5]) を読み込み、`getCardByNo()` を追加 |
| `game/js/saveManager.js` | `serializeGameState` に `calcMode`、`serializeCard` に `cardNo` を追加 |
| `game/index.html` | `#start-game` と `.title-links` の間にトグル行 `#calc-mode-row` を追加 |
| `game/css/style.css` | トグルスイッチ・計算機入力フィールドのスタイル追加 |
| `game/js/uiController.js` | 計算機モードの全UI処理（約250行の追加） |
| `game/js/main.js` | キャッシュバスターを `v20260502-2100` に更新 |

---

## 詳細実装手順

### 1. `game/js/cardManager.js`

**`parseCSV()` の変更箇所 (`parts.length >= 5` ブロック)**:
```js
const card = {
    category: parts[0],
    rarity: parts[1],
    cardName: parts[2],
    topEffect: parts[3],
    effect: parts[4],
    cardNo: parts[5] ? parts[5].trim() : null,   // ← 追加
};
```

**追加メソッド**:
```js
getCardByNo(cardNo) {
    const no = parseInt(cardNo, 10);
    if (isNaN(no)) return null;
    return this.allCards.find(c => parseInt(c.cardNo, 10) === no) || null;
}
```

---

### 2. `game/js/saveManager.js`

`serializeGameState` に `calcMode: gameState.calcMode || false` を追加。  
`serializeCard` に `cardNo: card.cardNo || null` を追加。  
`restoreGameState` (line 217 付近) で `gameState.calcMode = savedState.calcMode || false;` を追加。

---

### 3. `game/index.html`

`<button id="start-game" ...>` と `<div class="title-links">` の間に挿入:

```html
<!-- 計算機モード（タイトルをタップで表示） -->
<div id="calc-mode-row" class="calc-mode-row hidden">
    <label class="calc-mode-label">
        🧮 計算機モード
        <label class="toggle-switch">
            <input type="checkbox" id="calc-mode-toggle">
            <span class="toggle-slider"></span>
        </label>
    </label>
</div>
```

---

### 4. `game/css/style.css`

追加 CSS（既存スタイルの末尾または適切な位置に追加）:

```css
/* 計算機モードトグルスイッチ */
.calc-mode-row { display: flex; justify-content: center; margin: 8px 0; }
.calc-mode-label { display: flex; align-items: center; gap: 10px; font-size: 0.9rem; cursor: pointer; }
.toggle-switch { position: relative; display: inline-block; width: 44px; height: 24px; }
.toggle-switch input { display: none; }
.toggle-slider {
    position: absolute; inset: 0; background: #ccc; border-radius: 24px;
    cursor: pointer; transition: background 0.2s;
}
.toggle-slider::before {
    content: ''; position: absolute; width: 20px; height: 20px;
    left: 2px; top: 2px; background: white; border-radius: 50%; transition: transform 0.2s;
}
.toggle-switch input:checked + .toggle-slider { background: var(--color-primary, #4CAF50); }
.toggle-switch input:checked + .toggle-slider::before { transform: translateX(20px); }

/* 計算機モード入力フィールド */
.calc-input-group { width: 100%; padding: 8px 0; }
.calc-slot-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.calc-slot-row label { font-size: 0.85rem; color: var(--color-text-secondary); }
.calc-card-input {
    font-size: 1.5rem; letter-spacing: 0.15em; text-align: center;
    width: 100%; padding: 12px; border: 2px solid var(--color-primary, #4CAF50);
    border-radius: 8px; background: var(--color-bg-card, white);
    color: var(--color-text);
}
.calc-validate-msg { font-size: 0.8rem; color: #e53935; min-height: 1.2em; }
```

---

### 5. `game/js/uiController.js`

#### (a) `setupEventListeners()` に追加（既存リスナー群の末尾付近）:

```js
// 計算機モードトグル
const calcToggle = document.getElementById('calc-mode-toggle');
if (calcToggle) {
    calcToggle.checked = localStorage.getItem('cdg_calc_mode') === 'true';
    calcToggle.addEventListener('change', () => {
        localStorage.setItem('cdg_calc_mode', calcToggle.checked ? 'true' : 'false');
    });
}
// タイトルクリックでトグル行を表示
const titleH1 = document.querySelector('#start-overlay h1');
if (titleH1) {
    titleH1.style.cursor = 'pointer';
    titleH1.addEventListener('click', () => {
        document.getElementById('calc-mode-row')?.classList.remove('hidden');
    });
}
```

#### (b) `onStartGame()` — `this.gameState.difficulty = difficulty;` の直後:

```js
this.gameState.calcMode = document.getElementById('calc-mode-toggle')?.checked || false;
```

#### (c) `onConfirmTraining()` の冒頭:

```js
if (this.gameState.calcMode) { this.confirmCalcTraining(); return; }
```

#### (d) `showInitialTraining()` — `this.renderTrainingCards(trainingCards);` の直前:

```js
if (this.gameState.calcMode) { this.showCalcTrainingUI('R', 2); return; }
```
（この場合 `currentTrainingCards` への保存や `drawTrainingCards` 呼び出しは不要なのでそれより前にも return できるが、`showPhaseArea('training')` / `updateStatusDisplay()` は必要なので整理が必要）

実際の挿入位置: `renderTrainingCards(trainingCards)` 呼び出しを `this.gameState.calcMode` でガードし、calc mode 時は代替描画メソッドを呼ぶ。

#### (e) `showTrainingPhase()` — `this.renderTrainingCards(trainingCards)` の直前:

同様に `if (this.gameState.calcMode) { this.showCalcTrainingUI(config.training, 1); return; }` で分岐。  
注意: `showTurnOverlay(config)` は calc mode でも表示する（ターン情報として有益）ので、その後に分岐する。

#### (f) `showActionPhase()` の冒頭:

```js
if (this.gameState.calcMode) {
    // startActionPhase() がドローした手札をデッキに戻す
    if (this.gameState.player.hand.length > 0) {
        this.gameState.player.deck.push(...this.gameState.player.hand);
        this.gameState.player.hand = [];
    }
    this._showActionPhaseCalcUI();
    return;
}
```

#### (g) `restoreTrainingUI()` の冒頭:

```js
if (this.gameState.calcMode) {
    this.showCalcTrainingUI(
        this.gameState.turn === 0 ? 'R' : this.turnManager.getCurrentTurnConfig()?.training,
        this.gameState.turn === 0 ? 2 : 1
    );
    return;
}
```

#### (h) `restoreActionUI()` の冒頭:

```js
if (this.gameState.calcMode) { this._showActionPhaseCalcUI(); return; }
```

---

#### 新規メソッド群（uiController.js の末尾付近に追加）:

```js
/**
 * 計算機モード: 研修UI表示
 * @param {string} rarity - 'R'|'SR'|'SSR'
 * @param {number} count - 取得枚数
 */
showCalcTrainingUI(rarity, count) {
    this.showPhaseArea('training');
    this.updateTurnDisplay();
    this.updateStatusDisplay();
    this.renderTokenDisplay();

    document.getElementById('btn-training-skip')?.classList.add('hidden');
    document.getElementById('btn-training-refresh')?.classList.add('hidden');

    const container = document.getElementById('training-cards');
    if (!container) return;
    container.innerHTML = '';

    const instr = document.querySelector('#training-area .instruction');
    if (instr) instr.textContent = `${rarity}カード ${count}枚を習得（カードNoを入力）`;

    const group = document.createElement('div');
    group.className = 'calc-input-group';
    for (let i = 0; i < count; i++) {
        group.innerHTML += `
            <div class="calc-slot-row">
                <label>${i + 1}枚目 ${rarity}カードNo${count === 1 ? '（空欄=スキップ）' : ''}</label>
                <input id="calc-train-${i}" class="calc-card-input" type="text"
                       inputmode="numeric" maxlength="6" placeholder="例: 05" autocomplete="off">
                <span class="calc-validate-msg" id="calc-train-msg-${i}"></span>
            </div>`;
    }
    container.appendChild(group);

    const confirmBtn = document.getElementById('confirm-training');
    if (confirmBtn) confirmBtn.disabled = false;

    this._calcTrainingRarity = rarity;
    this._calcTrainingCount = count;
}

/**
 * 計算機モード: 研修確定
 */
confirmCalcTraining() {
    const rarity = this._calcTrainingRarity;
    const count = this._calcTrainingCount;
    const isInitial = this.gameState.turn === 0;
    const cards = [];

    for (let i = 0; i < count; i++) {
        const input = document.getElementById(`calc-train-${i}`);
        const msgElem = document.getElementById(`calc-train-msg-${i}`);
        const val = input?.value.trim() || '';

        if (!val) {
            if (isInitial) {
                if (msgElem) msgElem.textContent = '初回研修は必須入力です';
                return;
            }
            continue; // skip
        }

        const result = this._validateCalcTrainingInput(val, rarity);
        if (!result.valid) {
            if (msgElem) msgElem.textContent = result.error;
            return;
        }
        if (msgElem) msgElem.textContent = '';
        result.cards.forEach(c => cards.push(c));
    }

    cards.forEach(card => {
        this.gameState.addToDeck({ ...card, acquiredTurn: this.gameState.turn });
    });

    // 発想トークン追加習得（calc mode: 追加フィールドを動的表示）
    const inspiration = this.gameState.tokens?.inspiration ?? 0;
    if (inspiration > 0) {
        this.gameState.tokens.inspiration = 0;
        this._showCalcInspirationInputs(inspiration, 0, []);
        return;
    }

    this.gameState.currentTrainingCards = null;
    this.finalizeTrainingToAction();
}

/**
 * 計算機モード: 発想トークン追加習得 (SR) 入力
 */
_showCalcInspirationInputs(total, done, acquired) {
    const container = document.getElementById('training-cards');
    if (!container) return;
    container.innerHTML = '';

    const instr = document.querySelector('#training-area .instruction');
    if (instr) instr.textContent = `発想トークン: SRカード ${total - done}枚を追加習得`;

    const group = document.createElement('div');
    group.className = 'calc-input-group';
    for (let i = 0; i < (total - done); i++) {
        group.innerHTML += `
            <div class="calc-slot-row">
                <label>${done + i + 1}枚目 SRカードNo</label>
                <input id="calc-inspiration-${i}" class="calc-card-input" type="text"
                       inputmode="numeric" maxlength="6" placeholder="例: 15" autocomplete="off">
                <span class="calc-validate-msg" id="calc-insp-msg-${i}"></span>
            </div>`;
    }
    container.appendChild(group);

    const confirmBtn = document.getElementById('confirm-training');
    if (confirmBtn) {
        confirmBtn.onclick = null;
        confirmBtn.addEventListener('click', () => {
            this._confirmCalcInspiration(total, done, acquired);
        }, { once: true });
    }
}

_confirmCalcInspiration(total, done, acquired) {
    const remaining = total - done;
    const cards = [];
    for (let i = 0; i < remaining; i++) {
        const input = document.getElementById(`calc-inspiration-${i}`);
        const msgElem = document.getElementById(`calc-insp-msg-${i}`);
        const val = input?.value.trim() || '';
        if (!val) { if (msgElem) msgElem.textContent = '必須入力です'; return; }
        const result = this._validateCalcTrainingInput(val, 'SR');
        if (!result.valid) { if (msgElem) msgElem.textContent = result.error; return; }
        if (msgElem) msgElem.textContent = '';
        result.cards.forEach(c => cards.push(c));
    }
    cards.forEach(card => {
        this.gameState.addToDeck({ ...card, acquiredTurn: this.gameState.turn });
    });
    this.gameState.currentTrainingCards = null;
    this.finalizeTrainingToAction();
}

/**
 * 計算機モード: 行動フェーズUI表示
 */
_showActionPhaseCalcUI() {
    this.showPhaseArea('action');
    this.updateTurnDisplay();
    this.updateStatusDisplay();
    this.clearStaffSlots();
    this.gameState.clearPlaced();
    this.renderDrawNotification();
    this.renderTokenDisplay();
    this.selectedCardForPlacement = null;

    const handContainer = document.getElementById('hand-cards');
    if (handContainer) handContainer.innerHTML = '';

    const instr = document.querySelector('#action-area .instruction');
    if (instr) instr.textContent = '各スタッフに配置するカードのNoを入力（空欄=配置なし）';

    const staffDefs = [
        { key: 'leader', label: '室長' },
        { key: 'teacher', label: '講師' },
        { key: 'staff', label: '事務' },
    ];
    staffDefs.forEach(({ key, label }) => {
        const slot = document.getElementById(`slot-${key}`);
        if (!slot) return;
        slot.innerHTML = `
            <div class="calc-slot-input-container">
                <label style="font-size:0.8rem;color:var(--color-text-secondary)">${label}へのカードNo（空欄=なし）</label>
                <input id="calc-slot-${key}" class="calc-card-input" type="text"
                       inputmode="numeric" maxlength="8" placeholder="例: 12" autocomplete="off">
                <span class="calc-validate-msg" id="calc-slot-msg-${key}"></span>
            </div>`;
    });

    const confirmBtn = document.getElementById('confirm-action');
    if (confirmBtn) confirmBtn.disabled = false;
}

/**
 * 計算機モード: アクション確定（confirm-action ボタンから呼ばれる前に分岐）
 * onConfirmAction() の冒頭で calcMode チェックが必要
 */
confirmCalcAction() {
    const staffKeys = ['leader', 'teacher', 'staff'];
    const placements = {};

    for (const staff of staffKeys) {
        const input = document.getElementById(`calc-slot-${staff}`);
        const msgElem = document.getElementById(`calc-slot-msg-${staff}`);
        const val = input?.value.trim() || '';

        if (!val) { placements[staff] = []; if (msgElem) msgElem.textContent = ''; continue; }

        const result = this._validateCalcPlacementInput(val, staff);
        if (!result.valid) { if (msgElem) msgElem.textContent = result.error; return; }
        if (msgElem) msgElem.textContent = '';
        placements[staff] = result.cards;
    }

    const totalPlaced = Object.values(placements).reduce((s, a) => s + a.length, 0);
    if (totalPlaced === 0) {
        if (!confirm('カードを1枚も配置していません。このまま行動を決定しますか？')) return;
    }

    staffKeys.forEach(staff => {
        placements[staff].forEach(deckCard => {
            const idx = this.gameState.player.deck.indexOf(deckCard);
            if (idx > -1) this.gameState.player.deck.splice(idx, 1);
            this.gameState.placeCard(deckCard, staff);
        });
    });

    // executeActions + animation は通常フローを再利用
    const beforeStats = {
        experience: this.gameState.player.experience,
        enrollment: this.gameState.player.enrollment,
        satisfaction: this.gameState.player.satisfaction,
        accounting: this.gameState.player.accounting,
    };
    const actionInfo = this.turnManager.executeActions();
    const afterStats = {
        experience: this.gameState.player.experience,
        enrollment: this.gameState.player.enrollment,
        satisfaction: this.gameState.player.satisfaction,
        accounting: this.gameState.player.accounting,
    };
    this.showStatusAnimation(beforeStats, afterStats, actionInfo);
}

_validateCalcTrainingInput(inputStr, expectedRarity) {
    const cleaned = inputStr.replace(/\s/g, '');
    if (cleaned.length === 0) return { valid: true, cards: [] };
    if (cleaned.length % 2 !== 0)
        return { valid: false, error: '2桁の数字で入力してください' };

    const nos = [];
    for (let i = 0; i < cleaned.length; i += 2) nos.push(cleaned.slice(i, i + 2));

    const cards = [];
    for (const no of nos) {
        const card = this.cardManager.getCardByNo(no);
        if (!card) return { valid: false, error: `カードNo ${no} は存在しません` };
        if (card.rarity !== expectedRarity)
            return { valid: false, error: `カードNo ${no} は${card.rarity}カードです（期待: ${expectedRarity}）` };
        cards.push(card);
    }

    const counts = {};
    nos.forEach(n => { counts[n] = (counts[n] || 0) + 1; });
    for (const [no, cnt] of Object.entries(counts)) {
        const existing = this.gameState.player.deck.filter(c => parseInt(c.cardNo, 10) === parseInt(no, 10)).length;
        if (existing + cnt > 2)
            return { valid: false, error: `カードNo ${no} はデッキに2枚まです` };
    }

    return { valid: true, cards };
}

_validateCalcPlacementInput(inputStr, targetStaff) {
    const cleaned = inputStr.replace(/\s/g, '');
    if (cleaned.length === 0) return { valid: true, cards: [] };
    if (cleaned.length % 2 !== 0)
        return { valid: false, error: '2桁の数字で入力してください' };

    const nos = [];
    for (let i = 0; i < cleaned.length; i += 2) nos.push(cleaned.slice(i, i + 2));

    const staffNames = { leader: '室長', teacher: '講師', staff: '事務' };
    const cards = [];

    for (const no of nos) {
        const card = this.cardManager.getCardByNo(no);
        if (!card) return { valid: false, error: `カードNo ${no} は存在しません` };

        const parsed = this.cardManager.parseEffect(card.effect);
        if (parsed.staffRestrictions.length > 0 && !parsed.staffRestrictions.includes(targetStaff))
            return { valid: false, error: `カードNo ${no} は${parsed.staffRestrictions.map(s => staffNames[s]).join('/')}専用です` };

        const deckCard = this.gameState.player.deck.find(c => parseInt(c.cardNo, 10) === parseInt(no, 10));
        if (!deckCard) return { valid: false, error: `カードNo ${no} はデッキにありません` };

        const hasParallel = card.effect.includes('並行');
        if (!hasParallel && this.gameState.player.placed[targetStaff].length > 0)
            return { valid: false, error: `カードNo ${no} には並行効果がなく、スロットは埋まっています` };

        cards.push(deckCard);
    }
    return { valid: true, cards };
}
```

#### `onConfirmAction()` の冒頭に分岐追加:

```js
onConfirmAction() {
    if (this.gameState.calcMode) { this.confirmCalcAction(); return; }
    // ... existing code
}
```

---

### 6. `game/js/main.js`

キャッシュバスターを `v20260502-2100` に統一（全6箇所のインポートパス + `CACHE_BUSTER` 定数 + `index.html` の CSS/JS 読み込み URL）。

---

## データフロー図

```
タイトル画面
  h1クリック → #calc-mode-row を表示
  トグルON/OFF → localStorage('cdg_calc_mode')

ゲーム開始
  onStartGame() → gameState.calcMode = toggle.checked

研修フェーズ
  showInitialTraining() / showTrainingPhase()
    ├─[calcMode=false] → drawTrainingCards() → カード選択UI
    └─[calcMode=true]  → showCalcTrainingUI(rarity, count) → No入力UI

  onConfirmTraining()
    ├─[calcMode=false] → 既存処理
    └─[calcMode=true]  → confirmCalcTraining() → 検証 → deck.push → finalizeTrainingToAction()

行動フェーズ
  showActionPhase()
    ├─[calcMode=false] → renderHand() → 配置UI
    └─[calcMode=true]  → hand→deck戻し → _showActionPhaseCalcUI()
                              ├─[slotSelectionMode=false] 手札エリアに1入力欄 + 配置ボタン
                              └─[slotSelectionMode=true]  各スロットに1入力欄（並行対応）

  _calcAutoPlace()  ← 自動配置モード: 入力確定ごとに findBestSlot() で即時配置

  onConfirmAction()
    ├─[calcMode=false] → 既存処理
    └─[calcMode=true]  → confirmCalcAction()
                              ├─[slotSelectionMode=false] → placed設定済み → _execActionAndAnimate()
                              └─[slotSelectionMode=true]  → 一括検証・配置 → _execActionAndAnimate()

  _execActionAndAnimate() → executeActions() → showStatusAnimation() → finishActionPhase()

  toggleSlotSelectionMode()
    ├─[calcMode=false] → 既存処理
    └─[calcMode=true]  → _showActionPhaseCalcUI() で入力UI再描画

会議フェーズ → 共通（変更なし）

セーブ/リストア
  saveManager.serializeGameState() → calcMode, cardNo を含む
  restoreTrainingUI() / restoreActionUI() → calcMode チェックで適切なUI表示
```

---

## 検証方法

1. **トグル表示**: `index.html` を開き、「カードで学習塾」タイトル（`h1`）をタップ → `#calc-mode-row` が出現する
2. **トグル永続化**: ON にしてページ再読み込み → ON 状態が維持される
3. **研修フェーズ（通常難易度）**: 計算機モードONでゲーム開始 → 研修画面にカード選択UIではなく入力フィールドが表示される
4. **バリデーション**: 存在しない `99` を入力 → エラーメッセージ表示。正しいカードNo を入力 → エラーなし
5. **行動フェーズ**: 入力フィールドで有効な配置 → アクション実行アニメーション → 次フェーズへ進む
6. **セーブ/リストア**: 計算機モードゲーム中にリロード → 同じフェーズの計算機UIが復元される
7. **通常モード非影響**: 計算機モードOFFでは既存の動作に変化なし
