# 共通改修：開発・検証の手順

## ローカル確認

Node.js 24を使用し、`npm ci`で依存関係を導入する。

```sh
npm run test:unit
npm run test:browser
```

ブラウザテストは専用の18080番ポートを使用する。別の作業と重なる場合は`CDG_TEST_PORT=18081 npm run test:browser`のように変更する。通常テストのGAS送信は`tests/fixtures.js`で応答を差し替え、実際のスコアを記録しない。日時も固定し、期間外のイベント検証はテストごとに日時を変える。

iPhone 12の390×844、Android Chrome、デスクトップChromiumを対象とする。Playwright 1.58のWebKitに対応しないmacOS 13では、iPhoneの寸法・タッチ条件のみChromiumで確認する。CIのLinux環境ではWebKitを使う。寸法テストをSafari実機確認と同一視しない。

## PWAのホーム画面登録

公開先はHTTPSを使用する。iPhoneではSafariの共有メニューから「ホーム画面に追加」、Android Chromeではメニューのインストール／ホーム画面追加を使用する。manifest、192・512pxアイコン、iOS用180pxアイコン、縦画面・独立画面表示を用意した。

初版では登録と起動を対象とし、オフラインでのデータ読込みは対象に含めない。アイコンを変更する際は`game/pwa/icon.svg`を編集し、`node scripts/build-pwa-icons.mjs`でPNGを生成する。

実機の確認項目：

- iPhone 12 Safariから登録し、ホーム画面の名称とアイコンを確認する。
- 独立画面で起動し、ノッチ・下端のホーム操作領域とボタンが重ならないことを確認する。
- Safariのアドレスバーが表示／縮小する双方でスクロール・配置・詳細表示を確認する。
- 中断後にSafari／ホーム画面から再開し、端末のストレージ条件による差を確認する。
- Android Chromeでも登録・起動・タップ配置を確認する。

実機での登録は未確認。自動テストはmanifestの内容・アイコンの復号と寸法・再読み込みによる復元を検証する。

参考：[MDN：PWAをインストール可能にする](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)。

## 中断データ

保存キーは引き続き`cdg_save_data`の1件。`vYYYYMMDD-NNNN`のYYYYMMDDが一致すれば再開する。研修の抽選済み候補と捨て札、削除履歴、研修リフレッシュ開始時の残数、通常／発想研修の区別を保存する。

旧保存で欠けていた履歴は復元できないため、存在しない項目は空の履歴として扱う。データの読込みに失敗した場合は中断データを消去せず、難易度を維持して再読込みを案内する。

## 効果解決

本体とsolverの1枚解決は`TurnManager.resolveCardAction`から`actionResolver.js`を使用する。条件とコストをおすすめ加算前の状態で判定し、有効なカードだけおすすめを加算して効果を適用する。solverの仮状態にも難易度・ターン・総ターン数を渡す。配置探索は室長→講師→事務の実行順に従う。
