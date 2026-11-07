# 2026年11月リリースノートの準備

2026-11-07。`codex/november-release-notes-20261107`で、トップ画面の記念表示と本番公開用のリリースノートを更新する。

## 比較した版

- 本番：`SekieiJP/CdG-Spring` main `72c43de037a7e78ec2dbaee2b1f340199d7ae763`。サイト直下がゲーム本体。
- 開発：`SekieiJP/CdG-Spring-dev` main `7a02d622608ca87f277f0469826964d9d4dc8cbf`、ビルド `v20260815-0059`。`game/`がゲーム本体。
- 文体・分量の参照：[本番のアップデート情報](https://sekieijp.github.io/CdG-Spring/releaseNote.html)。短い導入と箇条書きを踏襲する。

本番のルートと開発の`game/`を同じ相対パスで比較した。使用中のFRESH／PROカード、統合カード表、ランク表はいずれも同一。数値バランスの変更は記載しない。旧カード表のバックアップファイルの有無はプレイヤー向けの更新内容に含めない。

## 追加する5ページと根拠

| ページ | 掲載内容 | 主な確認元 |
|---|---|---|
| あひる先生のアドバイス | 通常のFRESH／PRO、研修・教室会議、顔のタップ、3つの表情、取得・削除の助言 | `ahiruAdviceController.js`、`ahiruAdviceView.js`、`ahiruStatusPolicy.js` |
| 取得アシスト機能 | 5秒後の黄色い強調、最初の2枚の組み合わせ、長押しの理由・注意、設定と青い選択枠 | `acquisitionAssistController.js`、`acquisitionExplanation.js`、`css/style.css` |
| ホーム画面に置けます！ | iPhone／Androidの登録方法、アイコンからの専用画面起動 | `index.html`、`manifest.webmanifest`、`pwa/` |
| 操作や画面表示が便利に | 手札と配置済みカードの圧縮、ⓘと長押し、画面タップで1枚ずつ演出送り、安全な余白 | `uiController.js`、`cardDetailVisibility.js`、`actionAnimationController.js`、`css/style.css` |
| その他の改善・修正 | 直近50件の履歴、同条件の前回比較、送信を待たない再プレイ、中断再開の引き継ぎ修正 | `resultController.js`、`resultRepository.js`、`saveManager.js`、`tests/unit/save-recovery.test.mjs` |

内部の分割・評価用データ・送信処理の詳細・セキュリティ対策は掲載しない。履歴と再プレイは画面から使える改善として紹介する。未公開のMASTERや、未測定の勝率・到達率向上は記載しない。

ホーム画面への追加手順は[Appleの案内](https://support.apple.com/ja-jp/guide/iphone/iphea86e5236/ios)と[Chromeの案内](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=ja)を参照。オフライン対応や端末間同期を追加したという記述はしない。

## 編集範囲

`game/index.html`の「祝500プレイ！」を「祝1000プレイ！」に変更し、`game/releaseNote.html`の先頭に5ページを追加する。既存ページの本文・順番・前後移動は維持する。画像は既存のあひる先生3種とホーム画面用アイコンを相対パスで使用し、本番のルート配置にも対応する。実行コード・カードデータ・GASは変更しない。

本番リポジトリへの反映は今回の準備と分ける。

## 確認結果

- 本番の公開トップページとリリースノートをHTTPで読み取り、本番mainとバイト単位で一致することを確認した。
- iPhone 12、Pixel 5、360×740、PCの4条件のChromiumで、2つの配置パス×5ページ＝40表示を確認。画像読込み、横のはみ出し、本文とフッターの重なり、ページ番号、既存21ページとの前後移動、最終ページからのゲーム復帰を点検し、JavaScript例外とサイト内の読込みエラーは0件。小さい画面では従来どおりスクロールして読める。
- iPhone寸法で5ページを撮影し、全画像を目視した。実機Safariやホーム画面登録を今回再検証したという意味ではない。
- 既存のリリースノートは、先頭ページの`active`指定を新ページへ移す以外、本文・順序・ナビゲーションが一致することを確認した。
- `git diff --check`に問題なし。HTMLと専用の表示スタイルだけの変更のため、ゲーム全体のテストは重複実行していない。

確認用画像・通信不要のプレビューは、共有ワークスペースの`reviews/november-release-notes-20261107/`に保存した。ゲーム本体や本番サイトへの書込み・スコア送信は行っていない。
