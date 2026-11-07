# ブランチと公開版

- 公開版の正本はGitHubの`main`とする。
- 継続する作業枝は`codex/master-development`、`codex/async-battle`、`codex/card-evaluation`の3案件とする。その他の一時作業枝は統合後に閉じる。
- 案件ごとに独立したworktreeを使い、他案件の作業フォルダと未コミット変更を編集しない。
- 開発途中のMASTER・対戦・評価機能を、公開指示の範囲に含まれないままmainへ取り込まない。
- ビルド番号を作業枝ごとに独自に進めない。ユーザーが指定した公開番号を`node scripts/set-build-version.mjs`で反映し、JavaScriptの参照版もそろえる。
- 中断データとリプレイの互換判定は、ビルド番号の上8桁を使用する。

# 公開先

- `CdG-Spring-dev`では`game/`が配信対象、`CdG-Spring`では同じ内容をルートへ配置する。
- ブランチ整理で閉じる履歴は`archive/`タグへ保存し、必要な研究データと未コミット変更を失わないようにする。
