import sqlite3
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import db, git

router = APIRouter()


class ProjectIn(BaseModel):
    name: str
    root_path: str


@router.get("/projects")
def list_projects():
    with db.connect() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM projects ORDER BY name")]


@router.post("/projects", status_code=201)
def create_project(body: ProjectIn):
    root = str(Path(body.root_path).expanduser().resolve())
    if not git.is_repo(root):
        raise HTTPException(400, f"{root} is not the root of a git repository")
    try:
        with db.connect() as conn:
            cur = conn.execute("INSERT INTO projects (name, root_path) VALUES (?, ?)", (body.name.strip(), root))
            return dict(db.get(conn, "projects", cur.lastrowid))
    except sqlite3.IntegrityError:
        raise HTTPException(409, "A project with that name or path already exists")


@router.delete("/projects/{id}", status_code=204)
def delete_project(id: int):
    with db.connect() as conn:
        conn.execute("DELETE FROM projects WHERE id = ?", (id,))


@router.get("/projects/{id}/refs")
def project_refs(id: int):
    with db.connect() as conn:
        root = db.get(conn, "projects", id)["root_path"]
    local, remote = git.local_and_remote_branches(root)
    return {"default": git.default_base(root), "refs": git.branches(root), "local": local, "remote": remote}


@router.post("/projects/{id}/fetch", status_code=204)
def fetch_project(id: int):
    """Pick up branches pushed by others, e.g. to review a PR."""
    with db.connect() as conn:
        root = db.get(conn, "projects", id)["root_path"]
    try:
        git.fetch(root)
    except git.GitError as e:
        raise HTTPException(400, str(e))
