# <img src="frontend/public/dima2-icon.svg" alt="" width="48" align="center"> dima2

A UI for git worktrees across your projects: a table of everything in flight, a diff / markdown-review
workspace per worktree, and a detached tmux terminal per session. Review comments on a markdown file
can be sent straight into the active terminal session.

Design reference: `docs/initial_plan/` (brainstorm + UI mockups).

## Install

Needs [uv](https://docs.astral.sh/uv/), git, tmux and curl (Linux or macOS; on Windows, use WSL).

```sh
uv tool install --force https://github.com/Joe-Withers/dima2/releases/download/v0.4.2/dima2-0.4.2-py3-none-any.whl
dima2                                          # http://localhost:8000
```

To upgrade, run the install command shown on the [latest release](https://github.com/Joe-Withers/dima2/releases/latest).
`dima2 --help` lists the options (`--host`, `--port`). It listens on localhost only by default, since its terminals
give shell access.

### Open it as an app

With dima2 running, Chrome and Edge can install the page as an app with its own window and taskbar/dock icon:

- **Chrome:** ⋮ menu → *Cast, save and share* → *Install page as app…* (older versions: *More tools* → *Create
  shortcut…* → tick *Open as window*)
- **Edge:** ⋯ menu → *Apps* → *Install this site as an app*

The app is just a window onto the server, so `dima2` still has to be running, and it is tied to the address it was
installed from: install it again if you change `--port`. On WSL, install it from the Windows browser; `localhost`
is forwarded.

State lives in `~/.dima2/dima2.db` (override with `DIMA2_DB`). Sessions are tmux sessions named `dima2-<id>`,
so they survive restarts of the backend and the browser.

## Develop

Needs Node 18+ as well.

```sh
cd frontend && npm install && npm run dev      # http://localhost:5173, proxies /api
cd backend && uv run dima2 --reload
```

A source checkout serves `frontend/dist` if it's built (`npm run build`), so `uv run dima2` alone works too.

To release, bump `version` in `backend/pyproject.toml` and the install URL above, commit, and push a matching tag (`git tag v0.2.0 && git push
--tags`). The Release workflow builds the frontend into the wheel and attaches it to a GitHub release.

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

- `backend/dima2/git.py`, `tmux.py` — thin wrappers over the `git` and `tmux` CLIs
- `backend/dima2/routes/` — projects, worktrees (diff, content), sessions (PTY websocket), comments (+ send), views
- `frontend/src/workspace/` — the worktree workspace (file tree, diff, markdown review, terminal)
- `frontend/src/markdown/` — shared markdown renderer (sanitized HTML, mermaid, stable block ids)

## License

[MIT](LICENSE)
