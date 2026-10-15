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


def worktrees(client):
    """The listed worktrees, leaving out each project's main checkout."""
    return [w for w in client.get("/api/worktrees").json() if not w.get("main")]


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

    [row] = worktrees(client)
    assert (row["project"], row["branch"], row["files"], row["md_files"]) == ("repo", "feat/x", 2, 1)
    assert (row["ahead"], row["behind"]) == (0, 0)

    # the worktree dir is excluded from the main checkout's status
    assert subprocess.run(["git", "status", "--porcelain"], cwd=repo, capture_output=True, text=True).stdout == ""

    assert client.post(f"/api/worktrees/{row['id']}/archive").status_code == 409  # dirty
    sh(wt, "git", "add", ".")
    sh(wt, "git", "commit", "-m", "work")
    assert client.post(f"/api/worktrees/{row['id']}/archive").status_code == 204
    assert not wt.exists()
    [row] = worktrees(client)
    assert row["archived_at"] is not None


def test_force_archive_discards_uncommitted_files(client, worktree, repo):
    id, wt = worktree
    (wt / "a.txt").write_text("edited")
    (wt / "scratch.txt").write_text("untracked")
    assert client.post(f"/api/worktrees/{id}/archive").status_code == 409
    assert wt.exists()
    assert client.post(f"/api/worktrees/{id}/archive", params={"force": True}).status_code == 204
    assert not wt.exists()
    assert worktrees(client)[0]["archived_at"] is not None
    assert "feat/x" in subprocess.run(["git", "branch"], cwd=repo, capture_output=True, text=True).stdout  # the branch stays


def test_app_page_is_revalidated(client):
    """After an upgrade the browser must pick up the new index.html, and with it the new scripts."""
    from dima2.main import DIST

    if not DIST:
        pytest.skip("frontend not built")
    for path in ("/", "/worktrees/1"):
        assert client.get(path).headers["cache-control"] == "no-cache"
    asset = next((DIST / "assets").iterdir()).name
    assert "immutable" in client.get(f"/assets/{asset}").headers["cache-control"]


def test_rejects_non_repo(client, tmp_path):
    r = client.post("/api/projects", json={"name": "x", "root_path": str(tmp_path)})
    assert r.status_code == 400


def test_duplicate_branch(client, repo):
    p = client.post("/api/projects", json={"name": "repo", "root_path": str(repo)}).json()
    body = {"project_id": p["id"], "branch": "dup", "base_ref": "main"}
    assert client.post("/api/worktrees", json=body).status_code == 201
    assert client.post("/api/worktrees", json=body).status_code == 400


def test_existing_branches(client, repo, tmp_path):
    """A local branch, and a colleague's branch that only exists on the remote until fetched, flagged for review."""
    clone = tmp_path / "clone"
    sh(tmp_path, "git", "clone", str(repo), str(clone))
    sh(repo, "git", "branch", "theirs/pr")
    sh(clone, "git", "branch", "mine")
    p = client.post("/api/projects", json={"name": "clone", "root_path": str(clone)}).json()
    assert "origin/theirs/pr" not in client.get(f"/api/projects/{p['id']}/refs").json()["remote"]
    assert client.post(f"/api/projects/{p['id']}/fetch").status_code == 204
    refs = client.get(f"/api/projects/{p['id']}/refs").json()
    assert (refs["local"], refs["remote"]) == (["main", "mine"], ["origin/main", "origin/theirs/pr"])

    body = {"project_id": p["id"], "base_ref": "origin/main", "existing": True}
    assert client.post("/api/worktrees", json={**body, "branch": "mine"}).status_code == 201
    assert client.post("/api/worktrees", json={**body, "branch": "origin/theirs/pr", "review": True}).status_code == 201
    assert client.post("/api/worktrees", json={**body, "branch": "nope"}).status_code == 400
    assert sorted((w["branch"], w["review"]) for w in worktrees(client)) == [("mine", False), ("theirs/pr", True)]
    assert (clone / ".worktrees" / "theirs-pr").is_dir()
    assert subprocess.run(["git", "rev-parse", "--abbrev-ref", "theirs/pr@{upstream}"], cwd=clone, capture_output=True, text=True).stdout.strip() == "origin/theirs/pr"



def test_sync_pulls_branch_and_local_base(client, repo, tmp_path):
    sh(repo, "git", "branch", "feat")
    clone = tmp_path / "clone"
    sh(tmp_path, "git", "clone", str(repo), str(clone))
    p = client.post("/api/projects", json={"name": "clone", "root_path": str(clone)}).json()
    body = {"project_id": p["id"], "branch": "origin/feat", "base_ref": "main", "existing": True}
    id = client.post("/api/worktrees", json=body).json()["id"]

    for branch in ("feat", "main"):  # new commits upstream on both the branch and its base
        sh(repo, "git", "checkout", branch)
        (repo / f"{branch}.txt").write_text(branch)
        sh(repo, "git", "add", ".")
        sh(repo, "git", "commit", "-m", branch)
    r = client.post(f"/api/worktrees/{id}/sync")
    assert r.status_code == 200
    assert r.json()["notes"] == ["feat: pulled 1 commit from origin/feat", "main: pulled 1 commit from origin/main"]
    assert (clone / ".worktrees" / "feat" / "feat.txt").exists()
    assert (clone / "main.txt").exists()  # main is checked out in the main checkout, so it moved there
    assert client.post(f"/api/worktrees/{id}/sync").json()["notes"] == ["feat: up to date with origin/feat", "main: up to date with origin/main"]

    sh(clone, "git", "config", "user.email", "t@t")
    sh(clone, "git", "config", "user.name", "t")
    (clone / ".worktrees" / "feat" / "local.txt").write_text("x")
    sh(clone / ".worktrees" / "feat", "git", "add", ".")
    sh(clone / ".worktrees" / "feat", "git", "commit", "-m", "local")
    assert client.post(f"/api/worktrees/{id}/sync").json()["notes"][0] == "feat: nothing to pull (1 ahead of origin/feat)"

    sh(clone, "git", "branch", "--unset-upstream", "feat")  # pushed without -u: origin/feat still counts
    assert client.post(f"/api/worktrees/{id}/sync").json()["notes"][0] == "feat: nothing to pull (1 ahead of origin/feat)"
    sh(clone, "git", "branch", "-m", "feat", "unpushed")
    assert client.post(f"/api/worktrees/{id}/sync").json()["notes"][0] == "unpushed: not on the remote yet, nothing to pull"
    sh(clone, "git", "branch", "-m", "unpushed", "feat")

    (repo / "theirs.txt").write_text("y")
    sh(repo, "git", "checkout", "feat")
    sh(repo, "git", "add", ".")
    sh(repo, "git", "commit", "-m", "theirs")
    assert client.post(f"/api/worktrees/{id}/sync").status_code == 400  # diverged: never merges or rebases

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
    content = client.get(f"/api/worktrees/{id}/content", params={"path": "new.md"})
    assert content.text == "# new\nline"
    assert content.headers["cache-control"] == "no-cache"
    assert client.get(f"/api/worktrees/{id}/content", params={"path": "../../a.txt"}).status_code == 400


def test_change_base(client, repo):
    project = client.post("/api/projects", json={"name": "repo", "root_path": str(repo)}).json()
    parent = client.post("/api/worktrees", json={"project_id": project["id"], "branch": "parent", "base_ref": "main"}).json()
    pwt = repo / ".worktrees" / "parent"
    (pwt / "p.txt").write_text("p")
    sh(pwt, "git", "add", ".")
    sh(pwt, "git", "commit", "-m", "parent work")
    child = client.post("/api/worktrees", json={"project_id": project["id"], "branch": "child", "base_ref": "parent"}).json()
    cwt = repo / ".worktrees" / "child"
    (cwt / "c.txt").write_text("c")
    sh(cwt, "git", "add", ".")
    sh(cwt, "git", "commit", "-m", "child work")
    # parent is squash-merged into main and child rebased onto it: against parent, p.txt now looks like child's change
    sh(repo, "git", "merge", "--squash", "parent")
    sh(repo, "git", "commit", "-m", "parent (squashed)")
    sh(cwt, "git", "rebase", "--onto", "main", "parent")
    assert [f["path"] for f in client.get(f"/api/worktrees/{child['id']}").json()["files"]] == ["c.txt", "p.txt"]

    assert client.patch(f"/api/worktrees/{child['id']}", json={"base_ref": "nope"}).status_code == 400
    assert client.patch(f"/api/worktrees/{child['id']}", json={"base_ref": "main"}).status_code == 204
    detail = client.get(f"/api/worktrees/{child['id']}").json()
    assert (detail["base_ref"], detail["files"], detail["ahead"]) == ("main", [{"path": "c.txt", "status": "A"}], 1)
    main = next(w for w in client.get("/api/worktrees").json() if w["main"])
    assert client.patch(f"/api/worktrees/{main['id']}", json={"base_ref": "main"}).status_code == 400


def test_worktree_removed_outside_dima2(client, worktree, repo):
    id, wt = worktree
    sh(repo, "git", "worktree", "remove", str(wt))
    assert client.get("/api/worktrees").status_code == 200
    [row] = worktrees(client)
    assert row["id"] == id and row["archived_at"] is not None


def test_main_checkout(client, repo):
    p = client.post("/api/projects", json={"name": "repo", "root_path": str(repo)}).json()
    client.post("/api/worktrees", json={"project_id": p["id"], "branch": "feat/x", "base_ref": "main"})
    main, feat = client.get("/api/worktrees").json()
    assert (main["main"], main["branch"], main["files"]) == (True, "main", 0)
    assert (feat["main"], feat["branch"]) == (False, "feat/x")

    # changes are the uncommitted ones; the branch shown is whatever is checked out
    (repo / "a.txt").write_text("edited")
    sh(repo, "git", "checkout", "-b", "other")
    [main] = [w for w in client.get("/api/worktrees").json() if w["main"]]
    assert (main["branch"], main["files"]) == ("other", 1)
    detail = client.get(f"/api/worktrees/{main['id']}").json()
    assert detail["main"] and detail["files"] == [{"path": "a.txt", "status": "M"}]

    assert client.post(f"/api/worktrees/{main['id']}/archive").status_code == 400
    assert repo.is_dir()


def test_main_checkout_without_commits(client, tmp_path):
    empty = tmp_path / "empty"
    empty.mkdir()
    sh(empty, "git", "init", "-b", "trunk")
    client.post("/api/projects", json={"name": "empty", "root_path": str(empty)})
    [main] = client.get("/api/worktrees").json()
    assert (main["main"], main["branch"], main["files"]) == (True, "trunk", 0)
    assert client.get(f"/api/worktrees/{main['id']}").status_code == 200


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
    assert worktrees(client)[0]["sessions"] == 1

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


def test_terminal_for_missing_session_says_so(client):
    from starlette.websockets import WebSocketDisconnect

    with client.websocket_connect("/api/sessions/999/ws") as ws:
        with pytest.raises(WebSocketDisconnect) as e:
            ws.receive_bytes()
    assert e.value.code == 4404


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
        return worktrees(client)[0]

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
