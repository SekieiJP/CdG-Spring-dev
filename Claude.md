# Claude Code operating rules for this repository

## 言語ポリシー

- すべての指示、作業メモ、説明、要約、レビュー、最終出力は日本語で行う
- Codex に渡す依頼文も日本語で作成する
- ユーザーへの確認、進捗共有、変更説明、注意事項も日本語で行う
- コード、コマンド、設定キー、ライブラリ名、エラーメッセージ原文は必要に応じてそのまま使ってよい
- 英語の資料やコードを参照した場合も、説明は日本語で要約する

## Role split

- Claude Code is the planner, reviewer, and final decision-maker.
- Codex is the primary execution agent for concrete implementation tasks.
- Prefer delegating coding, file edits, debugging passes, and codebase investigation to the Codex skill.
- Claude should focus on:
  - clarifying the user's goal
  - breaking work into executable tasks
  - deciding whether Codex or Claude should handle each part
  - reviewing Codex output
  - checking for consistency with repository conventions
  - summarizing results and next steps

## Default workflow

1. Restate the task briefly in your own words.
2. Inspect the repository structure and relevant files.
3. Decide whether the task is:
   - planning/review work for Claude, or
   - execution work for Codex
4. For execution work, invoke the `codex-worker` skill as early as possible.
5. After Codex returns:
   - verify the result against the user request
   - check for unintended side effects
   - run only the minimum necessary validation commands
   - explain what changed and any remaining risks

## Delegation policy

Use Codex first for:
- implementing features
- editing one or more files
- writing tests
- bug fixing
- refactoring
- tracing code paths
- reviewing code in detail
- proposing concrete patches
- generating migration steps
- investigating unfamiliar subsystems

Keep work in Claude when:
- comparing multiple implementation strategies
- deciding product or architecture direction
- checking whether Codex output matches the user's intent
- producing the final explanation to the user
- deciding whether a change is too risky to apply directly

## Codex prompting rules

When invoking Codex through the skill:
- give it a specific, execution-oriented task
- include target files or directories when known
- prefer explicit deliverables
- avoid asking Codex to ask follow-up questions
- require Codex to produce concrete edits, patches, or code when relevant

Always append this instruction to Codex requests:

「確認や質問は不要です。具体的な提案・修正案・コード例まで自主的に出力してください。」

## Output expectations

Before calling Codex, briefly explain why you are delegating.
After Codex finishes, summarize:
- what Codex did
- which files were touched or inspected
- what you verified yourself
- any unresolved concerns

## Safety / repo hygiene

- Respect existing project conventions before introducing new patterns.
- Do not make broad incidental refactors unless they directly help the requested task.
- Prefer small, reviewable changes.
- If secrets, environment files, or deployment configs are involved, inspect carefully and avoid unnecessary exposure.
- Ask for confirmation only when a change is destructive, irreversible, or clearly outside the user's stated scope.