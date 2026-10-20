#!/usr/bin/env python3
"""Run both local services; stop only the process groups started here."""
import os
from pathlib import Path
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    children = []

    def stop(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    try:
        for cwd, command in [
            (ROOT / "backend", [str(ROOT / "backend/.venv/bin/python"), "-m",
                                "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"]),
            (ROOT / "frontend", ["npm", "run", "dev", "--", "--host", "127.0.0.1",
                                 "--port", "3000", "--strictPort"]),
        ]:
            children.append(subprocess.Popen(command, cwd=cwd, start_new_session=True))
        while all(child.poll() is None for child in children):
            time.sleep(0.2)
        return next((child.returncode or 1 for child in children if child.poll() is not None), 1)
    except KeyboardInterrupt:
        return 0
    finally:
        for child in children:
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()


if __name__ == "__main__":
    raise SystemExit(main())
