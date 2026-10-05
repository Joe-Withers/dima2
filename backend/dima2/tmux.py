"""Sessions are tmux sessions: they survive browser reloads and backend restarts."""
import subprocess
import time

ACTIVE_WITHIN = 3  # seconds of pane output that count as "running"


def name(session_id: int) -> str:
    return f"dima2-{session_id}"


def tmux(*args: str, input: str | None = None) -> str:
    result = subprocess.run(["tmux", *args], capture_output=True, text=True, input=input)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"tmux {args[0]} failed")
    return result.stdout


def create(session_id: int, cwd: str, env: dict[str, str]) -> None:
    env_args = [arg for key, value in env.items() for arg in ("-e", f"{key}={value}")]
    tmux("new-session", "-d", "-s", name(session_id), "-c", cwd, "-x", "200", "-y", "50", *env_args)
    tmux("set-option", "-t", name(session_id), "remain-on-exit", "on")
    configure(session_id)


def configure(session_id: int) -> None:
    """Per-session options; also reapplied on attach so sessions made before an option existed pick it up."""
    target = name(session_id)
    tmux("set-option", "-t", target, "status", "off")  # the app has its own tab bar
    # tmux draws on the alternate screen, so the browser has no scrollback of its own: let the wheel scroll tmux's history.
    tmux("set-option", "-t", target, "mouse", "on")
    tmux("set-option", "-t", target, "history-limit", "50000")


def kill(session_id: int) -> None:
    try:
        tmux("kill-session", "-t", name(session_id))
    except RuntimeError:
        pass  # already gone


def states() -> dict[int, dict]:
    """session id -> {command, alive, running} for every live dima2 tmux session."""
    try:
        out = tmux("list-panes", "-a", "-F", "#{session_name}\t#{pane_current_command}\t#{pane_dead}\t#{window_activity}")
    except RuntimeError:  # no tmux server running
        return {}
    found = {}
    for line in out.splitlines():
        session, command, dead, activity = line.split("\t")
        if session.startswith("dima2-"):
            alive = dead == "0"
            found[int(session[6:])] = {
                "command": command,
                "alive": alive,
                "running": alive and time.time() - int(activity) < ACTIVE_WITHIN,
                "activity": int(activity),
            }
    return found


def send_text(session_id: int, text: str) -> None:
    """Paste text into the session as if typed, then submit it."""
    tmux("load-buffer", "-b", "dima2", "-", input=text)
    tmux("paste-buffer", "-b", "dima2", "-t", name(session_id), "-p", "-d")
    time.sleep(0.2)  # let the agent finish handling the paste before Enter
    tmux("send-keys", "-t", name(session_id), "Enter")
