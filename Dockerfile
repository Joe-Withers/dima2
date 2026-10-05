# Build the frontend, then run the backend (which serves frontend/dist) with git, tmux and Claude Code available.

FROM node:22-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build


FROM python:3.12-slim-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends git tmux curl ca-certificates openssh-client less procps \
    && rm -rf /var/lib/apt/lists/* \
    # Repos are bind-mounted from the host, so their owner rarely matches the container user.
    && git config --system safe.directory '*'

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Run as uid 1000 so files written into mounted repos keep the usual host owner.
ARG UID=1000
ARG GID=1000
RUN groupadd -g $GID dima && useradd -m -u $UID -g $GID -s /bin/bash dima

ENV LANG=C.UTF-8 \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    UV_COMPILE_BYTECODE=1 \
    PATH=/home/dima/.local/bin:/app/.venv/bin:$PATH \
    # Keeps .claude.json inside ~/.claude, so one volume holds all of Claude Code's login and settings.
    CLAUDE_CONFIG_DIR=/home/dima/.claude

WORKDIR /app
RUN chown dima:dima /app
USER dima

COPY --chown=dima:dima backend/pyproject.toml backend/uv.lock backend/
RUN cd backend && uv sync --frozen --no-dev --no-install-project
COPY --chown=dima:dima backend/ backend/
COPY --from=frontend --chown=dima:dima /app/frontend/dist frontend/dist

RUN curl -fsSL https://claude.ai/install.sh | bash \
    && mkdir -p /home/dima/.claude /home/dima/.dima2

WORKDIR /app/backend
EXPOSE 8000
# PROJECTS_DIR is mounted at its host path (git worktrees record absolute paths); link it where the folder picker opens.
CMD ["sh", "-c", "[ -n \"$PROJECTS_DIR\" ] && ln -sfn \"$PROJECTS_DIR\" ~/projects; exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
