import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import db, tmux
from .worktrees import active, load

router = APIRouter()


class CommentIn(BaseModel):
    path: str
    block_id: str
    quote: str
    body: str


class SendIn(BaseModel):
    path: str
    session_id: int
    extra: str = ""


@router.get("/worktrees/{id}/comments")
def list_comments(id: int, path: str):
    with db.connect() as conn:
        w = load(conn, id)
        rows = conn.execute(
            "SELECT * FROM comments WHERE project_id = ? AND branch = ? AND file_path = ? ORDER BY id",
            (w["project_id"], w["branch"], path),
        )
        return [dict(r) for r in rows]


@router.post("/worktrees/{id}/comments", status_code=201)
def add_comment(id: int, body: CommentIn):
    with db.connect() as conn:
        w = load(conn, id)
        cur = conn.execute(
            "INSERT INTO comments (project_id, branch, file_path, block_id, quote, body) VALUES (?, ?, ?, ?, ?, ?)",
            (w["project_id"], w["branch"], body.path, body.block_id, body.quote, body.body),
        )
        return dict(db.get(conn, "comments", cur.lastrowid))


@router.delete("/comments/{id}", status_code=204)
def delete_comment(id: int):
    with db.connect() as conn:
        conn.execute("DELETE FROM comments WHERE id = ?", (id,))


def format_message(path: str, comments: list, extra: str) -> str:
    parts = [f"Review comments on {path}:"]
    parts += [f"> {c['quote']}\nComment: {c['body']}" for c in comments]
    if extra.strip():
        parts.append(f"Additional context: {extra.strip()}")
    return "\n\n".join(parts)


@router.post("/worktrees/{id}/send")
def send_to_session(id: int, body: SendIn):
    """Paste all unsent comments on a file (plus extra context) into a session, and mark them sent."""
    with db.connect() as conn:
        w = active(load(conn, id))
        session_ids = [r["id"] for r in conn.execute("SELECT id FROM sessions WHERE worktree_id = ? ORDER BY id", (id,))]
        if body.session_id not in session_ids:
            raise HTTPException(404, "session not found in this worktree")
        comments = conn.execute(
            "SELECT * FROM comments WHERE project_id = ? AND branch = ? AND file_path = ? AND sent_at IS NULL ORDER BY id",
            (w["project_id"], w["branch"], body.path),
        ).fetchall()
        if not comments and not body.extra.strip():
            raise HTTPException(400, "nothing to send")
        try:
            tmux.send_text(body.session_id, format_message(body.path, comments, body.extra))
        except RuntimeError as e:
            raise HTTPException(409, f"could not reach the session: {e}")
        sent_to = f"session {session_ids.index(body.session_id) + 1}"
        conn.executemany(
            "UPDATE comments SET sent_at = ?, sent_to = ? WHERE id = ?",
            [(int(time.time()), sent_to, c["id"]) for c in comments],
        )
