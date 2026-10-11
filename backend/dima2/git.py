import subprocess
from pathlib import Path


class GitError(Exception):
    pass


def git(cwd: str | Path, *args: str) -> str:
    result = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    if result.returncode != 0:
        raise GitError(result.stderr.strip() or f"git {args[0]} failed")
    return result.stdout.strip()


def is_repo(path: str) -> bool:
    try:
        return git(path, "rev-parse", "--show-toplevel") == str(Path(path).resolve())
    except (GitError, FileNotFoundError, NotADirectoryError):
        return False


def branches(root: str) -> list[str]:
    return git(root, "for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes", "refs/tags").split()


def local_and_remote_branches(root: str) -> tuple[list[str], list[str]]:
    """Local branch names, and remote-tracking ones like origin/feat/x (the remote's HEAD alias left out)."""
    local, remote = [], []
    for line in git(root, "for-each-ref", "--format=%(refname) %(symref)", "refs/heads", "refs/remotes").splitlines():
        ref, _, symref = line.partition(" ")
        if symref:
            continue
        if ref.startswith("refs/heads/"):
            local.append(ref.removeprefix("refs/heads/"))
        else:
            remote.append(ref.removeprefix("refs/remotes/"))
    return local, remote


def fetch(root: str) -> None:
    git(root, "fetch", "--all", "--prune")


def default_base(root: str) -> str:
    try:
        return git(root, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")
    except GitError:
        return git(root, "rev-parse", "--abbrev-ref", "HEAD")


def worktree_dir(branch: str) -> str:
    return branch.replace("/", "-")


def add_worktree(root: str, branch: str, base_ref: str) -> str:
    """Create .worktrees/<branch> on a new branch from base_ref and return its path."""
    git(root, "check-ref-format", "--branch", branch)
    path = new_worktree_path(root, branch)
    git(root, "worktree", "add", str(path), "-b", branch, base_ref)
    ignore_locally(root, ".worktrees/")
    return str(path)


def checkout_worktree(root: str, ref: str) -> tuple[str, str]:
    """Create .worktrees/<branch> on an existing branch and return (path, branch). A remote-tracking ref like
    origin/feat/x checks out the local feat/x, creating it to track the remote when there isn't one yet."""
    local, remote = local_and_remote_branches(root)
    if ref in local:
        branch = ref
    elif ref in remote:
        branch = ref.split("/", 1)[1]
    else:
        raise GitError(f"no branch named {ref}")
    path = str(new_worktree_path(root, branch))
    if branch in local:
        git(root, "worktree", "add", path, branch)
    else:
        git(root, "worktree", "add", "--track", "-b", branch, path, ref)
    ignore_locally(root, ".worktrees/")
    return path, branch


def new_worktree_path(root: str, branch: str) -> Path:
    path = Path(root) / ".worktrees" / worktree_dir(branch)
    if path.exists():
        raise GitError(f"{path} already exists")
    return path


def ignore_locally(repo: str, pattern: str) -> None:
    """Add a pattern to the repo's .git/info/exclude, so it stays out of `git status` without touching tracked files."""
    exclude = Path(git(repo, "rev-parse", "--git-path", "info/exclude"))
    exclude = exclude if exclude.is_absolute() else Path(repo) / exclude
    exclude.parent.mkdir(exist_ok=True)
    if pattern not in (exclude.read_text() if exclude.exists() else "").splitlines():
        with exclude.open("a") as f:
            f.write(pattern + "\n")


def list_worktrees(root: str) -> list[dict[str, str]]:
    """Linked worktrees on a branch (the main checkout, bare and detached entries are skipped)."""
    return [{"path": e["worktree"], "branch": e["branch"].removeprefix("refs/heads/")} for e in worktree_entries(root)[1:] if "branch" in e]


def remove_worktree(root: str, path: str) -> None:
    git(root, "worktree", "remove", path)


def changed_files(path: str, base_ref: str) -> dict[str, str]:
    """Map of file -> A/M/D versus the merge-base with base_ref, including uncommitted and untracked."""
    merge_base = git(path, "merge-base", base_ref, "HEAD")
    status = {}
    for line in git(path, "diff", "--name-status", "--no-renames", merge_base).splitlines():
        letter, name = line.split("\t", 1)
        status[name] = letter
    for name in git(path, "ls-files", "--others", "--exclude-standard").splitlines():
        status[name] = "A"
    return status


def all_files(path: str) -> list[str]:
    """Every file in the worktree that git tracks, plus untracked ones that aren't ignored."""
    return sorted(set(git(path, "ls-files", "--cached", "--others", "--exclude-standard").splitlines()))


def file_diff(path: str, base_ref: str, file: str) -> str:
    merge_base = git(path, "merge-base", base_ref, "HEAD")
    diff = git(path, "diff", "--no-color", merge_base, "--", file)
    if diff or not (Path(path) / file).is_file():
        return diff
    # untracked file: diff against /dev/null (git exits 1 when files differ)
    result = subprocess.run(["git", "diff", "--no-color", "--no-index", "/dev/null", file], cwd=path, capture_output=True, text=True)
    return result.stdout.strip()


def current_branch(path: str) -> str:
    """The checked-out branch (even before the first commit), or "HEAD" when detached."""
    try:
        return git(path, "symbolic-ref", "--short", "HEAD")
    except GitError:
        return "HEAD"


def ahead_behind(path: str, base_ref: str) -> tuple[int, int]:
    behind, ahead = git(path, "rev-list", "--left-right", "--count", f"{base_ref}...HEAD").split()
    return int(ahead), int(behind)


def last_activity(path: str) -> int:
    """Unix time of the latest commit on the worktree's branch."""
    return int(git(path, "log", "-1", "--format=%ct"))


def upstream(path: str, branch: str) -> str | None:
    try:
        return git(path, "rev-parse", "--abbrev-ref", f"{branch}@{{upstream}}")
    except GitError:
        return None


def fast_forward(path: str, target: str) -> int:
    """Fast-forward the checkout at path to target; returns how many commits it moved."""
    before = git(path, "rev-parse", "HEAD")
    git(path, "merge", "--ff-only", target)
    return int(git(path, "rev-list", "--count", f"{before}..HEAD"))


def sync(path: str, base_ref: str) -> list[str]:
    """Fetch, fast-forward the checked-out branch to its upstream, and do the same for base_ref when it is a local
    branch with an upstream (a remote-tracking base like origin/main is brought up to date by the fetch itself).
    Returns a line per step; raises when the checked-out branch can't be fast-forwarded."""
    git(path, "fetch", "--all", "--prune")
    notes = []
    branch = current_branch(path)
    if branch == "HEAD":
        notes.append("detached HEAD: fetched only")
    elif up := upstream(path, branch):
        n = fast_forward(path, up)
        notes.append(f"{branch}: pulled {n} commit{'s' * (n != 1)} from {up}" if n else f"{branch}: up to date with {up}")
    else:
        notes.append(f"{branch}: no upstream yet, fetched only")

    local, _ = local_and_remote_branches(path)
    if base_ref == branch or base_ref not in local or not (up := upstream(path, base_ref)):
        return notes
    checked_out = next((e["worktree"] for e in worktree_entries(path) if e.get("branch") == f"refs/heads/{base_ref}"), None)
    try:
        if checked_out:
            n = fast_forward(checked_out, up)
        else:
            before = git(path, "rev-parse", base_ref)
            git(path, "fetch", ".", f"refs/remotes/{up}:refs/heads/{base_ref}")  # fast-forward only, no checkout
            n = int(git(path, "rev-list", "--count", f"{before}..{base_ref}"))
        notes.append(f"{base_ref}: pulled {n} commit{'s' * (n != 1)} from {up}" if n else f"{base_ref}: up to date with {up}")
    except GitError as e:
        notes.append(f"{base_ref}: not updated ({e.args[0].splitlines()[-1]})")
    return notes


def worktree_entries(path: str) -> list[dict[str, str]]:
    """`git worktree list --porcelain` as dicts, the main checkout first."""
    out = git(path, "worktree", "list", "--porcelain")
    return [dict(line.split(" ", 1) for line in block.splitlines() if " " in line) for block in out.split("\n\n")]
