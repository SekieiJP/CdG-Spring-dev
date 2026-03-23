# PRO難易度追加 設計仕様書

本ドキュメントは、難易度「PRO」追加に必要な仕様を整理したものです。
質問事項はすべて回答済みで、確定仕様として記載しています。

---

## 1. コードベース分析結果

### 各ファイルの機能と難易度影響度

| ファイル | 機能 | 難易度追加時の影響度 | 改修概要 |
|---|---|---|---|
| `main.js` | エントリーポイント。カードCSV読込パス指定・ゲーム初期化・セーブ復元 | **高** | 難易度に応じたCSVパス切替・難易度選択フロー追加 |
| `gameState.js` | プレイヤーステータス管理（体験・入塾・満足・経理）・デッキ/手札操作 | **高** | 難易度フィールド追加・初期値分岐（経理の初期値変更）・トークン管理・リフレッシュ回数管理 |
| `cardManager.js` | CSV読込・効果テキストのパース・研修プール管理・カード効果適用 | **最高** | 難易度別CSV読込・新効果キーワード（情熱/発想/整理/並行/疲労）のパーサー拡張・研修リフレッシュ対応 |
| `turnManager.js` | ターン設定（8ターン固定）・フェーズ遷移・アクション実行 | **中** | ターン設定の難易度別定義・トークン消費ロジック（ドロー枚数/候補枚数/削除上限の動的変更） |
| `scoreManager.js` | スコア計算・ランク判定・ハイスコア保存/読込 | **最高** | スコア計算式の難易度別分岐・FRESHのS+計算（満点10）・PROの目標値変更・ハイスコアの難易度別管理 |
| `uiController.js` | 全UI制御（全68メソッド）。研修/行動/会議/結果画面の描画 | **最高** | 難易度選択UI・結果画面の得点表示変更・研修リフレッシュUI・ステータス画面の目標表示・新効果アイコン表示 |
| `saveManager.js` | ゲーム状態のLocalStorage永続化・復元 | **中** | セーブデータに難易度フィールド追加・トークン/リフレッシュ回数の保存復元 |
| `logger.js` | ゲームログ出力 | **低** | 変更不要（新効果のログは各マネージャーが出力） |

---

## 2. 難易度選択フロー 【確定】

- **選択タイミング**: タイトル画面（「ゲーム開始」ボタンの前）に配置
- **解放条件**: PRO難易度は**初回から選択可能**
- **初訪問者向けガイド**: ページに初めてアクセスする人（`cdg_visited` が未設定の人）には、FRESH難易度に吹き出しで **「初めての方はこちらに挑戦」** と表示する
  - 判定条件は既存の「遊び方」ボタンのバッジ表示と同一（`!localStorage.getItem('cdg_visited')`）

---

## 3. カードプール設計 【確定】

### CSVファイル管理
- **別ファイル方式**を採用: `data/cards_fresh.csv`, `data/cards_pro.csv`
- 両難易度で共通のカードが存在しても、それぞれのCSVファイルに個別記載する
- カード名が同じでも、難易度ごとに効果テキストが異なる場合がある

### 基本カード（N）【仕様変更 2026-03-23】
- 初期デッキは「CSVファイルのNレアリティのカードをすべて選択して構成する」（FRESH・PRO共通）
  - CSVに同一カードが複数行あれば、その行数分すべて選択する（2枚複製はしない）
  - 現在のCSVはFRESH・PROともにNカード4行 → 初期デッキは**4枚**
  - 将来CSVでN行を増やせば初期デッキ枚数が増える
- **NカードのテキストもPROでは変更される**

### 「疲れ」カード → **廃止**
「疲労」効果はデッキにカードを追加する方式から、手札ドロー枚数-1のトークン方式に変更されたため、「疲れ」カードは不要となった。

---

## 4. スコア計算 【確定】

### FRESHのS+スコア計算式（満点8→10引上げ）

```
ランクSまで: 現在と同じ（観点別スコアの合計、最大8）
S+条件: 退塾0 かつ 体験15以上 かつ 入塾15以上

S+スコア = 8 + 0.5×(体験-15)÷15 + 1.5×(入塾-15)÷15
  ※体験・入塾はそれぞれ上限30
  ※満点 = 10（体験30, 入塾30のとき）
```

### S+スコアの表示ルール
- **小数点以下1桁**を表示
- **四捨五入**

### PROのスコア計算
- 各目標値（退塾/体験/入退差の各閾値）と配点は**後日提供**
- ランク体系: E〜S+の**アルファベットは同じ種類**だが、**閾値は変更**される

---

## 5. 新カード効果 【確定】

### トークン（チップ）方式
新効果は**トークン（チップ）を獲得**する形で表現される。トークンは該当フェーズが到来した時に発動し、**発動後に破棄**される。
チップは手札エリアの上に表示される。

### 効果一覧と発動タイミング

| 効果名 | アイコン | トークン獲得タイミング | 発動タイミング | 効果 | 累積 |
|---|---|---|---|---|---|
| 情熱 | ✊ | 行動フェーズ（カード効果適用時） | **次のターン**の行動フェーズ（手札を引く時） | 手札ドロー枚数+1 | ✅ |
| 発想 | 💡 | 行動フェーズ（カード効果適用時） | **次のターン**の研修フェーズ | R,SR,SSR各1枚から1枚を追加習得 | ✅ |
| 整理 | 🚥 | 行動フェーズ（カード効果適用時） | **同じターン**の教室会議フェーズ | カード削除最大枚数+1 | ✅ |
| 並行 | 🤹 | - | 即時（配置時に判定） | カード配置済みスタッフにも配置可 | - |
| 疲労 | 💤 | 行動フェーズ（カード効果適用時） | **次のターン**の行動フェーズ（手札を引く時） | 手札ドロー枚数-1 | ✅ |

### トークン効果の詳細仕様 【確定】

#### 数量表現
- 各トークン効果は1回の発動で**+1固定**
- +2以上の効果は、同一キーワードを複数回記述することで表す
  - 例: カード効果テキストに `✊情熱` が2回登場 → 情熱トークン+2

#### 情熱・疲労のドロー枚数
- 発動式: `drawCount = Math.max(0, 4 + 情熱トークン数 - 疲労トークン数)`
- 疲労が重なりドロー枚数が0枚になることを認める（手札0枚でも可）
- 最終ターン（ターン8）に獲得した情熱・疲労は次ターンがないため**消滅**する

#### 整理の削除枚数
- 発動式: `maxDelete = config.delete + 整理トークン数`
- `config.delete === 0` のターン（通常は最終ターン）に整理トークンがある場合:
  - 最終ターン（ターン8）: 会議フェーズは開かない（整理トークンは消滅）
  - それ以外のターン: 会議フェーズを開く（削除枚数 = 0 + 整理トークン数）

#### 発想の追加習得フロー
1. 通常の研修（例: Rカード3枚から1枚選択）を完了
2. 発想トークンの数だけ以下を繰り返す:
   - R・SR・SSRの各研修候補デッキから1枚ずつ抽選（合計3枚提示）
   - プレイヤーが1枚選択してデッキに加える
   - 提示した3枚は研修候補デッキから除外
3. 発想トークンをリセット

#### 並行の重ね配置
- 1スロットに配置できる枚数の上限なし（無制限）
- 重ね配置されたカードはすべて効果を発動する
- 並行効果を持つカードにも職種制限【】は適用される

### ［並行］の実装影響 【確定】
- 並行を持つカードは、既にカードが配置されているスタッフ枠にも配置できる
- 1スロットに複数枚配置可能（上限なし）
- `gameState.player.placed` の構造変更が必要:
  ```javascript
  // 現在: { leader: null, teacher: null, staff: null }
  // 変更後: { leader: [], teacher: [], staff: [] }
  ```
- 影響範囲: `gameState.placeCard()`, `turnManager.executeActions()`, `uiController` の配置関連メソッド全般

### 行動決定ボタンの挙動 【確定】
- 未配置スロットがあっても、または配置できるカードが手札に残っていても「行動決定」は押せる
- ただし以下の条件で**確認ダイアログ**を表示する:
  - 未配置スロットが1つ以上ある場合
  - 手札にまだ配置可能なカードが残っている場合（未配置スロット数 > 0 の場合と同義）
- ダイアログ文言例: 「まだ配置できるカードがあります。このまま行動を決定しますか？」

### スロット指定モード（手動配置）【確定】
- 配置スロット直上に「⊞ スロット指定」トグルボタンを設置
- **オフ（デフォルト）**: 手札カードをタップ → 空きスロットに自動配置（室長→講師→事務の優先順）
- **オン**: 2ステップ配置
  1. 手札カードをタップ → そのカードをハイライト
  2. 配置したいスロットをタップ → 配置実行
  - ハイライト中に別のカードをタップ → 選択を切り替え
  - ハイライト中のカードを再タップ → キャンセル
- ドラッグ&ドロップはモード問わず従来通り使用可能
- モードはターンをまたいで保持。ゲーム開始時はオフ

---

## 5-A. 研修候補デッキ枯渇時の再構成 【確定・FRESH/PRO共通】

- 各レアリティ（R/SR/SSR）の研修候補デッキが0枚になった場合:
  - そのレアリティの**捨て札**（これまでプールから除外されたカード）をシャッフルしてデッキを再構成する
  - 再構成後、通常通り抽選を続行する
- 捨て札は各レアリティごとに `trainingDiscards: { R: [], SR: [], SSR: [] }` で管理する
- `drawTrainingCards()` でカードをプールから除外する際、捨て札に追加する
- 再構成はFRESH・PRO共通の仕様

---

## 6. 研修リフレッシュ 【確定】

### 操作フロー
1. 研修画面を表示（候補カードが3枚出現）
2. プレイヤーが「リフレッシュ」ボタンを押す
3. 表示中の3枚を**ゲームから永久除外**し、新しい3枚を抽選して表示
4. リフレッシュされた3枚から1枚を選択

### ボタン表示条件
- リフレッシュ残り回数が**0**のとき → ボタン**非表示**
- プレイ中の難易度に研修リフレッシュ機能がない場合（FRESHなど） → ボタン**非表示**

### 残り回数の表示場所
1. **研修画面**: リフレッシュボタンの隣に表示
2. **デッキ一覧画面**: 下部に「残り研修リフレッシュ回数: N」と表示

---

## 7. ステータス画面の目標表示 【確定】

### 対象難易度
- **FRESHにも追加する**（両難易度共通の機能）

### 表示要素

**体験・入塾**（3要素を並列表示）:
1. `C` — 現在の項目別ランク（ランクアルファベットは難易度別に後日提供）
2. 細いプログレスバー — 前の閾値を0%、次の閾値を100%とする
3. `あと4` — 次の目標ランクに達するまでの数値

**経理・満足**（2要素を並列表示）:
1. 細いプログレスバー — 前の閾値を0%、次の閾値を100%とする
2. `あと4` — 次の目標ランクに達するまでの数値

> ランクアルファベット・閾値は難易度別に後日提供される。

---

## 8. データ構造の設計案

### 8.1 難易度設定（新規: `difficultyConfig.js`）

```javascript
export const DIFFICULTY_CONFIG = {
    FRESH: {
        id: 'fresh',
        name: 'FRESH',
        csvPath: 'data/cards_fresh.csv',
        initialStatus: {
            experience: 0,
            enrollment: 0,
            satisfaction: 3,
            accounting: 3
        },
        scoreConfig: {
            maxScore: 10,       // S+満点
            splusEnabled: true, // S+ボーナス計算
            // sランク閾値・目標閾値は現行と同一
        },
        turnConfig: [ /* 現在の TURN_CONFIG と同一 */ ],
        trainingRefresh: { enabled: false },
        goalDisplay: { enabled: true },  // 目標表示（両難易度共通）
    },
    PRO: {
        id: 'pro',
        name: 'PRO',
        csvPath: 'data/cards_pro.csv',
        initialStatus: {
            experience: 0,
            enrollment: 0,
            satisfaction: 3,
            accounting: 5  // 経理の初期値が高い
        },
        scoreConfig: {
            maxScore: 10, // PROの満点（後日確定）
            // 各閾値は後日提供
        },
        turnConfig: [ /* PROのターン設定（後日確定） */ ],
        trainingRefresh: { enabled: true, maxCount: 2 },
        goalDisplay: { enabled: true },
    }
};
```

### 8.2 `gameState.js` への追加フィールド

```javascript
reset(difficultyId = 'fresh') {
    this.difficulty = difficultyId;
    const config = DIFFICULTY_CONFIG[difficultyId.toUpperCase()];

    this.player = {
        experience: config.initialStatus.experience,
        enrollment: config.initialStatus.enrollment,
        satisfaction: config.initialStatus.satisfaction,
        accounting: config.initialStatus.accounting,
        deck: [],
        hand: [],
        placed: {
            // 並行効果対応: 配列に変更
            leader: [],
            teacher: [],
            staff: []
        }
    };

    // トークン管理（新効果用）
    this.tokens = {
        passion: 0,      // ✊ 情熱: 次ターンのドロー+N
        inspiration: 0,  // 💡 発想: 次ターンの研修でR,SR,SSR各1枚から1枚を追加習得×N回
        organize: 0,     // 🚥 整理: 同ターンの会議削除上限+N
        fatigue: 0,      // 💤 疲労: 次ターンのドロー-N
    };

    // 研修リフレッシュ残り回数
    this.trainingRefreshRemaining = config.trainingRefresh.enabled
        ? config.trainingRefresh.maxCount : 0;

    this.turn = 0;
    this.phase = 'start';
}
```

### 8.3 `cardManager.js` のパーサー拡張案

```javascript
parseEffectPart(effectText, statusMap) {
    const effects = [];

    // 既存: set / change 効果
    // ...

    // 新規: トークン効果キーワード
    const tokenEffects = {
        '情熱': { type: 'token', token: 'passion' },
        '発想': { type: 'token', token: 'inspiration' },
        '整理': { type: 'token', token: 'organize' },
        '疲労': { type: 'token', token: 'fatigue' },
    };

    // 新規: 即時特殊効果
    const immediateEffects = {
        '並行': { type: 'immediate', effect: 'parallel' },
    };

    for (const [keyword, effectDef] of Object.entries(tokenEffects)) {
        if (effectText.includes(keyword)) {
            effects.push({ ...effectDef });
        }
    }
    for (const [keyword, effectDef] of Object.entries(immediateEffects)) {
        if (effectText.includes(keyword)) {
            effects.push({ ...effectDef });
        }
    }

    return effects;
}
```

### 8.4 トークン消費タイミングの実装

```javascript
// turnManager.js
startActionPhase() {
    // 情熱・疲労トークン消費: ドロー枚数を増減
    const passionBonus = this.gameState.tokens.passion;
    const fatiguePenalty = this.gameState.tokens.fatigue;
    const drawCount = Math.max(1, 4 + passionBonus - fatiguePenalty);
    this.gameState.drawCards(drawCount);
    if (passionBonus > 0) {
        this.logger?.log(`✊ 情熱発動: ドロー+${passionBonus}`, 'action');
        this.gameState.tokens.passion = 0;
    }
    if (fatiguePenalty > 0) {
        this.logger?.log(`💤 疲労発動: ドロー-${fatiguePenalty}`, 'action');
        this.gameState.tokens.fatigue = 0;
    }
}

// 研修フェーズ開始時
// 発想トークン消費: R,SR,SSR各1枚から1枚を追加習得（発想トークン数だけ繰り返す）
const inspirationCount = gameState.tokens.inspiration;
if (inspirationCount > 0) {
    // 通常の研修に加えて、発想トークン数だけ追加の習得フェーズを実行
    // 各回: R,SR,SSR各1枚を提示 → プレイヤーが1枚選択
    gameState.tokens.inspiration = 0;
}

// turnManager.startMeetingPhase() 呼び出し時
// 整理トークン消費: 削除上限に加算
const organizeBonus = gameState.tokens.organize;
const maxDelete = config.delete + organizeBonus;
if (organizeBonus > 0) {
    gameState.tokens.organize = 0;
}
```

### 8.5 ハイスコアの難易度別管理

```javascript
// 現在: localStorage キー = 'bdrinkai_highscore'
// 変更後: 'bdrinkai_highscore_fresh' / 'bdrinkai_highscore_pro' に分離
getHighScoreKey(difficulty) {
    return `bdrinkai_highscore_${difficulty}`;
}
```

---

## 9. 後日提供が必要なデータ

以下のデータは後日提供を待って実装する:

| 項目 | 内容 |
|---|---|
| PRO目標値 | 退塾/体験/入退差の各閾値と配点 |
| PROランク閾値 | 各ランク（E〜S+）に必要なポイント数 |
| FRESH目標ランクアルファベット | ステータス画面で表示する項目別ランク名 |
| PRO目標ランクアルファベット | 同上（PRO版） |
| PROターン設定 | ターンごとの研修レアリティ・おすすめ行動・削除枚数 |

---

## 10. 改訂箇所まとめ（優先度順）

### Phase 1: 基盤（難易度切替の骨格） — ✅完了
1. `difficultyConfig.js` 新規作成（難易度設定の一元管理） ✅
2. `gameState.js` に `difficulty` フィールド追加、初期値の難易度分岐 ✅
3. `main.js` に難易度に応じたCSVパス切替ロジック追加 ✅
4. `saveManager.js` にセーブデータの難易度フィールド追加 ✅
5. `uiController.js` に難易度選択UI追加（タイトル画面、初訪問者向けFRESH吹き出し） ✅
6. `scoreManager.js` に難易度別ハイスコアキー管理・旧キーマイグレーション追加 ✅
7. `turnManager.js` の`initializeGame()`で難易度維持 ✅
8. `cardsV2.csv` → `cards_fresh.csv` リネーム ✅
9. キャッシュバスター更新（`20260320-2335`）✅
10. Playwrightテスト更新（FRESH選択ステップ追加）✅

### Phase 2: FRESHスコア改修 + 目標表示
6. `scoreManager.js` のS+スコア計算式を満点10に変更（小数点以下1桁、四捨五入） ✅
7. `uiController.js` にステータス目標表示UI追加（体験/入塾: ランク+バー+あとN、経理/満足: バー+あとN） ⬜ ブロック中（閾値データ未提供）

### Phase 3: 新効果パーサー＆トークンシステム
8. `cardManager.js` に新効果キーワード（情熱/発想/整理/並行/疲労）のパース追加 ✅
9. `gameState.js` に `tokens` フィールド追加、`placed` を配列構造に変更 ✅
10. `turnManager.js` でトークンを消費するロジック追加（情熱/疲労/整理） ✅
11a. `uiController.js` 並行配置UI対応（placed配列化・renderStaffSlot・[並行🤹]自動配置・重ね拒否） ✅
11b. `uiController.js` トークン表示UI（手札エリア上＋ステータスパネル下にチップ表示） ✅
11c. `uiController.js` + `turnManager.js` 発想トークン追加習得フロー ✅
11d. 情熱/疲労/整理トークン効果のE2Eテスト追加 ⬜ 未実装

### Phase 4: 研修リフレッシュ
12. `uiController.js` に研修リフレッシュUI追加（ボタン条件表示・残回数表示） ✅
13. `gameState.js` にリフレッシュ残り回数管理を追加 ✅
14. デッキ一覧画面（会議フェーズ）にリフレッシュ残回数表示を追加 ⬜ 未実装

### Phase 5: PROカードプール（データ提供後） ✅ 完了
15. `data/cards_pro.csv` 提供済み ✅
16. `data/cards_fresh.csv` 作成（旧`cardsV2.csv`からリネーム） ✅
17. `cardManager.js` でCSVパスの動的切替対応 ✅（Phase 1で実装済み）

### Phase 6: PROスコア＆ランク（データ提供後）
18. `scoreManager.js` にPROの閾値・配点を設定 ⬜ ブロック中（データ未提供）
19. 結果画面のPROスコア表示対応 ⬜ ブロック中（データ未提供）
