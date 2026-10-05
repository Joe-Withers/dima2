from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException

from . import db
from .routes import comments, fs, projects, sessions, views, worktrees


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init()
    yield


app = FastAPI(lifespan=lifespan)
for module in (projects, worktrees, sessions, comments, views, fs):
    app.include_router(module.router, prefix="/api")

class SPAFiles(StaticFiles):
    """Serve the built frontend; unknown paths get index.html so client-side routes survive a reload."""

    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except HTTPException as e:
            if e.status_code != 404:
                raise
            return await super().get_response("index.html", scope)


# An installed wheel carries the frontend in dima2/static; a source checkout serves frontend/dist.
PACKAGE_DIR = Path(__file__).resolve().parent
DIST = next((d for d in (PACKAGE_DIR / "static", PACKAGE_DIR.parents[1] / "frontend" / "dist") if d.is_dir()), None)
if DIST:
    app.mount("/", SPAFiles(directory=DIST, html=True))
