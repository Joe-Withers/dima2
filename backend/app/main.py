from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException

from . import db
from .routes import comments, projects, sessions, views, worktrees


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init()
    yield


app = FastAPI(lifespan=lifespan)
for module in (projects, worktrees, sessions, comments, views):
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


DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if DIST.is_dir():
    app.mount("/", SPAFiles(directory=DIST, html=True))
