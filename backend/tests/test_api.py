import json
import os
import subprocess
import time

import pytest
from fastapi.testclient import TestClient

from dima2.hooks import COMMAND, EVENTS
from dima2.main import app


def sh(cwd, *args):
    subprocess.run(args, cwd=cwd, check=True, capture_output=True)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DIMA2_DB", str(tmp_path / "db" / "test.db"))
    monkeypatch.setenv("TMUX_TMPDIR", str(tmp_path))  # private tmux server, never touches the user's sessions
    monkeypatch.delenv("TMUX", raising=False)
    (tmp_path / "home").mkdir()
    monkeypatch.setenv("HOME", str(tmp_path / "home"))  # global views would otherwise list the user's ~/.claude
    with TestClient(app) as c:
        yield c
    subprocess.run(["tmux", "kill-server"], capture_output=True)


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    sh(root, "git", "init", "-b", "main")
    sh(root, "git", "config", "user.email", "t@t")
    sh(root, "git", "config", "user.name", "t")
    (root / "a.txt").write_text("a")
    sh(root, "git", "add", ".")
    sh(root, "git", "commit", "-m", "init")
    return root


def test_worktree_lifecycle(client, repo):
    project = client.post("/api/projects", json={"name": "repo", "root_path": str(repo)}).json()
    refs = client.get(f"/api/projects/{project['id']}/refs").json()
    assert refs["default"] == "main"

    created = client.post("/api/worktrees", json={"project_id": project["id"], "branch": "feat/x", "base_ref": "main"})
    assert created.status_code == 201
    wt = repo / ".worktrees" / "feat-x"
    (wt / "spec.md").write_text("# spec")
    (wt / "b.txt").write_text("b")

    [row] = client.get("/api/worktrees").json()
    assert (row["project"], row["branch"], row["files"], row["md_files"]) == ("repo", "feat/x", 2, 1)
    assert (row["ahead"], row["behind"]) == (0, 0)

    # the worktree dir is excluded from the main checkout's status
    assert subprocess.run(["git", "status", "--porcelain"], cwd=repo, capture_output=True, text=True).stdout == ""

    assert client.post(f"/api/worktrees/{row['id']}/archive").status_code == 400  # dirty
    sh(wt, "git", "add", ".")
    sh(wt, "git", "commit", "-m", "work")
    assert client.post(f"/api/worktrees/{row['id']}/archive").status_code == 204
    assert not wt.exists()
    [row] = client.get("/api/worktrees").json()
    assert row["archived_at"] is not None


def test_rejects_non_repo(client, tmp_path):
    r = client.post("/api/projects", json={"name": "x", "root_path": str(tmp_path)})
    assert r.status_code == 400


def test_duplicate_branch(client, repo):
    p = client.post("/api/projects", json={"name": "repo", "root_path": str(repo)}).json()
    body = {"project_id": p["id"], "branch": "dup", "base_ref": "main"}
    assert client.post("/api/worktrees", json=body).status_code == 201
    assert client.post("/api/worktrees", json=body).status_code == 400


@pytest.fixture
def worktree(client, repo):
    p = client.post("/api/projects", json={"name": "repo", "root_path": str(repo)}).json()
    id = client.post("/api/worktrees", json={"project_id": p["id"], "branch": "feat/x", "base_ref": "main"}).json()["id"]
    return id, repo / ".worktrees" / "feat-x"


def test_detail_diff_and_content(client, worktree):
    id, wt = worktree
    (wt / "a.txt").write_text("changed")
    (wt / "new.md").write_text("# new\nline")
    detail = client.get(f"/api/worktrees/{id}").json()
    assert detail["files"] == [{"path": "a.txt", "status": "M"}, {"path": "new.md", "status": "A"}]
    assert "+changed" in client.get(f"/api/worktrees/{id}/diff", params={"path": "a.txt"}).json()["diff"]
    assert "+# new" in client.get(f"/api/worktrees/{id}/diff", params={"path": "new.md"}).json()["diff"]
    assert client.get(f"/api/worktrees/{id}/content", params={"path": "new.md"}).text == "# new\nline"
    assert client.get(f"/api/worktrees/{id}/content", params={"path": "../../a.txt"}).status_code == 400


def test_worktree_removed_outside_dima2(client, worktree, repo):
    id, wt = worktree
    sh(repo, "git", "worktree", "remove", str(wt))
    r = client.get("/api/worktrees")
    assert r.status_code == 200
    [row] = r.json()
    assert row["id"] == id and row["archived_at"] is not None


def test_all_files(client, worktree):
    id, wt = worktree
    (wt / "docs").mkdir()
    (wt / "docs" / "new.md").write_text("# new")
    (wt / "junk.log").write_text("x")
    (wt / ".gitignore").write_text("*.log\n")
    assert client.get(f"/api/worktrees/{id}/files").json() == [".gitignore", "a.txt", "docs/new.md"]
    (wt / "a.txt").unlink()
    assert client.get(f"/api/worktrees/{id}/files").json() == [".gitignore", "docs/new.md"]


def test_session_terminal_and_send(client, worktree):
    id, wt = worktree
    session = client.post(f"/api/worktrees/{id}/sessions").json()["id"]
    [listed] = client.get(f"/api/worktrees/{id}/sessions").json()
    assert listed["alive"]
    assert client.get("/api/worktrees").json()[0]["sessions"] == 1

    with client.websocket_connect(f"/api/sessions/{session}/ws") as ws:
        ws.send_text('{"resize": [100, 30]}')
        ws.send_bytes(b"echo hello-$((40+2))\n")
        seen = b""
        while b"hello-42" not in seen.replace(b"echo hello-$((40+2))", b""):
            seen += ws.receive_bytes()

    c = client.post(f"/api/worktrees/{id}/comments", json={"path": "spec.md", "block_id": "b1", "quote": "some text", "body": "why?"}).json()
    sent = client.post(f"/api/worktrees/{id}/send", json={"path": "spec.md", "session_id": session, "extra": "be brief"})
    assert sent.status_code == 200
    [c] = client.get(f"/api/worktrees/{id}/comments", params={"path": "spec.md"}).json()
    assert c["sent_to"] == "session 1" and c["sent_at"]
    assert client.post(f"/api/worktrees/{id}/send", json={"path": "spec.md", "session_id": session}).status_code == 400

    assert client.delete(f"/api/sessions/{session}").status_code == 204
    assert client.get(f"/api/worktrees/{id}/sessions").json() == []


def test_terminal_resize_reaches_tmux(client, worktree):
    id, _ = worktree
    session = client.post(f"/api/worktrees/{id}/sessions").json()["id"]

    def window_size():
        out = subprocess.run(["tmux", "display", "-p", "-t", f"dima2-{session}", "#{window_width}x#{window_height}"], capture_output=True, text=True)
        return out.stdout.strip()

    with client.websocket_connect(f"/api/sessions/{session}/ws") as ws:
        ws.receive_bytes()  # attached
        for size in ([120, 20], [120, 45]):  # growing again is what used to be missed
            ws.send_text(json.dumps({"resize": size}))
            deadline = time.monotonic() + 5
            while window_size() != f"{size[0]}x{size[1]}" and time.monotonic() < deadline:
                time.sleep(0.05)
            assert window_size() == f"{size[0]}x{size[1]}"


def test_unsent_comment_delete(client, worktree):
    id, _ = worktree
    c = client.post(f"/api/worktrees/{id}/comments", json={"path": "a.md", "block_id": "b", "quote": "q", "body": "x"}).json()
    assert client.delete(f"/api/comments/{c['id']}").status_code == 204
    assert client.get(f"/api/worktrees/{id}/comments", params={"path": "a.md"}).json() == []


def test_views(client, repo):
    p = client.post("/api/projects", json={"name": "repo", "root_path": str(repo)}).json()
    (repo / ".claude" / "agents").mkdir(parents=True)
    (repo / ".claude" / "agents" / "rev.md").write_text("---\nname: rev\ntools: Read, Grep\n---\n# Body\n")
    (repo / ".claude" / "skills" / "write").mkdir(parents=True)
    (repo / ".claude" / "skills" / "write" / "SKILL.md").write_text("no frontmatter")
    (repo / ".claude" / "commands").mkdir()
    (repo / ".claude" / "commands" / "gone.md").symlink_to(repo / "missing.md")
    views = client.get(f"/api/projects/{p['id']}/views").json()
    assert [(v["group"], v["name"]) for v in views] == [("Agents", "rev"), ("Skills", "write")]
    f = client.get(f"/api/projects/{p['id']}/views/file", params={"path": views[0]["path"]}).json()
    assert f["frontmatter"] == {"name": "rev", "tools": "Read, Grep"} and f["body"] == "# Body\n"
    assert client.get(f"/api/projects/{p['id']}/views/file", params={"path": "a.txt"}).status_code == 404


def test_folder_listing(client, repo, tmp_path):
    (tmp_path / ".hidden").mkdir()
    listing = client.get("/api/fs", params={"path": str(tmp_path)}).json()
    assert listing["dirs"] == [{"name": "repo", "is_repo": True}] or {"name": "repo", "is_repo": True} in listing["dirs"]
    assert all(not d["name"].startswith(".") for d in listing["dirs"])
    assert listing["parent"] == str(tmp_path.parent)
    assert client.get("/api/fs", params={"path": str(tmp_path / "nope")}).status_code == 400


def post_hook(client, session, event, **extra):
    r = client.post(f"/api/sessions/{session}/hook", json={"hook_event_name": event, **extra})
    assert r.status_code == 204


def test_agent_hooks_drive_status(client, worktree):
    id, wt = worktree
    (wt / ".claude").mkdir()
    (wt / ".claude" / "settings.local.json").write_text('{"model": "haiku", "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "mine"}]}]}}')
    session = client.post(f"/api/worktrees/{id}/sessions").json()["id"]
    client.post(f"/api/worktrees/{id}/sessions")  # a second install must not duplicate hooks

    settings = json.loads((wt / ".claude" / "settings.local.json").read_text())
    assert settings["model"] == "haiku"
    assert set(settings["hooks"]) == set(EVENTS)
    assert {e: len(g) for e, g in settings["hooks"].items()} == {**dict.fromkeys(EVENTS, 1), "Stop": 2}  # Stop keeps the user's own hook
    assert ".claude" not in subprocess.run(["git", "status", "--porcelain"], cwd=wt, capture_output=True, text=True).stdout

    def row():
        return client.get("/api/worktrees").json()[0]

    post_hook(client, session, "PermissionRequest")
    assert row()["status"] == "needs_input"
    post_hook(client, session, "PostToolUse")  # answered: the agent carried on
    assert row()["status"] != "needs_input" and not row()["done"]
    post_hook(client, session, "Notification", notification_type="idle_prompt")  # ignored
    post_hook(client, session, "Stop")
    assert row()["done"]
    assert client.post(f"/api/worktrees/{id}/seen").status_code == 204
    assert not row()["done"]
    post_hook(client, session, "Notification", notification_type="elicitation_dialog")
    assert row()["status"] == "needs_input"


def test_hook_command_is_inert_outside_dima2(tmp_path):
    result = subprocess.run(["bash", "-c", COMMAND], input="{}", capture_output=True, text=True, env={"PATH": os.environ["PATH"]})
    assert result.returncode == 0
