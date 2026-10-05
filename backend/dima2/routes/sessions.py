import asyncio
import fcntl
import json
import os
import pty
import signal
import struct
import termios

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from .. import db, hooks, tmux
from .worktrees import active, load

router = APIRouter()


@router.get("/worktrees/{id}/sessions")
def list_sessions(id: int):
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM sessions WHERE worktree_id = ? ORDER BY id", (id,)).fetchall()
    live = tmux.states()
    return [
        {"id": r["id"], "command": "", "alive": False, "running": False, "agent_state": r["agent_state"], **live.get(r["id"], {})}
        for r in rows
    ]


@router.post("/worktrees/{id}/sessions", status_code=201)
def create_session(id: int, request: Request):
    host, port = request.scope["server"]
    with db.connect() as conn:
        w = active(load(conn, id))
        try:
            hooks.install(w["path"])
        except ValueError:
            raise HTTPException(409, f"{w['path']}/.claude/settings.local.json is not valid JSON")
        cur = conn.execute("INSERT INTO sessions (worktree_id) VALUES (?)", (id,))
        env = {"DIMA2_SESSION_ID": str(cur.lastrowid), "DIMA2_URL": f"http://{host}:{port}"}
        tmux.create(cur.lastrowid, w["path"], env)
        return {"id": cur.lastrowid}


class HookEvent(BaseModel):
    """The part of a Claude Code hook payload we use."""

    hook_event_name: str
    notification_type: str | None = None


STATE_FOR_EVENT = {"UserPromptSubmit": "running", "PostToolUse": "running", "PermissionRequest": "needs_input", "Stop": "done"}
# Permission notifications arrive late, after PermissionRequest, so they could resurrect an answered prompt.
NEEDS_INPUT_NOTIFICATIONS = {"elicitation_dialog", "agent_needs_input"}


@router.post("/sessions/{id}/hook", status_code=204)
def agent_hook(id: int, event: HookEvent):
    state = STATE_FOR_EVENT.get(event.hook_event_name)
    if event.hook_event_name == "Notification" and event.notification_type in NEEDS_INPUT_NOTIFICATIONS:
        state = "needs_input"
    if state:
        with db.connect() as conn:
            conn.execute("UPDATE sessions SET agent_state = ? WHERE id = ?", (state, id))


@router.post("/worktrees/{id}/seen", status_code=204)
def mark_seen(id: int):
    """Opening a worktree acknowledges 'done'; 'needs_input' stays until the agent moves on."""
    with db.connect() as conn:
        conn.execute("UPDATE sessions SET agent_state = NULL WHERE worktree_id = ? AND agent_state = 'done'", (id,))


@router.delete("/sessions/{id}", status_code=204)
def close_session(id: int):
    tmux.kill(id)
    with db.connect() as conn:
        conn.execute("DELETE FROM sessions WHERE id = ?", (id,))


def resize(fd: int, cols: int, rows: int) -> None:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


@router.websocket("/sessions/{id}/ws")
async def attach(ws: WebSocket, id: int):
    """Bridge the browser to `tmux attach`. Binary frames are keystrokes; text frames are JSON control messages."""
    await ws.accept()
    try:
        tmux.configure(id)
    except RuntimeError:
        pass  # session is gone; attach below reports it
    master, slave = pty.openpty()
    proc = await asyncio.create_subprocess_exec(
        "tmux", "-u", "attach", "-t", tmux.name(id),
        stdin=slave, stdout=slave, stderr=slave, start_new_session=True,
        env={**os.environ, "TERM": "xterm-256color"},
    )
    os.close(slave)
    loop = asyncio.get_running_loop()
    output: asyncio.Queue[bytes] = asyncio.Queue()

    def on_readable():
        try:
            output.put_nowait(os.read(master, 65536))
        except OSError:  # tmux exited
            loop.remove_reader(master)
            output.put_nowait(b"")

    loop.add_reader(master, on_readable)

    async def pump_output():
        while data := await output.get():
            await ws.send_bytes(data)
        await ws.close()

    pump = asyncio.create_task(pump_output())
    try:
        while True:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                break
            if message.get("bytes"):
                os.write(master, message["bytes"])
            elif message.get("text"):
                size = json.loads(message["text"])["resize"]
                resize(master, *size)
                # tmux runs in its own session without this pty as its controlling terminal, so the kernel doesn't
                # deliver SIGWINCH on resize; without it tmux keeps the old size until something else redraws.
                if proc.returncode is None:
                    proc.send_signal(signal.SIGWINCH)
    except WebSocketDisconnect:
        pass
    finally:
        pump.cancel()
        loop.remove_reader(master)
        os.close(master)
        if proc.returncode is None:
            proc.terminate()
        await proc.wait()
