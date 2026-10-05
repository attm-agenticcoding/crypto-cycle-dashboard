# Immutable execution experiment kernel

This subtree is the runtime boundary for the existing prospective trial and its
original retrospective reproduction. It is **not** a new experiment or a live
calculator implementation.

- Source snapshot: `dcc2d5feb9a3054a7eae570e3b6ef487496e70e4`
- Prospective contract: `ef1ef81a5a6515ed9642f98a4a9df15c403e3e23f33879e7af8144f204578724`
- Compatibility manifest SHA-256: `857f1deb8d696d4f68b4cfc5374ac37e2311efab135a8df03cda6e02f83bc625`

Every file listed by `frozen-manifest.json` was copied byte-for-byte and checked
against that snapshot's Git blob hash. No internal import, code comment, policy
function, original relative path, or collector hash was rewritten. The additional
README, manifest and ignore file are operational documentation, not contract
inputs. `validate_execution_v2.cjs` is included for the original retrospective
route but does not enlarge the prospective `CODE_FILES` list.

## Why the duplicate files exist

The original collector hashes nine files, including its own bytes and the page
and core used by the original experiment. Updating the live calculator must not
break collection or authorize a new policy under the existing study name. The
unchanged `prepare_execution_v2.py` and JavaScript modules resolve their root
from their own file locations, so preserving the original layout isolates every
import and cohort read without modifying the contract.

The original protected-file list also requires a parameter bundle and production
scaling workflow. These are frozen integrity sentinels; the collector never runs
the copied workflow, never consumes the copied fitted parameter bundle as its
selection input, and never publishes either. Only top-level `.github/workflows/`
files execute in GitHub Actions.

The workflow launch location changes, while its repository/branch/event checks,
cron, trust rules, immutable artifact names, retention, and restore behavior stay
the same. `git rev-parse HEAD` walks up to the current repository checkout, so new
receipts truthfully record their current workflow commit. Their code contract
still records the original implementation. No old receipt is rewritten.

## Supported entry points

From the repository root:

```sh
python research/frozen/execution-prospective-2026-09-v1/scripts/run_execution_shadow.py --local-test
python research/frozen/execution-prospective-2026-09-v1/scripts/run_execution_shadow.py --local-test --restore-only
python research/frozen/execution-prospective-2026-09-v1/scripts/prepare_execution_v2.py
node research/frozen/execution-prospective-2026-09-v1/scripts/validate_execution_v2.cjs
```

Research outputs and archive caches stay in this subtree's ignored `.research/`.
Restore-only requires authenticated read access to the official artifacts. Public
regression checks use synthetic test data only; they neither contain nor download
archived trial state:

```sh
python -m unittest discover -s tests -p 'test_execution_shadow*.py' -v
node --test tests/test_execution_shadow*.cjs tests/test_execution_v2.cjs
```

These tests cover exact source hashes, synthetic ledger preservation and
settlement, synthetic seal handling, current-checkout provenance, and isolation
from deliberately broken live planner/registry copies. A separate completed
local-only check preserved all 28 actual receipts and 16 settled evaluations,
recomputed their outcomes, reproduced the latest eight-task receipt exactly,
and verified real server-seal restoration. The real-data inputs and replay tools
remain outside the published repository and are not part of the public regression suite.

The root-level legacy research files are retained unchanged for audit history;
the supported workflows and documentation use this frozen tree. Do not route
this experiment through the live core, add compatibility entries to admit live
changes, or edit the frozen policy. A different policy requires a separate,
explicitly versioned study. No result here promotes the live calculator.
