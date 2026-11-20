# MASTERのお手本プレイ方策

対象は通常プレイのMASTER、内部IDは `int`。公開版 `0595b2b` の日程、カード、採点表を使用する。

## 局面から一手を得る

`solver/master-policy.mjs` はブラウザの画面やNodeのAPIに依存しない。MASTERのカードを読み込んだ `CardManager` と、同じ難易度の採点表を読み込んだ `ScoreManager` を使用する。

```js
const decide = createMasterPolicy({ catalog: cardManager.allCards, scorer: scoreManager });
const scene = observeMaster(turnManager);
const move = scene && decide(scene);
```

`observeMaster` は方策に渡す局面を作る。手札、提示された候補、所持カードの構成、現在値と公開日程を使う。所持カードは個体ID順に並べる。抽選前の候補、山札順、シードにはアクセスしない。実行済みの行動や候補の抽選待ちなど、判断を必要としない局面では `null` を返す。

| `move.kind` | 呼び出し側が使う値 |
| --- | --- |
| `acquire` | `indices` は表示中の候補から確定する添字の組。初回研修や書店の2枚選択にも対応する。発想の見送りは空配列。 |
| `refresh` | 表示中の研修・外出候補を交換する。交換後の局面で再度判断する。 |
| `place` | `moves` は `{ id, staff }` の配置順。現在の配置を手札に戻してから適用する完成案で、空の枠も確定案に含む。講習の自動配置はゲームが実行する。 |
| `delete` | `ids` は確定する削除対象の個体ID。日程の必須枚数、整理による上限、講習中の捨て札を考慮する。 |
| `outing` | `place` は選んだ外出先ID。到着後の候補は `acquire` で扱う。 |
| `staff` | `staff` は本部で選んだカードをその場で使用する担当者ID。 |

取得と削除では、体験を増やすカードと経理を補うカードがデッキにどれだけあるかを評価する。配置は職種制限と並行配置を検査し、室長・講師・事務の順にカード効果を解決する。探索幅は既定で10。最終ターンは候補の公式得点を優先する。外出先は、書店と近隣校で獲得するカードの価値と、本部で即時に得られる効果を、公開カタログから推定して選ぶ。

## 改修と検証

`solver/master-benchmark.mjs` はゲーム本体の `TurnManager` を使って全12ターンを進め、`ScoreManager` の最終表示点を集計する。候補外の取得、同じ個体の二重使用、職種・講習の配置条件違反、必須削除の不足などを検出した時点で、シードと局面を出力して失敗終了する。

```sh
node --test tests/unit/master-policy.test.mjs
node solver/master-benchmark.mjs development 3000
node solver/master-benchmark.mjs validation 10000
node solver/master-benchmark.mjs --trace master/validation/29
```

シードは `master/<集合名>/<開始番号からの連番>` 。各方策に同じシード列を渡す。下振れは各方策自身の丸め前の平均点から4を引き、その値以下のゲームをすべて数える。全件が合法に完走し、平均点が比較元を上回り、下振れ率が5%以下なら終了コード0を返す。結果のJSONには得点分布、シードごとの勝ち・同点・負けの件数、下振れを再現するためのシード番号を含む。

次の改修では `createMasterPolicy({ catalog, scorer })` をexportする候補モジュールを用意する。4番目の引数にパスを渡すと、採用版v2と候補を比較できる。開発用のシードで調整し、候補を固定してから新しい集合名で評価する。個別の判断は `--trace` で追跡できる。

```sh
node solver/master-benchmark.mjs development 3000 0 ./solver/my-master-policy.mjs
node solver/master-benchmark.mjs --trace master/development/29 candidate ./solver/my-master-policy.mjs
```

## 採用版の成績

v1は同じ公開ルールと配置探索を使う初版で、外出先は本部を選ぶ。v2では体験不足と経理の見込みを評価に加え、研修の交換と外出先の選び方を改修した。

| シード集合 | 方策 | ゲーム数 | 平均点 | 平均点−4点以下 |
| --- | --- | ---: | ---: | ---: |
| 開発 | v1 | 3,000 | 11.2623 | 186件、6.20% |
| 開発 | v2 | 3,000 | 11.6783 | 121件、4.03% |
| 独立検証 | v1 | 10,000 | 11.2718 | 600件、6.00% |
| 独立検証 | v2 | 10,000 | 11.7073 | 444件、4.44% |

独立検証でのv2の下振れ判定値は7.7073点。得点は整数なので7点以下が該当する。5%の条件はこの標本での実測値として判定した。

[開発結果](research-results/master-assist/development.json) · [独立検証結果](research-results/master-assist/validation.json)
