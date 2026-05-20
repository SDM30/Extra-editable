"""Shared helpers for the root collaboration test entrypoints."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]


def run_node_harness(script_relative_path: str) -> None:
    """Run a Node-based harness from the repository root."""

    script_path = ROOT_DIR / script_relative_path
    if not script_path.exists():
        raise FileNotFoundError(f"Harness not found: {script_path}")

    node_binary = os.environ.get("NODE_BINARY", "node")
    completed = subprocess.run(
        [node_binary, str(script_path)],
        cwd=ROOT_DIR,
        check=False,
        env=os.environ.copy(),
        text=True,
    )
    if completed.returncode != 0:
        raise subprocess.CalledProcessError(completed.returncode, completed.args)
