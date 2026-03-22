---
name: codex-worker
description: |
  Codex CLI を実装担当として呼び出すためのスキル。
  用途:
  - 機能実装
  - バグ修正
  - 複数ファイル編集
  - テスト追加
  - コード調査
  - リファクタリング
  Claude は方針立案・タスク分割・レビューを担当し、具体作業はこの skill を使って Codex に委譲する。
disable-model-invocation: true
allowed-tools: Bash, Read, Grep, Glob
---

# Codex Worker

この skill は、Codex CLI を「実作業担当」として呼び出すためのものです。

## 役割

- Claude は planner / reviewer として振る舞う
- Codex は executor として振る舞う
- 実装・修正・詳細調査はまず Codex に任せる
- Claude は Codex の出力を検証し、ユーザー向けに要約する

## 基本方針

Codex に渡す依頼は、曖昧な相談ではなく、実行可能なタスクに具体化してから渡してください。

良い例:
- どのファイルを触るか分かる
- 何を変更するかが明確
- 期待する成果物が明確
- 追加で質問させない
- 必要ならテストや検証も含める

悪い例:
- 「このへんいい感じに直して」
- 「まず質問してから進めて」
- 「何か問題があれば止まって」

## 実行コマンド

基本コマンド(レビューや調査だけに限定したい時は後者):

```bash
codex exec --full-auto --cd "$(pwd)" "<request>"
codex exec --full-auto --sandbox read-only --cd "$(pwd)" "<request>"
