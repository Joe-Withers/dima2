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


def default_base(root: str) -> str:
    try:
        return git(root, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")
    except GitError:
        return git(root, "rev-parse", "--abbrev-ref", "HEAD")


def worktree_dir(branch: str) -> str:
    return branch.replace("/", "-")


def add_worktree(root: str, branch: str, base_ref: str) -> str:
    """Create .worktrees/<branch> from base_ref and return its path."""
    git(root, "check-ref-format", "--branch", branch)
    path = Path(root) / ".worktrees" / worktree_dir(branch)
    if path.exists():
        raise GitError(f"{path} already exists")
    git(root, "worktree", "add", str(path), "-b", branch, base_ref)
    ignore_locally(root, ".worktrees/")
    return str(path)


def ignore_locally(repo: str, pattern: str) -> None:
    """Add a pattern to the repo's .git/info/exclude, so it stays out of `git status` without touching tracked files."""
    exclude = Path(git(repo, "rev-parse", "--git-path", "info/exclude"))
    exclude = exclude if exclude.is_absolute() else Path(repo) / exclude
    exclude.parent.mkdir(exist_ok=True)
    if pattern not in (exclude.read_text() if exclude.exists() else "").splitlines():
        with exclude.open("a") as f:
            f.write(pattern + "\n")


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


def file_diff(path: str, base_ref: str, file: str) -> str:
    merge_base = git(path, "merge-base", base_ref, "HEAD")
    diff = git(path, "diff", "--no-color", merge_base, "--", file)
    if diff or not (Path(path) / file).is_file():
        return diff
    # untracked file: diff against /dev/null (git exits 1 when files differ)
    result = subprocess.run(["git", "diff", "--no-color", "--no-index", "/dev/null", file], cwd=path, capture_output=True, text=True)
    return result.stdout.strip()


def ahead_behind(path: str, base_ref: str) -> tuple[int, int]:
    behind, ahead = git(path, "rev-list", "--left-right", "--count", f"{base_ref}...HEAD").split()
    return int(ahead), int(behind)


def last_activity(path: str) -> int:
    """Unix time of the latest commit on the worktree's branch."""
    return int(git(path, "log", "-1", "--format=%ct"))
