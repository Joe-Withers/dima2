from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter()


@router.get("/fs")
def list_directory(path: str = ""):
    """Subdirectories of a folder on the machine running the backend, for the folder picker."""
    folder = Path(path or Path.home()).expanduser().resolve()
    if not folder.is_dir():
        raise HTTPException(400, f"{folder} is not a folder")
    try:
        children = sorted((c for c in folder.iterdir() if c.is_dir() and not c.name.startswith(".")), key=lambda c: c.name.lower())
    except PermissionError:
        raise HTTPException(403, f"cannot read {folder}")
    return {
        "path": str(folder),
        "parent": str(folder.parent) if folder.parent != folder else None,
        "is_repo": (folder / ".git").exists(),
        "dirs": [{"name": c.name, "is_repo": (c / ".git").exists()} for c in children],
    }
