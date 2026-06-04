# Skills Bundle

This repository ships a set of authoring helpers that run **inside the editor / agent**, not inside the QA Studio web app. They make day-to-day Cursor work cheaper (token-wise) and more consistent across contributors. Two parallel installs are checked in so they're available no matter which IDE/agent you launch from:

| Tree                | Read by                                                            |
|---------------------|--------------------------------------------------------------------|
| `.cursor/skills/`   | Cursor Desktop / Cursor IDE Agent (UI-driven)                      |
| `.cursor/rules/`    | Cursor Desktop / Cursor IDE Agent (always-on rules, e.g. caveman)  |
| `.agents/skills/`   | The Claude Code CLI / Anthropic Agent SDK runtime                  |
| `skills-lock.json`  | Versions / hashes for the skill bundles above, so everyone pins the same revisions |

> Companion docs:
>
> - [`README.md`](./README.md) — install / run / configure QA Studio
> - [`ARCHITECTURE.md`](./ARCHITECTURE.md) — module-level architecture
> - [`FLOW_DIAGRAM.md`](./FLOW_DIAGRAM.md) — end-to-end flows
>
> The skill bundles themselves live one directory below each tree (`.cursor/skills/<name>/SKILL.md`, `.agents/skills/<name>/SKILL.md`) and are the authoritative source for each skill's full body / triggers / examples. This file is the catalogue.

---

## Skills at a glance

| Skill              | Trigger phrases / commands                                                       | What it does                                                                                                                  | Output style |
|--------------------|----------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------|--------------|
| `caveman`          | `/caveman`, "caveman mode", "talk like caveman", "be brief", "use less tokens"   | Ultra-compressed prose mode for the agent's own responses — drops articles / filler / hedging, keeps every technical token   | Six intensities: `lite`, `full` (default), `ultra`, `wenyan-lite`, `wenyan-full`, `wenyan-ultra`. Switch with `/caveman <level>` |
| `caveman-commit`   | `/caveman-commit`, "write a commit", "generate commit message", "commit message" | Generates a Conventional Commits message from the staged diff. Subject ≤ 50 chars, body only when the *why* isn't obvious    | One commit message as a code block, ready to paste into `git commit -F` |
| `caveman-review`   | `/caveman-review`, "review this PR", "review the diff", "code review"            | One-line PR / diff comments in the form `L42: 🔴 bug: user can be null after .find(). Add guard before .email.`              | Findings only, sorted file → line ascending, totals footer (`🔴 N 🟡 N 🔵 N ❓ N`) |
| `caveman-compress` | `/caveman-compress <filepath>`, "compress memory file"                           | Rewrites a natural-language `.md` / `.txt` file in caveman prose in-place, leaving a `<filename>.original.md` backup          | Modifies the target file. Preserves code blocks, URLs, paths, frontmatter exactly |
| `caveman-help`     | `/caveman-help`, "caveman help", "how do I use caveman"                          | One-shot reference card listing every caveman mode + skill + how to deactivate. Does NOT change mode or persist any state    | Markdown table |
| `caveman-stats`    | `/caveman-stats`                                                                 | Reports real token usage + estimated savings for the current session. Backed by a hook, not the model itself                  | Stats block injected by the hook |
| `cavecrew`         | "delegate to subagent", "use cavecrew", "spawn investigator/builder/reviewer"    | Decision guide for delegating to three preset subagents (`cavecrew-investigator`, `cavecrew-builder`, `cavecrew-reviewer`) whose tool-results come back compressed | Routes the parent agent to the right subagent + documents each subagent's output contract |

---

## Cursor rules (always-on)

Cursor rules under `.cursor/rules/*.mdc` are applied on every chat in this workspace — they do not need a trigger phrase.

| Rule                       | Always-on? | What it enforces                                                                                                                              |
|----------------------------|-----------:|-----------------------------------------------------------------------------------------------------------------------------------------------|
| `.cursor/rules/caveman.mdc`  | yes        | Cursor's chat agent operates in caveman `full` mode by default. Read `.cursor/skills/caveman/SKILL.md` once per session, then apply.          |
| `.cursor/rules/graphify.mdc` | yes        | For codebase / architecture questions, prefer `graphify query`, `graphify path`, `graphify explain` over raw grep. After code edits, run `graphify update .` to keep `graphify-out/` current. |

Both rules are short on purpose — they delegate the details to the matching skill body.

---

## Caveman intensity quick-reference

The `caveman` skill ships six intensities. Pick one with `/caveman <level>`.

| Level         | What changes                                                                                                                                                                                              | Example — "Why React component re-render?"                                            |
|---------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------|
| `lite`        | Drop filler + hedging. Keep articles + full sentences. Professional but tight.                                                                                                                            | "Your component re-renders because you create a new object reference each render. Wrap it in `useMemo`." |
| `full`        | Default. Drop articles, fragments OK, short synonyms.                                                                                                                                                     | "New object ref each render. Inline object prop = new ref = re-render. Wrap in `useMemo`."               |
| `ultra`       | Abbreviate prose words (DB / auth / config / req / res / fn / impl), strip conjunctions, arrows for causality (`X → Y`), one word when one is enough. **Never** abbreviate code symbols / API names / error strings. | "Inline obj prop → new ref → re-render. `useMemo`."                                    |
| `wenyan-lite` | Semi-classical (文言文). Drop filler + hedging, keep classical sentence grammar.                                                                                                                          | "組件頻重繪，以每繪新生對象參照故。以 useMemo 包之。"                                       |
| `wenyan-full` | Full 文言文. Maximum classical terseness, classical particles (之/乃/為/其), 80-90 % character reduction.                                                                                                  | "物出新參照，致重繪。useMemo Wrap之。"                                                  |
| `wenyan-ultra`| Extreme compression with classical Chinese feel.                                                                                                                                                          | "新參照→重繪。useMemo Wrap。"                                                          |

Auto-clarity — caveman **drops back to normal prose** for security warnings, irreversible-action confirmations, and any output where fragment order could risk a misread. Resumes caveman afterwards.

Deactivate any time with `stop caveman` / `normal mode`. Re-arm with `/caveman`.

### Default mode override

The default level resolves from (highest priority first):

1. Environment variable `CAVEMAN_DEFAULT_MODE` (`lite | full | ultra | wenyan-* | off`)
2. `~/.config/caveman/config.json` → `{ "defaultMode": "..." }`
3. Built-in default `full`

Set to `off` to disable auto-activation on session start; you can still arm caveman manually with `/caveman`.

---

## Cavecrew — delegation decision guide

`cavecrew` is a meta-skill: it tells the **main agent** when to spawn one of three caveman-style subagents, instead of doing the work inline or using Cursor's vanilla `Explore`. Subagent tool-results come back caveman-compressed, so the bytes injected into main context are ~60 % smaller — which matters across 20+ delegations in a long session.

| Task                                                            | Use                                                  |
|-----------------------------------------------------------------|------------------------------------------------------|
| "Where is X defined / what calls Y / list uses of Z"            | `cavecrew-investigator`                              |
| Same but you also want suggestions / architecture commentary    | `Explore` (vanilla)                                  |
| Surgical edit, ≤ 2 files, scope obvious                         | `cavecrew-builder`                                   |
| New feature / 3+ files / cross-cutting refactor                 | Main thread                                          |
| Review a diff / branch / file for bugs                          | `cavecrew-reviewer`                                  |
| Deep code review with rationale + alternatives                  | `Code Reviewer` (vanilla)                            |
| One-line answer you already know                                | Main thread, no subagent                             |

**Output contracts** the parent thread can rely on (the full forms are in `.cursor/skills/cavecrew/SKILL.md`):

```text
cavecrew-investigator → path:line — `symbol` — short note ; totals: N. Or `No match.`
cavecrew-builder       → <path:line-range> — <change ≤10 words>. verified: <re-read OK | mismatch @ path:line>.
                          Or terminal first-token: too-big. / needs-confirm. / ambiguous. / regressed.
cavecrew-reviewer      → path:line: <emoji> <severity>: <problem>. <fix>. ; totals: N🔴 N🟡 N🔵 N❓
```

Chaining patterns are documented in the skill itself: **locate → fix → verify** (investigator → builder → reviewer), **parallel scout** (multiple investigators in one message), and **single-shot edit** (skip the investigator when the site is already known).

---

## Bundle locations + parity

The two trees (`.cursor/skills/` and `.agents/skills/`) carry the same set of skill bundles so the same prompt fires the same behaviour whether you're in Cursor Desktop or a CLI agent runtime:

```
.cursor/
├── rules/
│   ├── caveman.mdc           # always-on: caveman full mode for Cursor chat
│   └── graphify.mdc          # always-on: prefer graphify over grep, run `graphify update .`
└── skills/
    ├── cavecrew/             # delegation decision guide (subagent presets)
    ├── caveman/              # six-intensity compressed prose mode
    ├── caveman-commit/       # Conventional Commits generator
    ├── caveman-compress/     # rewrite .md in caveman prose, leave .original.md backup
    │   ├── SKILL.md
    │   ├── SECURITY.md
    │   └── scripts/          # cli.py + compress.py + detect.py + validate.py + benchmark.py
    ├── caveman-help/         # one-shot reference card
    ├── caveman-review/       # one-line PR / diff comments
    └── caveman-stats/        # session-level token-usage stats (hook-driven)

.agents/
└── skills/
    └── ... same set as above ...

skills-lock.json              # pins the skill bundle revisions across both trees
```

`caveman-compress` also includes a small Python toolchain under its `scripts/` directory (`cli.py` / `compress.py` / `detect.py` / `validate.py` / `benchmark.py`) so the compression pipeline (detect file type → call Claude to compress → validate output → cherry-pick fixes on validation error → up to 2 retries) runs reproducibly outside the agent. Invoke it with `python3 -m scripts <absolute_filepath>` from inside the skill directory.

---

## How to use these in this repo

1. **In Cursor** — nothing to install. The rules under `.cursor/rules/*.mdc` arm caveman + graphify on every chat in this workspace, and any `/caveman-*` slash command is recognised by the editor agent.
2. **In a CLI agent runtime (Claude Code, etc.)** — point your agent at `.agents/skills/` (the runtime usually discovers `SKILL.md` files automatically). The `skills-lock.json` at the repo root is the source of truth for which revisions you should be on.
3. **In commit messages** — `/caveman-commit` reads the staged diff and emits a Conventional Commits message you can pass straight to `git commit -F`. Caveman compression is dropped inside the commit body so it still reads cleanly in `git log`.
4. **In PR review** — `/caveman-review` walks the diff and produces one-line findings sorted by file:line, with a `🔴 / 🟡 / 🔵 / ❓` totals footer.
5. **For long memory files** — `/caveman-compress CLAUDE.md` (or any other prose memory file) rewrites the file in caveman prose in place, leaving `CLAUDE.original.md` as the human-readable backup. Code blocks, URLs, file paths, commands, and frontmatter are preserved byte-for-byte.

---

## Boundaries

The caveman family ONLY affects **agent-authored prose** (chat replies, commit messages outside the body, PR comments). It deliberately does NOT touch:

- Code (`.py`, `.js`, `.ts`, `.json`, `.yaml`, `.yml`, `.toml`, `.env`, `.lock`, `.css`, `.html`, `.xml`, `.sql`, `.sh`).
- Commit-message bodies, PR descriptions, error strings, function names, API names, file paths — all preserved exactly.
- Security warnings + irreversible-action confirmations + multi-step sequences where dropping articles could change meaning — these fall back to full English (`Auto-Clarity`), then resume caveman.

Deactivate everything with `stop caveman` / `normal mode`. Re-arm any individual skill with its slash command.
