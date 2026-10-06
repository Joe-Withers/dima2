import sqlite3
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .. import db, git, tmux

router = APIRouter()

MAIN = ""  # branch of the row for a project's main checkout: worked in directly, diffed against its own HEAD


class WorktreeIn(BaseModel):
    project_id: int
    branch: str  # with existing, a local branch or a remote-tracking ref like origin/feat/x
    base_ref: str
    existing: bool = False
    review: bool = False


def load(conn: sqlite3.Connection, id: int) -> sqlite3.Row:
    """A worktree row joined with its project's name and root."""
    found = conn.execute(
        "SELECT w.*, p.name AS project, p.root_path FROM worktrees w JOIN projects p ON p.id = w.project_id WHERE w.id = ?",
        (id,),
    ).fetchone()
    if not found:
        raise HTTPException(404, f"worktree {id} not found")
    return found


def active(w: sqlite3.Row) -> sqlite3.Row:
    if w["archived_at"] is not None:
        raise HTTPException(409, "worktree is archived")
    return w


def session_status(sessions: list[dict]) -> str:
    """running / needs_input / idle / exited. Hooks only supply needs_input and done; "running" comes from
    pane output so a missed Stop hook can't leave a worktree stuck on it."""
    alive = [s for s in sessions if s["alive"]]
    if any(s["agent_state"] == "needs_input" for s in alive):
        return "needs_input"
    if any(s["running"] for s in alive):
        return "running"
    return "exited" if sessions and not alive else "idle"


def mark_archived(conn: sqlite3.Connection, id: int) -> None:
    for s in conn.execute("SELECT id FROM sessions WHERE worktree_id = ?", (id,)):
        tmux.kill(s["id"])
    conn.execute("DELETE FROM sessions WHERE worktree_id = ?", (id,))
    conn.execute("UPDATE worktrees SET archived_at = unixepoch() WHERE id = ?", (id,))


def ensure_main_checkouts(conn: sqlite3.Connection) -> None:
    """Every project has a row for its main checkout (revived if its folder comes back after being archived)."""
    for p in conn.execute("SELECT id, root_path FROM projects").fetchall():
        if Path(p["root_path"]).is_dir():
            conn.execute(
                "INSERT INTO worktrees (project_id, branch, path, base_ref) VALUES (?, ?, ?, 'HEAD') "
                "ON CONFLICT (project_id, branch) DO UPDATE SET path = excluded.path, archived_at = NULL",
                (p["id"], MAIN, p["root_path"]),
            )


def describe(r: sqlite3.Row) -> dict:
    """Fields shared by the list and the detail view; a main checkout shows the branch it has checked out now."""
    item = {k: r[k] for k in ("id", "project_id", "project", "branch", "base_ref", "created_at", "archived_at")}
    item["review"] = bool(r["review"])
    item["main"] = r["branch"] == MAIN
    if item["main"] and r["archived_at"] is None:
        item["branch"] = git.current_branch(r["path"])
    return item


@router.get("/worktrees")
def list_worktrees():
    with db.connect() as conn:
        ensure_main_checkouts(conn)
        # A worktree whose folder was removed outside dima2 is as good as archived; git can't run in it any more.
        for r in conn.execute("SELECT id, path FROM worktrees WHERE archived_at IS NULL").fetchall():
            if not Path(r["path"]).is_dir():
                mark_archived(conn, r["id"])
        rows = conn.execute(
            "SELECT w.*, p.name AS project FROM worktrees w JOIN projects p ON p.id = w.project_id "
            "ORDER BY w.branch = '' DESC, w.created_at DESC"  # main checkouts first
        ).fetchall()
        session_rows = conn.execute("SELECT id, worktree_id, agent_state FROM sessions").fetchall()
    live = tmux.states()
    out = []
    for r in rows:
        sessions = [
            {"alive": False, "running": False, "activity": 0, **live.get(s["id"], {}), "agent_state": s["agent_state"]}
            for s in session_rows
            if s["worktree_id"] == r["id"]
        ]
        item = describe(r)
        item.update(files=0, md_files=0, ahead=0, behind=0, last_activity=r["created_at"], sessions=0, status="idle", done=False)
        if r["archived_at"] is None:
            item["last_activity"] = max([r["created_at"], *(s["activity"] for s in sessions)])
            try:
                files = git.changed_files(r["path"], r["base_ref"])
                item["files"] = len(files)
                item["md_files"] = sum(f.endswith(".md") for f in files)
                item["ahead"], item["behind"] = git.ahead_behind(r["path"], r["base_ref"])
                item["last_activity"] = max(item["last_activity"], git.last_activity(r["path"]))
            except git.GitError:
                pass  # e.g. a main checkout with no commits yet: show the row without stats rather than fail the list
            item["sessions"] = len(sessions)
            item["status"] = session_status(sessions)
            item["done"] = item["status"] != "needs_input" and any(s["alive"] and s["agent_state"] == "done" for s in sessions)
        out.append(item)
    return out + unmanaged(rows)


def unmanaged(rows: list[sqlite3.Row]) -> list[dict]:
    """Worktrees git knows about that dima2 has no active record for."""
    known = {str(Path(r["path"]).resolve()) for r in rows if r["archived_at"] is None}
    with db.connect() as conn:
        projects = conn.execute("SELECT id, name, root_path FROM projects").fetchall()
    found = []
    for p in projects:
        try:
            listed = git.list_worktrees(p["root_path"])
        except (git.GitError, FileNotFoundError, NotADirectoryError):
            continue
        for w in listed:
            if str(Path(w["path"]).resolve()) in known:
                continue
            found.append({
                "id": 0, "project_id": p["id"], "project": p["name"], "branch": w["branch"], "path": w["path"],
                "base_ref": "", "created_at": 0, "archived_at": None, "files": 0, "md_files": 0, "ahead": 0, "behind": 0,
                "last_activity": 0, "sessions": 0, "status": "idle", "done": False, "review": False, "unmanaged": True,
            })
    return found


class AdoptIn(BaseModel):
    project_id: int
    branch: str
    path: str


@router.post("/worktrees/adopt", status_code=201)
def adopt_worktree(body: AdoptIn):
    """Register a worktree that already exists in git."""
    with db.connect() as conn:
        root = db.get(conn, "projects", body.project_id)["root_path"]
        if not any(w["path"] == body.path and w["branch"] == body.branch for w in git.list_worktrees(root)):
            raise HTTPException(404, "not a worktree of this project")
        base = git.default_base(root)
        conn.execute(
            "INSERT INTO worktrees (project_id, branch, path, base_ref) VALUES (?, ?, ?, ?) "
            "ON CONFLICT (project_id, branch) DO UPDATE SET path = excluded.path, archived_at = NULL",
            (body.project_id, body.branch, body.path, base),
        )
        row = conn.execute("SELECT id FROM worktrees WHERE project_id = ? AND branch = ?", (body.project_id, body.branch)).fetchone()
        return {"id": row["id"]}


@router.post("/worktrees", status_code=201)
def create_worktree(body: WorktreeIn):
    with db.connect() as conn:
        root = db.get(conn, "projects", body.project_id)["root_path"]
        try:
            if body.existing:
                path, branch = git.checkout_worktree(root, body.branch)
            else:
                path, branch = git.add_worktree(root, body.branch, body.base_ref), body.branch
        except git.GitError as e:
            raise HTTPException(400, str(e))
        try:
            cur = conn.execute(
                "INSERT INTO worktrees (project_id, branch, path, base_ref, review) VALUES (?, ?, ?, ?, ?)",
                (body.project_id, branch, path, body.base_ref, body.review),
            )
            return {"id": cur.lastrowid}
        except sqlite3.IntegrityError:
            # branch was archived earlier: git has removed the folder, so revive the row
            conn.execute(
                "UPDATE worktrees SET path = ?, base_ref = ?, review = ?, archived_at = NULL WHERE project_id = ? AND branch = ?",
                (path, body.base_ref, body.review, body.project_id, branch),
            )
            row = conn.execute("SELECT id FROM worktrees WHERE project_id = ? AND branch = ?", (body.project_id, branch)).fetchone()
            return {"id": row["id"]}


@router.get("/worktrees/{id}")
def get_worktree(id: int):
    with db.connect() as conn:
        w = load(conn, id)
    detail = describe(w)
    detail.update(files=[], ahead=0, behind=0)
    if w["archived_at"] is None:
        try:
            detail["files"] = [{"path": p, "status": s} for p, s in sorted(git.changed_files(w["path"], w["base_ref"]).items())]
            detail["ahead"], detail["behind"] = git.ahead_behind(w["path"], w["base_ref"])
        except git.GitError:
            pass  # no commits yet: nothing to compare against
    return detail


@router.post("/worktrees/{id}/archive", status_code=204)
def archive_worktree(id: int):
    with db.connect() as conn:
        w = active(load(conn, id))
        if w["branch"] == MAIN:
            raise HTTPException(400, "the main checkout can't be archived")
        try:
            git.remove_worktree(w["root_path"], w["path"])
        except git.GitError as e:
            raise HTTPException(400, str(e))
        mark_archived(conn, id)


def file_in_worktree(w: sqlite3.Row, file: str) -> Path:
    root = Path(w["path"]).resolve()
    full = (root / file).resolve()
    if not full.is_relative_to(root):
        raise HTTPException(400, "path escapes the worktree")
    return full


@router.get("/worktrees/{id}/files")
def list_files(id: int):
    """All files, for browsing beyond the changed ones; a deleted file that is still tracked is left out."""
    with db.connect() as conn:
        w = active(load(conn, id))
    return [f for f in git.all_files(w["path"]) if (Path(w["path"]) / f).is_file()]


@router.get("/worktrees/{id}/diff")
def get_diff(id: int, path: str):
    with db.connect() as conn:
        w = active(load(conn, id))
    return {"diff": git.file_diff(w["path"], w["base_ref"], path)}


@router.get("/worktrees/{id}/content")
def get_content(id: int, path: str):
    """Raw file from the worktree: markdown source for the preview, images embedded in it."""
    with db.connect() as conn:
        w = active(load(conn, id))
    full = file_in_worktree(w, path)
    if not full.is_file():
        raise HTTPException(404, f"{path} not found")
    return FileResponse(full)
