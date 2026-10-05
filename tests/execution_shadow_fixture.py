"""Load the frozen collector without contaminating other tests' live imports."""
import importlib
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
FROZEN_ROOT = REPO_ROOT / "research/frozen/execution-prospective-2026-09-v1"


def load_frozen_modules():
    names = ("run_execution_shadow", "prepare_execution_v2", "update_execution_params",
             "execution_registry", "crypto_execution")
    previous = {name: sys.modules.pop(name) for name in names if name in sys.modules}
    previous_path = sys.path[:]
    try:
        sys.path.insert(0, str(FROZEN_ROOT / "scripts"))
        collector = importlib.import_module("run_execution_shadow")
        preparation = importlib.import_module("prepare_execution_v2")
        for name in names:
            assert Path(sys.modules[name].__file__).resolve().is_relative_to(FROZEN_ROOT)
        return collector, preparation
    finally:
        for name in names:
            sys.modules.pop(name, None)
        sys.modules.update(previous)
        sys.path[:] = previous_path
