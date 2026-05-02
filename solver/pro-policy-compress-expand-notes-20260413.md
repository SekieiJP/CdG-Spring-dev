# PRO方略追加メモ: `pro_compress` / `pro_expand` (2026-04-13)

## 追加方略
- `pro_compress`
  - 狙い: 高火力少数カード（特に「学力確認＆向上 公開模試」）と整理系カード（「締切間近の書類リマインド」等）を優先し、会議で積極削除してデッキ圧縮。
  - 実装ポイント: 取得評価・カード名バイアス・削除閾値を圧縮寄りに調整し、公開模試/リマインドを削除保護。
- `pro_expand`
  - 狙い: 「並行」「情熱」「発想」系カードを優先取得し、並行配置の連鎖を増やす。
  - 実装ポイント: 並行/情熱のトークン価値を上げ、取得評価と削除評価をトークン連鎖寄りに調整。

## 比較結果
### r70b (600試行)
- 実行: `solver/pro-tune-r70b-compress-expand-retune-vs-stable-600.json`
- `pro_stable`: A 34.3%, S 0.2%, A+ 3.5%, mean 5.040
- `pro_strategic1_stable`: A 36.5%, S 0.0%, A+ 5.0%, mean 5.332
- `pro_compress`: A 64.8%, S 2.3%, A+ 32.3%, mean 7.705
- `pro_expand`: A 29.0%, S 0.0%, A+ 2.8%, mean 4.327

### r69b (1200試行, 参考)
- 実行: `solver/pro-tune-r69b-compress-expand-1200.json`
- `pro_strategic1_stable`: A 36.4%, S 0.0%, A+ 4.4%, mean 5.285
- `pro_compress`: A 61.9%, S 2.4%, A+ 26.8%, mean 7.427
- `pro_expand`: A 31.1%, S 0.1%, A+ 3.7%, mean 4.507

## 所見
- `pro_compress` はA+/平均点で明確に優位。
- `pro_expand` は並行連鎖の再現はできるが、現時点ではA+/Sの押し上げが弱い。
