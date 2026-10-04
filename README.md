# dima2

A UI for git worktrees across your projects: a table of everything in flight, a diff / markdown-review
workspace per worktree, and a detached tmux terminal per session. Review comments on a markdown file
can be sent straight into the active terminal session.

Design reference: `docs/initial_plan/` (brainstorm + UI mockups).

## Run

Needs Python 3.12 (with [uv](https://docs.astral.sh/uv/)), Node 18+, git and tmux.

```sh
cd frontend && npm install && npm run build   # once, and after frontend changes
cd backend && uv run uvicorn app.main:app     # http://localhost:8000
```

Development: run uvicorn with `--reload` and `npm run dev` in `frontend/` (http://localhost:5173, proxies `/api`).

State lives in `~/.dima2/dima2.db` (override with `DIMA2_DB`). Sessions are tmux sessions named `dima2-<id>`,
so they survive restarts of the backend and the browser.

## Agent status

For Claude Code sessions, dima2 writes hooks into the worktree's `.claude/settings.local.json` (git-ignored
via `.git/info/exclude`) when a session is started. They POST the agent's events to the backend using
`DIMA2_SESSION_ID` / `DIMA2_URL`, which are set only inside dima2 sessions. This drives the **needs input**
pill (a permission prompt or question is waiting), the **done** badge (the agent finished a turn and you
haven't opened the worktree since), and the attention count in the browser tab title. Other agents still get
running / idle / exited from terminal activity.

## Test

```sh
cd backend && uv run pytest
cd frontend && npm run build   # type-checks
```

## Layout

- `backend/app/git.py`, `tmux.py` — thin wrappers over the `git` and `tmux` CLIs
- `backend/app/routes/` — projects, worktrees (diff, content), sessions (PTY websocket), comments (+ send), views
- `frontend/src/workspace/` — the worktree workspace (file tree, diff, markdown review, terminal)
- `frontend/src/markdown/` — shared markdown renderer (sanitized HTML, mermaid, stable block ids)
