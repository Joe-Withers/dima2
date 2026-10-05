import os
import sqlite3
from pathlib import Path

from fastapi import HTTPException

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    root_path TEXT NOT NULL UNIQUE,
    host TEXT NOT NULL DEFAULT 'local'
);
CREATE TABLE IF NOT EXISTS worktrees (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    branch TEXT NOT NULL,
    path TEXT NOT NULL,
    base_ref TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    archived_at INTEGER,
    UNIQUE (project_id, branch)  -- branch '' is the project's main checkout, whatever it has checked out

);
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY,
    worktree_id INTEGER NOT NULL REFERENCES worktrees(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    agent_state TEXT  -- reported by agent hooks: running | needs_input | done
);
CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    branch TEXT NOT NULL,
    file_path TEXT NOT NULL,
    block_id TEXT NOT NULL,
    quote TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    sent_at INTEGER,
    sent_to TEXT
);
"""


def db_path() -> Path:
    return Path(os.environ.get("DIMA2_DB", Path.home() / ".dima2" / "dima2.db"))


def connect() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)
        if "agent_state" not in {r["name"] for r in conn.execute("PRAGMA table_info(sessions)")}:
            conn.execute("ALTER TABLE sessions ADD COLUMN agent_state TEXT")  # databases created before hooks existed


def get(conn: sqlite3.Connection, table: str, id: int) -> sqlite3.Row:
    found = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (id,)).fetchone()
    if not found:
        raise HTTPException(404, f"{table} {id} not found")
    return found
