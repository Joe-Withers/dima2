"""Claude Code hooks that report what the agent is doing back to dima2.

Each dima2 session is started with DIMA2_SESSION_ID and DIMA2_URL in its environment, and the hooks below
(written to the worktree's gitignored .claude/settings.local.json) POST every event to the backend. Outside a
dima2 session the variable is unset and the hook does nothing.
"""
import json
from pathlib import Path

from . import git

COMMAND = (
    '[ -n "$DIMA2_SESSION_ID" ] && curl -fsS -m 2 -X POST -H "Content-Type: application/json" --data-binary @- '
    '"$DIMA2_URL/api/sessions/$DIMA2_SESSION_ID/hook" >/dev/null 2>&1 || true'
)
EVENTS = ["UserPromptSubmit", "PermissionRequest", "Notification", "PostToolUse", "Stop"]


def install(worktree: str) -> None:
    """Add the reporting hooks to the worktree's settings.local.json, keeping anything already in it."""
    path = Path(worktree) / ".claude" / "settings.local.json"
    settings = json.loads(path.read_text()) if path.exists() else {}
    for event in EVENTS:
        groups = settings.setdefault("hooks", {}).setdefault(event, [])
        if not any(h.get("command") == COMMAND for g in groups for h in g.get("hooks", [])):
            groups.append({"hooks": [{"type": "command", "command": COMMAND, "async": True}]})
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(settings, indent=2) + "\n")
    git.ignore_locally(worktree, ".claude/settings.local.json")
