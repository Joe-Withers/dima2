import asyncio
import fcntl
import json
import os
import pty
import struct
import termios

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .. import db, tmux
from .worktrees import active, load

router = APIRouter()


@router.get("/worktrees/{id}/sessions")
def list_sessions(id: int):
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM sessions WHERE worktree_id = ? ORDER BY id", (id,)).fetchall()
    live = tmux.states()
    return [{"id": r["id"], "command": "", "alive": False, "running": False, **live.get(r["id"], {})} for r in rows]


@router.post("/worktrees/{id}/sessions", status_code=201)
def create_session(id: int):
    with db.connect() as conn:
        w = active(load(conn, id))
        cur = conn.execute("INSERT INTO sessions (worktree_id) VALUES (?)", (id,))
        tmux.create(cur.lastrowid, w["path"])
        return {"id": cur.lastrowid}


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
    master, slave = pty.openpty()
    proc = await asyncio.create_subprocess_exec(
        "tmux", "attach", "-t", tmux.name(id),
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
    except WebSocketDisconnect:
        pass
    finally:
        pump.cancel()
        loop.remove_reader(master)
        os.close(master)
        if proc.returncode is None:
            proc.terminate()
        await proc.wait()
