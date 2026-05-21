"""Pytest entrypoint for the collaboration filesync scenario."""

from pathlib import Path
import sys

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from tests.utils.collab_ws_client import run_node_harness


def test_collab_filesync_suite() -> None:
    """Execute the filesync propagation harness."""

    run_node_harness("frontend/tests/collab-filesync.mjs")


if __name__ == "__main__":
    test_collab_filesync_suite()
