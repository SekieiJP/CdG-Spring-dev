# PRO A+同期判定メモ (2026-04-13)

## 目的
- `trainingAdvisor.js` の同期先を、PROの正しい閾値 (`S>=12`, `A+>=10`) で再判定する。
- `pro_stable` を含む方略比較を行い、A+主指標で更新判断する。

## 比較結果
### r67 (1600試行)
- 実行: `solver/pro-tune-r67-aplus-sync-1600.json`
- `pro_stable`: A+ 3.3%, S 0.0%, mean 5.343
- `pro_strategic1`: A+ 4.3%, S 0.2%, mean 5.493
- `pro_strategic1_stable`: A+ 5.2%, S 0.1%, mean 5.499
- `pro_strategic1_upside`: A+ 4.7%, S 0.1%, mean 5.508
- `pro_nonly`: A+ 3.2%, S 0.0%, mean 5.231

### r68 (600試行, strategic1_stable調整後)
- 実行: `solver/pro-tune-r68-strategic1stable-adjust-600.json`
- `pro_stable`: A+ 2.3%, S 0.0%, mean 5.060
- `pro_strategic1`: A+ 4.3%, S 0.0%, mean 5.515
- `pro_strategic1_stable`: A+ 5.7%, S 0.2%, mean 5.427
- `pro_strategic1_upside`: A+ 4.8%, S 0.0%, mean 5.295
- `pro_nonly`: A+ 2.0%, S 0.0%, mean 4.790

## 判定
- A+率トップは `pro_strategic1_stable`。
- `pro_stable` は安定性はあるが A+ が低く、A+主指標では同期先にならない。
- `trainingAdvisor.js` は `pro_strategic1_stable` 準拠で同期継続。

## 更新ルール
- 主指標: A+率 (`points>=10`)
- 安全指標: S率 (`points>=12`) と平均点
- 反映条件: A+改善かつ安全指標に大幅悪化がない場合のみ同期
