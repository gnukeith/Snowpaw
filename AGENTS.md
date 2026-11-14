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
