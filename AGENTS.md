# Snowpaw: agent guide

Snowpaw is a security- and privacy-first agent harness. A Tauri desktop app lets
the user watch and steer AI agents that work around the clock on their own
isolated box. The architecture is still open. Treat nothing as decided unless it
is written in this file.

## Who does what

| Agent | Model | Role |
| --- | --- | --- |
| Grok | Grok 4.7 (`grok-4.7-build-fast`, provider `grok`) | **Researcher.** The only agent that researches. Searches the web, reads source, and reports findings with links and dates. Writes no product code. |
| Astra | GPT-6 Astra (`gpt-6-astra`, provider `codex`) | **Blind-spot reviewer and coding partner.** Tells Grok what its research missed so the next search is sharper. Helps Fable code: reviews diffs and takes implementation tasks Fable hands over. |
| Fable | Claude Fable 5.2 (`claude-fable-5-2`) | **Lead.** Orchestrates, settles architecture with the user, and writes the code. |

Rules that follow from the roles:

- Facts from outside this repo come from Grok. Do not research on your own and do
  not answer from memory when the answer could have changed.
- A Grok finding is settled only after Astra has checked it for blind spots.
- Code lands only after review by an agent that did not write it.
- If you were started as a delegated child, do the work of your own role. Start
  no agents of your own.

## What the user wants

1. **Security and privacy first, usable second.** When the two conflict, stop
   and raise it; do not quietly trade one away.
2. **Lean.** No code without a reason to exist. No dependency that a few lines
   would replace. The app stays lightweight.
3. **Beautiful and consistent.** Spacing, radii, edges and colour come from
   design tokens, never one-off values. The user can restyle the app at any time.
4. **Modular.** Agents can build on top of the harness, and what they build is
   viewable at once.
5. **Familiar.** Sidebar; settings in categories; usage; plugins; file upload;
   git; Ctrl+F inside a conversation; notes in the style of Obsidian; Excalidraw
   built in.

## Git workflow

Project policy: a readable history of focused, reviewable changes. Consistent format does not mean identical commit messages. Commit boundaries follow behavior and reviewability, not a timer, file count or arbitrary line limit.

### Before editing

Inspect the branch, working tree, staged changes and recent history. Preserve other contributors' edits. Never assume an existing staged change belongs to the current task. Use one branch per bounded task, named with a short purpose such as `feat/memory-admission` or `fix/cancelled-buffer-release`. Use separate worktrees for simultaneous agents when available; assign file/interface ownership before they edit.

For substantial work, describe the intended commit sequence in the task. Revise that sequence when the final implementation changes. Avoid turning routine fixes into a planning ceremony.

### Atomic commits

Each commit should answer one clear question: what behavior or independently useful structural change does this introduce?

- Commit a coherent slice once it is ready, rather than accumulating an entire milestone.
- Include the tests and documentation needed to understand and validate that slice in the same commit.
- Separate unrelated fixes, mechanical formatting, renames and behavior changes when doing so preserves buildability.
- Keep tightly coupled changes together if splitting would create an invalid intermediate state.
- Never create artificial one-file commits or dozens of microcommits to satisfy a size target.
- Every commit intended for integration should build and pass the relevant available checks. Hardware-dependent validation may be pending, but must be labeled explicitly.
- Local scratch commits are allowed for protecting work. Clean up only your own unpublished history before review; do not present broken scratch checkpoints as finished integration commits.

Before each commit, inspect the complete diff, stage explicit paths or selected hunks, then inspect the staged diff and `git diff --cached --check`. Confirm no unrelated edits, secrets, weights, generated binaries or benchmark dumps are included. Do not use blanket staging in a mixed working tree. Do not discard a user's work to make the tree clean.

### Message convention

Use this project format:

```text
<type>(<scope>): <imperative description>

Optional explanation of why, important tradeoffs and validation.
```

Types: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`. Scope is a stable subsystem such as `runtime`, `memory`, `backend`, `transport`, `models`, `bench` or `docs`; omit it for genuinely repository-wide changes. Use lowercase types/scopes, concise subjects, no trailing period, and aim for about 72 characters or fewer without sacrificing clarity.

Examples:

```text
feat(memory): reject placements that exceed per-node capacity
fix(transport): retain buffers until pending sends complete
perf(runtime): reuse decode dispatch buffers
refactor(backend): isolate native buffer ownership
test(models): cover recurrent state rollback
```

Do not use `update stuff`, `misc fixes`, `final`, or model-generated promotional descriptions. A `perf` commit needs measured evidence or an explicit statement that its speed benefit remains unverified; do not describe an expected gain as achieved.

Mark an incompatible public API/config/protocol change explicitly in the subject with `!` before the colon and explain migration in a `BREAKING CHANGE:` body paragraph. Do not invent issue IDs, reviewer approvals or test outcomes.

### Commits, pushes and integration

A commit is a local logical change; a push publishes a branch. They need not occur at the same cadence. This policy directs agents to make focused local commits during authorized implementation. It does not itself authorize pushing, merging or publishing. Honor any existing explicit user authorization instead of asking again.

When remote work is authorized, push coherent checkpoints to the task branch. Several clean commits in one push are fine. Avoid dumping all work into one huge commit, and avoid pushing every tiny edit. Report the branch, commit range, checks and pending hardware validation.

Prefer a focused PR containing the smallest useful feature/fix, not an entire engine milestone. PR descriptions explain the problem, resulting behavior, validation and material limitations. Keep already coherent commits if the repository's merge policy allows it; squash noisy scratch history when appropriate. Follow existing repository merge rules. Do not split into commits only to erase meaningful review boundaries accidentally during integration.

Never force-push, rebase shared history, amend another contributor's commit, reset destructively or merge without the applicable authorization. Resolve ordinary local conflicts within scope, preserve both contributors' intent and rerun relevant checks after resolution. Do not add automatic Git hooks or alter global Git configuration as an incidental setup step.

### Example feature sequence

For a substantial memory-admission feature, a reasonable sequence is:

1. `refactor(memory): centralize byte accounting` with parity tests, if this preparatory change is independently useful.
2. `feat(memory): enforce per-node admission limits` with boundary tests and configuration documentation.
3. `test(runtime): cover admission under concurrent requests` if integration coverage is a distinct follow-up.

For a small bug, one commit containing the fix, regression test and relevant docs is better. Keep docs synchronized with behavior rather than postponing all documentation until the end.
