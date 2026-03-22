# PRO難易度 実装ロードマップ

> 最終更新: 2026-03-22

## Phase 1: 基盤（難易度切替の骨格） ✅ 完了

- [x] `difficultyConfig.js` 新規作成（FRESH/PRO設定の一元管理）
- [x] `gameState.js` に `difficulty` フィールド追加、初期値をconfigから取得
- [x] `main.js` に CSV動的読込・`setDifficulty()` 追加
- [x] `scoreManager.js` に難易度別ハイスコアキー管理・旧キーマイグレーション追加
- [x] `saveManager.js` にセーブデータの `difficulty` フィールド追加
- [x] `turnManager.js` の `initializeGame()` で難易度維持
- [x] `uiController.js` に難易度選択UI・初訪問者吹き出し・非同期onStartGame・onRestart改修
- [x] `index.html` / `style.css` に難易度選択ボタン・吹き出しスタイル追加
- [x] `cardsV2.csv` → `cards_fresh.csv` リネーム
- [x] キャッシュバスター `20260320-2335` に統一
- [x] Playwrightテスト更新（FRESH選択ステップ追加）

---

## Phase 2: FRESHスコア改修 + 目標表示

- [ ] `scoreManager.js` のS+スコア計算式を満点10に変更（小数1桁・四捨五入）
- [ ] `uiController.js` にステータス目標表示UI追加
  - 体験/入塾: ランク + プログレスバー + 「あとN」
  - 経理/満足: プログレスバー + 「あとN」
- **依存**: FRESH目標ランクアルファベット・閾値（後日提供）

---

## Phase 3: 新効果パーサー＆トークンシステム

- [ ] `cardManager.js` に新効果キーワード（✨情熱/💡発想/🚥整理/🤹並行/💤疲労）のパース追加
- [ ] `gameState.js` に `tokens` フィールド追加、`placed` を配列構造に変更
- [ ] `turnManager.js` でトークン消費ロジック追加
- [ ] `uiController.js` で新効果アイコン表示・並行配置UI対応
- **依存**: `cards_pro.csv` の内容精査

---

## Phase 4: 研修リフレッシュ

- [ ] `uiController.js` に研修リフレッシュUI追加（ボタン条件表示・残回数表示）
- [ ] `gameState.js` にリフレッシュ残り回数管理追加
- [ ] `saveManager.js` にリフレッシュ回数の保存復元追加
- [ ] デッキ一覧画面にリフレッシュ残回数表示追加

---

## Phase 5: PROカードプール ✅ 完了

- [x] `data/cards_pro.csv` 提供済み
- [x] `data/cards_fresh.csv` 作成（旧`cardsV2.csv`からリネーム）
- [x] `cardManager.js` でCSVパスの動的切替対応（Phase 1で実装済み）

---

## Phase 6: PROスコア＆ランク（データ提供後）

- [ ] `scoreManager.js` にPROの閾値・配点を設定
- [ ] 結果画面のPROスコア表示対応
- **依存**: PRO目標値・ランク閾値（後日提供）

---

## 後日提供が必要なデータ

| 項目 | 状態 |
|---|---|
| PRO用カードCSV | ✅ 提供済み |
| PRO初期ステータス | ✅ 仮値5で設定済み |
| PRO目標値（退塾/体験/入退差の閾値・配点） | ⏳ 未提供 |
| PROランク閾値（E〜S+のポイント数） | ⏳ 未提供 |
| FRESH目標ランクアルファベット | ⏳ 未提供 |
| PRO目標ランクアルファベット | ⏳ 未提供 |
| PROターン設定（研修レアリティ/おすすめ行動/削除枚数） | ⏳ 未提供 |
