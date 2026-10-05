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
    path: str | None = None  # one file's comments; omitted sends every unsent comment on the branch
    session_id: int
    extra: str = ""


@router.get("/worktrees/{id}/comments")
def list_comments(id: int, path: str | None = None):
    """Comments on one file, or on every file of the branch when no path is given."""
    with db.connect() as conn:
        w = load(conn, id)
        return [dict(r) for r in for_branch(conn, w, path)]


def for_branch(conn, w, path: str | None, unsent_only: bool = False):
    sql = "SELECT * FROM comments WHERE project_id = ? AND branch = ?"
    args = [w["project_id"], w["branch"]]
    if path is not None:
        sql += " AND file_path = ?"
        args.append(path)
    if unsent_only:
        sql += " AND sent_at IS NULL"
    return conn.execute(sql + " ORDER BY id", args).fetchall()


@router.post("/worktrees/{id}/comments", status_code=201)
def add_comment(id: int, body: CommentIn):
    with db.connect() as conn:
        w = load(conn, id)
        cur = conn.execute(
            "INSERT INTO comments (project_id, branch, file_path, block_id, quote, body) VALUES (?, ?, ?, ?, ?, ?)",
            (w["project_id"], w["branch"], body.path, body.block_id, body.quote, body.body),
        )
        return dict(db.get(conn, "comments", cur.lastrowid))


class CommentEdit(BaseModel):
    body: str


@router.patch("/comments/{id}")
def edit_comment(id: int, edit: CommentEdit):
    with db.connect() as conn:
        if db.get(conn, "comments", id)["sent_at"] is not None:
            raise HTTPException(409, "comment was already sent")
        if not edit.body.strip():
            raise HTTPException(400, "comment is empty")
        conn.execute("UPDATE comments SET body = ? WHERE id = ?", (edit.body.strip(), id))
        return dict(db.get(conn, "comments", id))


@router.delete("/comments/{id}", status_code=204)
def delete_comment(id: int):
    with db.connect() as conn:
        conn.execute("DELETE FROM comments WHERE id = ?", (id,))


def anchor(c) -> str:
    """Diff comments are anchored to a line ("new:12" / "old:7"); markdown comments to a block, which means nothing to the reader."""
    side, _, line = c["block_id"].partition(":")
    return {"new": f"line {line}", "old": f"removed line {line}"}.get(side, "") if line.isdigit() else ""


def format_message(comments: list, extra: str) -> str:
    parts = []
    for path in dict.fromkeys(c["file_path"] for c in comments):
        parts.append(f"Review comments on {path}:")
        for c in (c for c in comments if c["file_path"] == path):
            where = f" ({anchor(c)})" if anchor(c) else ""
            quote = "\n".join(f"> {line}" for line in c["quote"].split("\n"))
            parts.append(f"{quote}\nComment{where}: {c['body']}")
    if extra.strip():
        parts.append(f"Additional context: {extra.strip()}")
    return "\n\n".join(parts)


@router.post("/worktrees/{id}/send")
def send_to_session(id: int, body: SendIn):
    """Paste unsent comments on a file, or on the whole branch (plus extra context) into a session, and mark them sent."""
    with db.connect() as conn:
        w = active(load(conn, id))
        session_ids = [r["id"] for r in conn.execute("SELECT id FROM sessions WHERE worktree_id = ? ORDER BY id", (id,))]
        if body.session_id not in session_ids:
            raise HTTPException(404, "session not found in this worktree")
        comments = for_branch(conn, w, body.path, unsent_only=True)
        if not comments and not body.extra.strip():
            raise HTTPException(400, "nothing to send")
        try:
            tmux.send_text(body.session_id, format_message(comments, body.extra))
        except RuntimeError as e:
            raise HTTPException(409, f"could not reach the session: {e}")
        sent_to = f"session {session_ids.index(body.session_id) + 1}"
        conn.executemany(
            "UPDATE comments SET sent_at = ?, sent_to = ? WHERE id = ?",
            [(int(time.time()), sent_to, c["id"]) for c in comments],
        )
