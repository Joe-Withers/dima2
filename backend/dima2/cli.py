import argparse

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(prog="dima2", description="A UI for git worktrees across your projects.")
    # The terminals give shell access, so stay on localhost unless asked otherwise.
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true", help="restart on backend code changes (development)")
    args = parser.parse_args()
    uvicorn.run("dima2.main:app", host=args.host, port=args.port, reload=args.reload)
