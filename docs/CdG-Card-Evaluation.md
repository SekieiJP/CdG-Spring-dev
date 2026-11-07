# カード評価の使い方（T05）

## 計測する

```sh
mkdir -p solver/local-runs
node solver/autoplay-agent.mjs --difficulty pro --episodes 100 --policies pro_stable,pro_expand,pro_upside --seed baseline-20261002 --output solver/local-runs/pro.json --no-report
node solver/card-evaluation.mjs solver/local-runs/pro.json --output-dir solver/local-evaluation
```

`solver/local-evaluation/index.html`をブラウザで開く。難易度・戦略・カード版・コード版ごとの測定環境を選び、名前・No・カテゴリで検索できる。同じ内容を`cards.csv`と`cards.json`にも出力する。生成先はGitの対象から外し、ゲーム画面にプレイヤー向け評価を追加しない。

FRESHも`--difficulty fresh`で計測する。追加難易度は先に拡張モジュールで登録する。既存戦略の目標値はFRESH／PRO向けなので、新たな得点・取得・持続ルールを追加した場合は、その難易度に適合する戦略と予測も検証する。

## 人間プレイを取り込む

設定画面の「プレイ記録をJSONで保存」から現在のゲーム、または直前に完了したゲームを出力する。

```sh
node solver/card-evaluation.mjs /path/to/cdg-play-pro-2026-10-02.json --output-dir solver/local-evaluation
```

記録は端末内に保存する。通常・計算機・イベント、自動プレイ・人間プレイを分ける。実使用ログのGAS送信は追加していない。詳細ログを結果履歴50件へ複製せず、詳細は中断データと直前1ゲームに保存する。1ゲーム3000イベントを超えた場合は上限到達を記録し、不完全なログと分かる表示にする。

## 指標の読み方

- 候補提示数と取得数：取得機会を分ける。基本カードと、候補を経由しない計算機入力では取得／提示率を出さない。
- ドローと配置と解決：手札に来たか、置いたか、効果が有効だったかを分ける。取消操作は配置として記録し、実使用は解決記録で判定する。
- 条件成立／判定とコスト不足：条件未成立と、効果全体のコスト不足を区別する。条件が未成立でもおすすめや無条件部分が有効な場合がある。
- 直接増分：4パラメータとトークンの前後差。おすすめを含む。設定・上限処理の影響も含むため、説明文の加算値と必ずしも同じではない。
- 取得ゲーム・未取得ゲーム・実使用ゲームの最終得点分布：各ゲームを1回数える。高得点との相関を、そのカードだけの因果的な強さとみなさない。
- カード詳細：取得ターン・解決ターン・配置先ごとの回数と増分を確認する。個々のデッキ構成・トークン後続効果は元JSONの各ゲームから確認する。
- 平均・p10／p50／p90・標本数：少数試行を明示する。レポートの分位点はnearest rank方式。平均の95%概算は30ゲーム以上で表示し、戦略の偏りやデッキの違いを補正する区間ではない。

低評価をそのまま強化候補にする前に、複数戦略で取得・実使用・条件成立のどこに差が出るか確認する。

## 同じ初期条件で差し替えを比較する

```sh
node solver/autoplay-agent.mjs --difficulty pro --episodes 100 --policies pro_stable --seed baseline-20261002 --replace-card 06:07 --output solver/local-runs/pro-replaced.json --no-report
node solver/card-evaluation.mjs solver/local-runs/pro-replaced.json --compare-before solver/local-runs/pro.json --output-dir solver/local-evaluation/replaced
```

`--replace-card 元No:差替No`は評価中だけ元のカード定義を別カードに置換する。CSVは編集しない。元のNoを保持し、差替定義のIDを記録する。研修候補・レアリティも差し替え後の定義に従うため、供給と判断の変化を含む環境比較である。

比較はseed・戦略・難易度・通常／計算機／イベントが一致する完了ゲームを対にし、平均得点差と対応件数を出す。乱数はターンごとの山札、研修プール、候補、戦略で系列を分ける。初期seedが同じでも、差し替えで候補や判断や乱数消費が変われば後続の札は変わり得る。

## 再現に必要な情報

全記録にビルド番号、ルール版、カード／ランクCSVの指紋、乱数アルゴリズムとseed／系列の位置を含む。ブラウザの人間プレイではコードをビルド番号で識別し、自動プレイには追加で戦略・エンジンコードのSHA-256、Gitコミットと未コミット変更の有無を記録する。CSVの指紋はSHA-256を基本とし、ブラウザで利用できない場合は識別可能な接頭辞付きの代替値を使う。これらは保存の再開可否を制限せず、再計測条件の照合に用いる。

再開時は乱数系列の位置と評価ログを復元する。予測用の状態は実プレイの乱数・ログを消費しない。版・データ・seed・戦略を揃えて再計測する。

## 検証

単体16件通過。評価ログ・保存・追加難易度の関連ブラウザ24件中23件通過後、開始完了を待つテストに修正し、該当Android1件を再検証して通過。同seedの2戦略・各2ゲームで得点分布が一致。差し替えと対比較、51カードのHTML表示・検索も確認した。少数試行の確認結果をバランスの結論には使用しない。

## 2026-10-02の基準計測

コミット`fc0d9ba8a137ac7dc667b29e014f4031941f1370`、未コミット変更なし、ビルド`v20260815-0052`、seed=`baseline-20261002`で計測した。FRESH・PROのカード数値とランク閾値は共通改修で変更していない。UI・通信の0053更新後も、この0052の環境を比較基準として保存する。

| 難易度・戦略 | ゲーム数 | 平均得点 | p50 | p90 | 最小〜最大 |
|---|---:|---:|---:|---:|---|
| PRO / pro_stable | 100 | 8.280 | 9 | 11 | -6〜12 |
| PRO / pro_expand | 100 | 6.210 | 9 | 11 | -6〜12 |
| PRO / pro_upside | 100 | 3.340 | 5 | 11 | -8〜13 |
| FRESH / fresh_stable | 50 | 5.582 | 6 | 8.9 | -1〜9.4 |
| FRESH / beam | 50 | 1.732 | 2 | 4 | -2〜9.6 |
| FRESH / random | 50 | -1.180 | -1 | 0 | -3〜6 |

MASTERのパラメータ目標を比較するためのPRO平均値：

| 戦略 | 体験 | 入塾 | 満足 | 経理 |
|---|---:|---:|---:|---:|
| pro_stable | 32.92 | 27.63 | 25.69 | 20.69 |
| pro_expand | 40.11 | 31.09 | 24.36 | 15.26 |
| pro_upside | 37.37 | 32.09 | 24.11 | 12.22 |

取得・使用・条件成立・増分は各カードについて、6つの測定環境を切り替えて確認する。戦略間で平均や下振れが異なるため、戦略名だけで構築の強弱を確定しない。核の完成率約70%やMASTERの出力0〜35%増は、MASTER固有の成立条件・戦略を定義してから別スレッドで評価する。

生成物は`solver/local-runs/pro.json`、`fresh.json`と`solver/local-evaluation/index.html`、`cards.csv`、`cards.json`。Gitには含めず、端末内で保持する。両難易度をまとめる場合：

```sh
node solver/autoplay-agent.mjs --difficulty fresh --episodes 50 --policies fresh_stable,beam,random --seed baseline-20261002 --output solver/local-runs/fresh.json --no-report
node solver/card-evaluation.mjs solver/local-runs/pro.json solver/local-runs/fresh.json --output-dir solver/local-evaluation
```
