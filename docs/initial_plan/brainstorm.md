# dima2 — re-frame brainstorm

Working doc. Dima (the original, at `/home/joewi/Dima`) was a kanban control
plane for a ticket state machine (idea → spec → implement → PR → merge),
with Plannotator as an external CLI gate and no native terminal. This
re-frame drops the ticket/kanban model entirely and orients everything
around **projects and git worktrees**, with a native markdown review
surface and a native multi-session terminal, both built in-house instead of
shelled out to Plannotator.

Open questions are marked `**Q:**` inline — flag answers as we go so this
doc stays current rather than aspirational.

## 1. One-line pitch

A UI that manages git worktrees across registered projects, gives you a
VSCode-style way to review spec/plan markdown produced on a branch, and
lets you feed review comments straight back into a live coding-agent
terminal session in that worktree.

## 2. What's explicitly dropped vs. Dima

| Dima concept | Status in dima2 |
|---|---|
| `Ticket` state machine (idea→…→merged) | **Dropped.** No kanban stages. |
| `Action` (per-project flow defaults) | **Dropped** as a standalone entity. Launching a flow becomes "type `/thenn.run ...` into a session" — a terminal action, not a DB row. |
| Plannotator (external CLI gate) | **Dropped.** Replaced by a native markdown viewer + comment surface, built into dima2. |
| Sidebar sections (Ideas/Plans/Implementations) | **Dropped.** Replaced by one main view: the worktrees table. |
| `ChatPanel` (SDK event-stream renderer) | **Dropped** as the primary interaction surface. Replaced by a real terminal (xterm.js + PTY), tabbed per session. |
| Project scanner (`.claude/agents`, `/skills`, `/commands`, `.thenn/*`) | **Kept**, as the read-only "Views" tab. |
| Git worktree service (`git worktree add <root>/.worktrees/<id> -b <branch>`) | **Kept, generalized.** User picks the branch name; path is always `.worktrees/<branch-or-id>` under the target repo. |
| Claude Agent SDK runner | **Reconsidered.** A *real* terminal (PTY running `claude` or any CLI agent) is more general than SDK event-mapping, and gives the user raw access as requested. SDK-based structured runs may still have a place later for fully headless/unattended flows, but are not the primary interaction model. |

## 3. Core mental model

Three nested entities, no ticket layer:

```
Project (a registered repo)
  └─ Worktree (a branch checked out under .worktrees/)
       └─ Session (a terminal running inside that worktree's cwd)
```

- **Project** — a registered path on disk (same as Dima's `Project`: name + root_path). Must be a git repo.
- **Worktree** — created via `git worktree add <project_root>/.worktrees/<branch> -b <branch>`. This is the unit the whole UI revolves around — the thing a "ticket" used to be, minus the state machine. A worktree has zero or more sessions and zero or more markdown docs under review.
- **Session** — a PTY process (coding agent or plain shell) running with `cwd` = the worktree path. Multiple sessions per worktree, tabbed, ordered oldest→newest left→right.

**Resolved:** No notes field. The worktree is deliberately unopinionated about how the user wants to approach the work — brainstorming, spec-kit, or straight into implementation — so there's no freeform brief field seeding anything. `Worktree` stays lean: project_id, branch, path, base_ref. Whatever framing the work needs gets typed into the first session itself.

## 4. Main view: the worktrees table

Replaces the kanban. One row per worktree, across all projects (or filtered to one project). This is also the explicit gap identified in section 11's Pane research — Pane manages worktrees/terminals well but has no equivalent "what's the state of everything right now" progress view. That's dima2's main differentiator, not an afterthought. Columns, roughly:

- Project (color-coded, reusing Dima's `djb2(name) % 32` bucket scheme)
- Branch name
- Status — derived, not stored: last session activity (running / idle / exited), git diff stat (files changed, ahead/behind main), maybe "has unread agent output"
- Files changed (count, split e.g. "12 files · 2 specs" — total diff size plus the markdown subset, since markdown docs are the ones likely to need review)
- Last activity timestamp

Clicking a row opens the worktree detail view (section 6). A "+ New worktree" action opens the creation dialog (section 5).

**Resolved:** Archive. "Done" worktrees move out of the default table view into a collapsed/filterable "done" section rather than disappearing outright — `git worktree remove` runs (or is offered as a one-click action) to actually clean up `.worktrees/` on disk, but the row and its history (sessions, comments) stay browsable in the archived view.

## 5. Creating a worktree

Minimal dialog:
1. Select project (from registered projects)
2. Branch name (text input — also doubles as the worktree dirname, so validate it's filesystem-safe and doesn't collide)
3. Base branch/ref to branch from (default: project's default branch, e.g. `main`)
4. Optional: notes field (see Q above)

On submit: **resolved** — drop Dima's dirty-checkout guard. `git worktree add` branches from the chosen base ref (e.g. `origin/main`/a tag/another branch tip), not from the main checkout's working-directory state, so an uncommitted change sitting in the primary checkout never blocks spinning up a new worktree: `git worktree add <root>/.worktrees/<branch> -b <branch> <base-ref>`.

## 6. Worktree detail view (VSCode-style layout)

```
┌─────────────────────────────────────────────────────────┐
│ Worktree header: project / branch, git status, actions   │
├───────────────┬───────────────────────────────────────────┤
│               │                                           │
│ Changed-files │   Diff view (non-.md)                     │
│ tree (full    │     or                                    │
│ git diff vs   │   Markdown preview + comments (.md)        │
│ base ref)     │                                           │
│               │                                           │
├───────────────┴───────────────────────────────────────────┤
│  [session-1] [session-2] [+ new session]      ← tab bar   │
│                                                           │
│                 Terminal (PTY output)                     │
└─────────────────────────────────────────────────────────┘
```

Revised per Pane-inspired feedback: the file selector shows the **full set of changed files** (VS Code-style tree, status letters M/A/D, like Pane's own diff view), not just markdown. Markdown gets special treatment on *selection*, not on *listing*:

- **File tree (left)**: every file changed/added on this branch relative to its base ref (`git diff --name-only <base>...HEAD` plus untracked files), full repo scope — this is the general-purpose VS Code-style changes view, matching what both VS Code and Pane already show.
- **Center panel, non-markdown file selected**: a standard diff view (old vs new, or unified — TBD) — this is "just" a diff viewer, no comments/agent-feedback behavior.
- **Center panel, markdown file selected**: auto-switches to **rendered preview mode** (not raw diff) — this is the Plannotator replacement. Select text, attach a comment. Deliberately simpler UI than Plannotator (user's explicit ask) — likely just: rendered markdown, click-and-drag to select a passage, small inline "add comment" affordance, comments list in a side rail. No modal dialogs, no separate review-session concept. Comments stored per-worktree, keyed to file + anchor (see section 7 for anchoring approach).
- **Terminal (bottom)**: always present once a worktree is selected, VSCode-style. Tabbed sessions, oldest-left/newest-right, "+" tab spawns a new session at the far right.

**Resolved:** empty state with a hint ("select a file to view, or just use the terminal below") — not a default diff summary, and the terminal does not auto-expand to fill the space; the split layout stays fixed, the top panel is just blank with the hint until a file is picked.

**Resolved — scope locked against Plannotator's actual feature list.** Plannotator ([backnotprop/plannotator](https://github.com/backnotprop/plannotator)) turns out to be a full review platform: plan/markdown/diff/PR review across 4 VCS backends (git/GitButler/Jujutsu/Perforce), GitHub/GitLab PR review, AI-assisted "Ask AI"/"Review Agents"/"Guided Review", multiple annotation types (plain comment, redline/strikethrough, semantic markup, label/tag), approve/deny/dismiss decision workflow, Vim controls + HUD overlay, encrypted cloud sharing + a hosted "Workspaces" collab product, VS Code/Obsidian/Bear editor integrations, and its own installer/security-attestation tooling (SLSA, SBOM). dima2 takes one thin slice of this and explicitly drops the rest:

| Keep (maps directly to dima2) | Cut (explicitly out of scope) |
|---|---|
| Plain-text comment, one annotation type | Redline/strikethrough, semantic markup, label/tag annotation types |
| Pinpoint-style block targeting (section 7's resolved block-ID anchoring) | Vim controls / Vim HUD overlay |
| Rendered markdown preview alongside the comment surface | Diff-review / PR-review / multi-VCS modes (GitButler, Jujutsu, Perforce) — section 6's diff view is a plain `git diff` vs base ref, nothing more |
| Return-feedback-to-agent path ("send to agent," section 7) | Approve/deny/dismiss decision workflow — no gating, per section 12's "don't build gating in" call |
| — | AI-assisted review (Ask AI / Review Agents / Guided Review) — the live agent terminal *is* the intelligence layer, no secondary review-AI |
| — | Sharing/collaboration (URL fragment sharing, encrypted upload, hosted Workspaces, paste service) — single-user local tool, comments are DB-backed per section 7, never need an external link |
| — | External editor integrations (VS Code/Obsidian/Bear/Amp plugins) — dima2 is its own UI |
| — | Multi-agent-hook installer plumbing (per-agent slash commands, `plannotator sessions`/`archive` CLI) — superseded by section 8.1's generic PTY-level "send to agent," which needs no per-agent install step |
| — | Distribution/security tooling (SLSA attestations, SBOM, checksums) — not a distributed tool (yet) |

Net effect: dima2's markdown surface is comment + preview + send-to-agent, full stop — no decision state, no annotation-type picker, no secondary AI, no sharing.

## 7. Markdown review & "send to agent" flow

This is the Plannotator-replacement and the most novel part. Rough flow:

1. A session (e.g. running a spec-kit `/specify` flow) writes/updates a `.md` file in the worktree.
2. It shows up in the changed-files tree (section 6) automatically, like any other changed file — no manual registration. Selecting it (rather than some other changed file) is what triggers preview+comment mode instead of a plain diff.
3. User opens it in the viewer, selects passages, adds comments (free text per selection/anchor).
4. User optionally types extra freeform context in a side box (not tied to a specific selection).
5. User clicks **"Send to agent"** → this:
   - Targets the currently active session tab (**resolved** — whichever tab is focused when "Send to agent" is clicked; to target a different session, click its tab first)
   - Formats all comments + extra context into one message, e.g.:
     ```
     Review comments on specs/003-foo/spec.md:

     > [selected text 1]
     Comment: ...

     > [selected text 2]
     Comment: ...

     Additional context: <freeform box>
     ```
   - Writes that formatted text into the target terminal session (as if typed/pasted) and submits it.
6. Comments are marked "sent" (with a timestamp) but stay visible/resolved-able — not deleted, so there's a review history per file.

**Resolved:** DB-backed, keyed by (project, branch, file path, anchor, text, sent_at) — not a worktree-local sidecar file. Avoids any risk of review comments getting accidentally committed, and comments still survive a worktree being removed/recreated as long as the branch name is unchanged (the key is branch-based, not tied to the worktree directory instance).

**Resolved: block-ID anchoring, matching Plannotator's actual mechanism.** (Verified by reading Plannotator's ADRs at [github.com/backnotprop/plannotator](https://github.com/backnotprop/plannotator/tree/main/adr) — it's open-source, contrary to the earlier finding that only a closed local binary was reachable.) Plannotator's markdown/description annotation surface renders through a shared renderer that tags each block (paragraph, list item, etc.) with a stable `data-block-id`, and a `useAnnotationHighlighter` + `CommentPopover` engine anchors comments to that block ID — not line numbers, not quoted-text search. dima2 adopts the same scheme: the markdown-preview renderer assigns a stable id per block at render time; a comment stores `(file_path, block_id, body, created_at, sent_at)`. This survives line-number drift from edits elsewhere in the file and only goes stale if the specific block itself is edited or removed (at which point it can be flagged "block not found," same failure mode quoted-text search would have had). Side note from the same research: Plannotator's own *comment*-level annotations (a separate surface, phase 2) skip positional anchoring entirely and attach to the whole comment object — their own authors apparently found granular in-prose anchoring tricky enough to avoid on at least one surface, worth remembering if block-ID anchoring proves fiddly in practice for dima2's renderer.

## 8. Terminal / session model

- PTY-backed (likely `node-pty` or similar on the backend, or Python `ptyprocess`, streamed over a websocket to an `xterm.js` frontend — a genuinely new backend primitive vs. Dima's SDK-event-mapping approach).
- A session's shell starts in the worktree's directory. First command is free-form — could be `claude`, could be `pi`, could be `/thenn.run specify ...`, could be plain bash. No special-casing "this is an agent session" vs "this is a shell" at the data-model level; it's just a PTY.
- Tabs ordered by creation time, oldest→newest, left→right. "+" always appends far right.
- **Resolved:** detached, survives restarts. PTYs are kept alive server-side (wrapped in something like `tmux`/`screen`, or a custom PTY-manager process) and the websocket just re-attaches on reconnect — a live agent run must not die just because a browser tab closed or the backend restarted.
- **Resolved:** out of scope for v1. No per-session/per-worktree resource caps — this is a single-user local tool where the user is watching terminals directly, so budget governance isn't adding the kind of safety it did in Dima's more automated/unattended flow.

### 8.1 Agent-agnostic by construction (not Claude-Code-specific)

The user currently uses Claude Code but expects to move to **Pi** (earendil-works/pi — an open-source, minimal terminal coding-agent harness with 15+ model-provider support and a TypeScript extension API) at some point, and wants dima2 built so swapping agents later doesn't mean rewriting the orchestrator.

**Decision: don't build dima2 as a Pi extension.** Pi's extension API is real but shaped for customizing *one agent's behavior in-process* (block/rewrite tool calls, inject context, add tools/slash-commands, redraw Pi's own terminal UI) — it runs inside a single Pi session. dima2 sits *above* many worktrees and many concurrent agent sessions, where the agent itself needs to be swappable (Claude Code today, Pi tomorrow, maybe Codex or plain bash). Building inside Pi's process model would entangle the whole orchestrator with one harness — the opposite of the stated goal.

**Instead**: keep the session model's only required primitive as "launch a command in a PTY, cwd = worktree path, send/receive bytes." Concretely:
- `Session.launch_command` is a free-form string (`claude`, `pi`, `codex`, `bash`, a thenn flow, anything) — not an `agent_type` enum with special-cased branching logic. This is the lowest common denominator and works identically for every agent, matching Pane's own "if it runs in a terminal, it runs in it" principle (section 11).
- "Send to agent" (section 7) stays at this same lowest-common-denominator level: format the message as text, write it into the target PTY, submit — no agent-specific API call. Works for Claude Code, Pi, or anything else without per-agent integration code.
- Status detection (idle/running/waiting-for-input, for section 4's table) has to come from PTY output heuristics at this level — genuinely cruder than a structured event, but uniform across agents.

**Future upgrade path (explicitly out of scope for v1, but don't design against it)**: for harnesses that expose a richer extension/hook API — Pi being the concrete first candidate — a thin *optional* companion extension could feed structured events (turn-start/turn-end, idle/busy, tool-call events) back to dima2 over a local socket, giving nicer status than output-scraping and cleaner context injection than typing into a PTY. This would be a per-harness adapter layered *on top of* the PTY baseline, never a replacement for it — a session with no such adapter installed must keep working via plain PTY I/O alone.

## 9. Views tab (kept from Dima)

Read-only tab, scoped per project: browse `.claude/agents/*.md`, `.claude/skills/*/SKILL.md`, `.claude/commands/*.md`, `.thenn/*.thenn|.yaml` — i.e. keep Dima's `scanner.py` concept essentially as-is. This is pure visibility, no actions hang off it (Actions-as-an-entity is gone per section 2).

## 10. Backend architecture sketch (loose, pre-spec)

- **Entities**: `Project` (name, root_path), `Worktree` (project_id, branch, path, base_ref, notes, created_at, status derived not stored), `Session` (worktree_id, pty handle/id, created_at, label), `Comment` (project_id, branch, file_path, anchor_text, body, created_at, sent_at nullable).
- **API surface**: REST for CRUD (projects/worktrees/comments) + websocket for PTY I/O per session. No `Run`/`Ticket`/`Action` tables.
- **Worktree lifecycle service**: generalizes Dima's `worktrees.py` — parameterize branch name (currently hardcoded `dima/<uuid>`), keep the dirty-tree / branch-exists / path-exists error handling, drop the "attached to a ticket" assumption.
- **Diff service**: new — `git diff --name-only <base>...HEAD` + untracked files, full repo scope, feeds the changed-files tree. Per-file diff content fetched on selection. Markdown files additionally get a rendered-preview endpoint (just the file content at HEAD, for the preview pane).
- **PTY manager**: new — the biggest net-new backend component. Needs session registry (which PTYs are alive, which worktree they belong to), a way to survive backend restarts gracefully (or at least fail visibly rather than silently dropping sessions).

## 11. Prior art (quick scan)

- **Conductor** (conductor.build) is the closest match: main view is a dashboard of parallel workspaces, each = one worktree + one branch + one agent; "New Workspace" runs `git worktree add` on a fresh branch directly from the UI — exactly the section-5 flow. It's diff-centric for review (no markdown-comment layer), which is the gap this doc is filling.
- **Cursor background agents**: each agent is an isolated worktree/branch, but chats aren't grouped by worktree in the UI — branch only shows on hover. Explicit anti-pattern to avoid: section 4's table makes worktree the persistent, visible grouping key, not a hover tooltip.
- **Devin**: session list (chronological) + session detail + workspace pane, with a fixed Task→Plan→PR→Summary structure per session. Its "Playbook" list (reusable prompts per task type) is shown as a table with session count / merged PRs / weekly activity — a reasonable model for section 4's status columns and for section 9's Views tab if it ever grows beyond pure read-only browsing.
- **OpenHands**: single-session only, terminal pinned bottom-right under a file view — confirms the VSCode-style "terminal docked at the bottom" layout in section 6 is a well-trodden default, not an unusual choice.
- **GitButler**: deliberately avoids worktrees (virtual branches in one working dir instead) — the contrasting philosophy, useful only as a note that sticking with real `git worktree` (as this doc does) is a considered choice, not an oversight.
- **Markdown-comment → agent-prompt feedback** (section 7): no existing tool found that does this. The closest industry pattern (agentic PR reviewers) treats the diff + prior comments as serialized markdown context, which matches the format in section 7 — but the "select comment → inject into a live terminal session" interaction itself appears to be new ground, not a retrofit.

## 12. WSFF ("Why Software Factories Fail", humanlayer) — relevant points

Source: [wsff.md](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/wsff.md). Thesis: "lights-off" agent coding degrades architecture over time because test-passing gives fast feedback but bad design consequences show up weeks later — models have no training signal for that gap. Fix is human-in-the-loop *planning* review, front-loaded, before the agent writes implementation code. Key quote: "30 minutes of planning saves hours of review."

Points that directly bear on this tool's design:

- **Specs are a staged sequence of docs, not one file**: Product Review (problem/outcomes, HTML mockups) → System Architecture (sequence diagrams, endpoint contracts, data model) → Program Design (pseudocode call stacks, file-tree diffs, typed signatures) → Vertical Slices (implemented end-to-end, reviewed every 1-3 slices). This **validates last turn's decision** to show the full changed-files tree rather than a markdown-only list — a real spec-driven branch will have several markdown docs in flight at once (product/architecture/program-design), not a single spec.md, and the tool shouldn't need to know which phase a doc belongs to — it's still just "a changed markdown file, preview it."
- **Diagrams and mockups are load-bearing, not decorative**: "To maximize human<>agent communication bandwidth, we make heavy use of visualizations" — sequence diagrams, file-tree diffs, HTML mockups embedded directly in the markdown. **Concrete requirement for section 6's preview pane**: it must render Mermaid code blocks and embedded images/HTML, not just plain prose-to-HTML. A preview that flattens diagrams to unrendered code fences would break the actual workflow this tool is meant to support.
- **Comments belong at the spec-review stage, before code** — "author-opt-in reviews," circulating incomplete specs for async feedback rather than finishing them alone. This is a direct endorsement of section 7's whole premise (comment on the doc, send to agent) rather than reviewing after the fact via diff/PR.
- **Tension to resolve deliberately, not by default**: WSFF's "slice-gating" (don't let the agent advance to the next phase until the prior one is reviewed) implies enforced workflow state — which is exactly the ticket/kanban machinery section 2 drops. Leaning: don't build gating into the tool. Treat it as a discipline enforced by the user/agent prompt (e.g. the spec-kit flow's own instructions), not a backend-enforced status field. The tool's job stays "surface the docs, let you comment, let you send to the agent" — it doesn't need to know or care what phase a doc represents.
- **Vertical slices → sessions, not worktrees**: the review-every-1-3-slices cadence happens *within* one branch/worktree, over multiple agent turns — doesn't imply one worktree per slice. Reinforces that a worktree can reasonably host several sessions over its lifetime (section 8) rather than being single-use.

## 13. Tech stack & hosting

### 13.1 Hosting: all local

**Decision:** everything runs locally; no cloud-hosted component. A browser can't spawn or reach local processes by itself, so the backend must run on the user's machine anyway, and a hosted UI/relay would turn a compromised login into remote code execution on that machine. Options considered and set aside: hosted UI + outbound relay (the "Remote Pane" idea), hosted UI talking to `localhost` (no benefit over serving locally), a private-network tunnel such as Tailscale (the cheapest route to remote access if it's ever wanted), and cloud-run agents (the Conductor Cloud model, explicitly not wanted).

Design constraint kept for later: the frontend↔backend contract is plain REST plus a WebSocket for PTY I/O, with no assumption that they share a host. Remote access would then be a deployment change, not a rewrite.

### 13.2 Process model

One process. The FastAPI backend owns PTYs, `git`/worktrees, file watching and the DB, serves the REST API and PTY WebSocket, and serves the built React app as static files. "Daemon" in earlier discussion just means this backend in its role of running on the user's machine; it is not a separate program. Session persistence (section 8) comes from running each session inside `tmux` on Linux/macOS/WSL, with the backend attaching through a PTY. No custom PTY-holder is needed unless a native Windows host is added (see 13.4).

### 13.3 Stack

| Layer | Choice | Notes |
|---|---|---|
| Backend | Python + FastAPI | Reuses Dima's worktree service and project scanner. Native WebSocket support. |
| PTY | `ptyprocess` / stdlib `pty` with asyncio, sessions held in `tmux` | `pywinpty` (ConPTY) is the Windows equivalent if a Windows host is added. |
| File watching | `watchfiles` | Pushes "files changed" and agent-activity updates to the UI. |
| DB | SQLite (stdlib `sqlite3`, WAL mode) | Ships with Python on every OS, nothing to install. Stored under `~/.dima2/` (or the XDG data dir). Data is tiny: projects, worktrees, sessions, comments. Plain `sqlite3` plus a small migrations table unless SQLAlchemy is wanted. |
| Frontend | React + TypeScript + Vite | Built to static files, served by FastAPI. |
| Terminal | `xterm.js` + fit addon | |
| Markdown preview | `react-markdown` (remark/rehype) | Small remark plugin stamps a stable block ID on each block (section 7 anchoring). `rehype-sanitize`/DOMPurify for sanitized HTML, `mermaid` for diagrams. |
| Diff view | `react-diff-view` (start here) | Monaco diff is the heavier alternative. |
| Layout | `react-resizable-panels` | VS Code-style split. |
| Data fetching | TanStack Query + WebSocket | REST for CRUD, WebSocket for PTY and live updates. |

Python-vs-TypeScript backend was discussed. Node + `node-pty` is more battle-tested for PTYs (VS Code uses it) and would give one language across the stack, but `pywinpty` is a sound Windows option and the Dima code is Python, so Python stays. Language is not what decides Windows support; the cost there is the lack of `tmux` (13.4).

### 13.4 Environment: WSL first, multi-host later

The user develops in WSL, but some projects (e.g. Android) live on the Windows filesystem because the emulator, SDK, Gradle and `adb` work properly there. Where the backend runs decides where PTYs and `git` run, so each project's agent should run on the side where its toolchain lives.

**Decision:** v1 is a single backend running in WSL. Put a `host` field on `Project` (default `local`) so a second host can be added without a schema change. A Windows host would be a second copy of the same backend running natively on Windows, with the UI talking to both and showing one worktrees table. WSL2 forwards `localhost`, so a browser on Windows reaches either backend.

Cost of adding the Windows host later: no `tmux`, so detached sessions need a small PTY-holder process we write, plus `pywinpty` for ConPTY. Reaching Windows-hosted projects from the WSL backend via `/mnt/c` is the thing to avoid: slow git, line-ending problems, and the Android tools wouldn't be in the agent's environment.

## 14. UI overview

Consolidates sections 4–9 into the screens a user actually sees.

**Navigation:** a slim bar with three items: **Worktrees** (home), **Views** (read-only), **Projects** (register/remove repos: name, path, host). Everything else is reached from the worktrees table. Opening a worktree shows its workspace, and a back link returns to the table.

**Worktrees page:** one row per worktree across all projects, with a project filter, search, a "show archived" toggle and a **+ New worktree** button (project dropdown, branch name, base ref; no notes field). Columns: project (colour dot), branch, derived status (running / idle / exited / needs input where detectable), changes (total files plus the markdown subset, e.g. "12 files · 2 md"), last activity. Row menu: Archive (runs `git worktree remove`, moves the row to the archived view).

**Worktree workspace:**

```
┌────────────────────────────────────────────────────────────────────────┐
│ ← Worktrees   project / branch    ↑2 ↓0 vs base            [Archive]    │
├──────────────┬─────────────────────────────────────────────────────────┤
│ CHANGES      │  empty state hint │ diff (non-md) │ md preview+comments  │
│ (file tree)  │                                                          │
├──────────────┴─────────────────────────────────────────────────────────┤
│ [session 1] [session 2] [+]            ← oldest left, newest right       │
│ terminal (xterm.js)                                                      │
└────────────────────────────────────────────────────────────────────────┘
```

- **Left:** changed-files tree for the branch (full repo scope, M/A/D markers, live via the file watcher).
- **Centre:** empty state with a hint when nothing is selected; a diff for non-markdown files; for `.md` files, rendered preview plus a comment rail (comments list, extra-context box, **Send to <active tab>** button). One file open at a time, no editor tabs.
- **Bottom:** the tabbed terminal, always present once a worktree is open. `+` appends a plain-shell session at the far right; the user starts `claude`/`pi` by typing it.

**Views page:** project picker plus a list of agents, skills, commands and flows; selecting one shows its rendered definition. Nothing is runnable.

### 14.1 Panel sizing: "almost maximise" shortcuts

The top (files + centre) and bottom (terminal) regions are separated by a draggable divider. In addition:

- **Ctrl+Up** "almost maximises" the top region; **Ctrl+Down** "almost maximises" the bottom (terminal) region.
- "Almost" means the other region collapses to a thin strip rather than disappearing: the terminal keeps its tab bar visible, and the top keeps its panel headers, so there is always something to click to bring it back.
- Three states: **balanced** (default, the draggable split), **top-max** and **bottom-max**. Ctrl+Up moves one step towards top-max (balanced → top-max; bottom-max → balanced), and Ctrl+Down moves one step towards bottom-max. Pressing the same direction when already at that extreme does nothing.
- The shortcuts must be handled at the app level so they work while the terminal has focus: xterm.js has to be told not to forward Ctrl+Up/Down to the PTY. Ctrl+Up/Down is rarely used by shells or agents, so little is lost. The collapsed strips are also clickable as a mouse fallback.
- On macOS Ctrl+Up/Down is bound to Mission Control by default, so a second binding may be needed there. Not a concern while the user is on WSL/Windows.
- Layout state (balanced ratio and which maximise state is active) is global, not per worktree, and is remembered across reloads, so returning from a maximised state restores the user's last drag position. The collapsed strip is a fixed height of about 40px, just enough for the header/tab bar.

## 15. Open questions to resolve before writing a spec

A. ~~Centre panel tabs~~ — **Resolved: one file at a time**, no editor-style tabs (section 14). Comments persist, so moving away loses nothing.
B. ~~Notifications~~ — **Resolved: row badge + browser tab title.** A worktree that finishes or needs input shows a badge on its table row and adds to an attention count in the tab title. No desktop notifications or popups for v1 (section 14).
C. ~~"Almost maximise" state~~ — **Resolved: global, fixed strip.** One layout state for the whole app, remembered across worktrees and reloads; the collapsed region shrinks to its header/tab bar (about 40px) (section 14.1).
D. ~~Windows-side (Android) projects~~ — **Resolved: rare, defer.** WSL-only for v1; keep the `host` field on `Project` so a Windows host can be added later (section 13.4).

Resolved so far (kept for the record):

1. ~~Minimal "worktree notes" field~~ — **Resolved: no** (section 3).
2. ~~Worktree cleanup~~ — **Resolved: archive** (collapsed/filterable "done" section, history stays browsable) (section 4).
3. ~~Dirty-main-checkout guard~~ — **Resolved: drop it**, branch from the base ref regardless (section 5).
4. ~~Default/empty state of the top panel~~ — **Resolved: empty state with a hint**, no auto-expand (section 6).
5. ~~Which session "Send to agent" targets~~ — **Resolved: currently active tab** (section 7).
6. ~~Comment storage~~ — **Resolved: DB-backed**, keyed by (project, branch, file path, anchor) (section 7).
7. ~~Comment anchoring~~ — **Resolved: block-ID**, matching Plannotator's own `data-block-id` scheme (section 7).
8. ~~Session persistence across refresh/restart~~ — **Resolved: detached PTY** (tmux-like), survives restarts (section 8).
9. ~~Per-session/per-worktree resource caps~~ — **Resolved: out of scope for v1** (section 8).
10. ~~Markdown preview rendering scope~~ — **Resolved: render live, sanitized** (section 12). Raw embedded HTML renders in the preview pane after running through a sanitizer (e.g. DOMPurify) to strip scripts/event handlers, matching WSFF's "HTML mockups embedded directly in markdown" use case literally rather than degrading it to a fenced block. Mermaid and images render via their own dedicated renderers as already planned. Takes on ongoing sanitizer maintenance as a tradeoff.
