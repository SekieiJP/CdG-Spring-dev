# PRO攻略研究の固定評価モデル

`pro-public-value-v1.json` は、現在の攻略試行で使うV1平均モデルを元のバイト列のまま同梱したもの。102個の公開状態の特徴を使う固定木で、取得/配置の分析用先読みの末端を評価する。学習時の来歴・誤差・係数を含めて保存し、学習元のコード版を現在版へ書き換えていない。

- モデルSHA：`c07e7fe747c66aeebb345a2f3100ae6b6fc4609605ea58680230e6ac94be9bba`
- サイズ：98,277バイト
- 学習3,000元開始・比較250元開始。元データのSHAと出典はモデル内の`provenance`に収録
- 来歴と保存場所の対応：[同梱情報](pro-public-value-v1.manifest.json)

同じモデルをリポジトリ内から読む設定は、`solver/research-scenarios/ahiru-pro-player-components-portable.json`。比較した4条件の設定との差は`valueModelPath`だけである。公開ゲーム画面の助言は別の固定投影と補正データを使う。

UI統合後のmainは本体JSの版が異なるため、このモデルをそのまま使った研究の実行は版ガードで拒否される。来歴を書き換えず、下記の凍結ソースを使う。

## 目標を達成したV1方略の再現

元の方略11ファイルSHAは8196136e…、凍結ソースは04d200e…である。現在のルートから別の作業領域を作り、同梱モデルを元の保存先へ置く。

```sh
git worktree add --detach /tmp/cdg-pro-v1-replay 04d200e157156837a7bb326920ecd641707a90c6
mkdir -p /tmp/cdg-pro-v1-replay/solver/local-runs/pro-mean125/value-v1
cp solver/models/pro-public-value-v1.json /tmp/cdg-pro-v1-replay/solver/local-runs/pro-mean125/value-v1/depth3-model.json
npm ci --prefix /tmp/cdg-pro-v1-replay
cd /tmp/cdg-pro-v1-replay
node solver/ahiru-pro-study.mjs ahiru-stability-validation-v1-20261103 2000 baseline --configs solver/research-scenarios/ahiru-pro-validation-v1.json --workers 2 --port-base 19600
```

元の計画は2,000開始で、目標変更後の判定はその**先頭0..999の全開始**を使う。同じ開始の再現を新しい独立確認には数えない。3%基準の再監査器は現在の`solver/ahiru-goal-assessment.mjs`、既存記録の監査結果は[こちら](../research-results/ahiru-advice-20261103/goal-3percent-assessment.json)。再現を始める前にPlaywright用Chromiumもインストールする。

## 同じ開始群を再試行する例

削除仮説の4条件を再現する場合は、`git worktree add --detach /tmp/cdg-pro-components-replay cff6f2e`で別の凍結ソースを用意する。この版にはモデルとportable設定が同梱済み。NodeとPlaywright/Chromiumを用意し、そのルートで実行する。生記録は`solver/local-runs/`へ保存する。

```sh
node solver/ahiru-pro-study.mjs ahiru-model-reproduction 250 baseline --configs solver/research-scenarios/ahiru-pro-player-components-portable.json --workers 1 --port-base 19600 --seed ahiru-pro-ahiru-player-deletion-development-v2-20261103
node solver/ahiru-pro-metrics.mjs solver/local-runs/pro-mean125/ahiru-model-reproduction/manifest.json solver/local-runs/pro-mean125/ahiru-model-reproduction/summary.json
```

同じ開始群の再試行を独立した追加250開始には数えない。新しい傾向の比較には最低250の異なる元開始を使う。基本札優先の各条件を再試行する場合は、条件名を`strict-control` / `forecast-cash` / `opening-only`へ変え、別の実行名を付ける。

## 版の照合

実行器はモデルSHAと本体JS・カード・得点表の元の版を厳密に照合する。対応する本体JSのSHAは`69ccd7dcc729c83823b50d311ac032e11865867e4a1fc9b10ed4816802b6aa2e`。画面開発ブランチなどで本体JSの版が変わった場合も照合で拒否するため、この固定した研究ブランチを再試行元として保持する。

モデル保存場所だけを変えた1ゲーム・全8配置の接続確認では、元のモデルと実取得/提示/ドロー/配置/削除/効果解決後の値とトークン/最終公式得点が一致した。[照合記録](../research-results/ahiru-advice-20261103/model-bundle-technical.json)。これは動作確認で、少数得点による強さや目標達成の根拠には使わない。全1,000開始の目標判定は別の固定実験の全結果で行う。
