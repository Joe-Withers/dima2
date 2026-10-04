from pathlib import Path

from fastapi import APIRouter, HTTPException

from .. import db

router = APIRouter()

# (group, glob relative to the project root, how to name an entry)
SOURCES = [
    ("Agents", ".claude/agents", "*.md"),
    ("Skills", ".claude/skills", "*/SKILL.md"),
    ("Commands", ".claude/commands", "*.md"),
    ("Flows", ".thenn", "*.thenn"),
    ("Flows", ".thenn", "*.yaml"),
    ("Flows", ".thenn", "*.yml"),
]


def entry_name(group: str, root: Path, file: Path) -> str:
    if group == "Skills":
        return file.parent.name
    if group == "Commands":
        return "/" + file.stem
    return file.name if group == "Flows" else file.stem


def scan(root: Path, scope: str = "project") -> list[dict]:
    return [
        {"group": group, "name": entry_name(group, root, f), "path": str(f.relative_to(root)), "scope": scope}
        for group, directory, pattern in SOURCES
        for f in sorted((root / directory).glob(pattern))
    ]


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """Split a leading `---` block of `key: value` lines from the body."""
    if not text.startswith("---\n"):
        return {}, text
    head, sep, body = text[4:].partition("\n---")
    if not sep:
        return {}, text
    pairs = (line.partition(":") for line in head.splitlines() if ":" in line)
    return {k.strip(): v.strip() for k, _, v in pairs}, body.lstrip("\n").removeprefix("\n")


def scope_root(project_root: Path, scope: str) -> Path:
    return Path.home() if scope == "global" else project_root


@router.get("/projects/{id}/views")
def list_views(id: int):
    with db.connect() as conn:
        root = Path(db.get(conn, "projects", id)["root_path"])
    # Global definitions live under ~/.claude (and ~/.thenn); skip when the project is the home dir itself.
    return scan(root) + ([] if root == Path.home() else scan(Path.home(), "global"))


@router.get("/projects/{id}/views/file")
def view_file(id: int, path: str, scope: str = "project"):
    with db.connect() as conn:
        project_root = Path(db.get(conn, "projects", id)["root_path"])
    root = scope_root(project_root, scope)
    if path not in {e["path"] for e in scan(root)}:  # only definitions the scanner found
        raise HTTPException(404, "not a known definition")
    frontmatter, body = parse_frontmatter((root / path).read_text())
    return {"path": path, "scope": scope, "frontmatter": frontmatter, "body": body}
