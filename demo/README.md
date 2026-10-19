# MergeGuard demo repos

Two tiny git repositories, each with a **semantic merge conflict that git cannot see**.
They are generated locally and git-ignored. The dashboard offers one button each.

| | Checkout demo | API demo |
| --- | --- | --- |
| Button | **Try demo repo** | **Try API demo (Tavily)** |
| Folder | `demo/checkout-demo/` | `demo/api-demo/` |
| Create | `python3 demo/make_demo_repo.py` | `python3 demo/make_api_demo_repo.py` |
| Env override | `VITE_DEMO_REPO_PATH` | `VITE_API_DEMO_REPO_PATH` |
| Tavily | Stays idle. The code imports only the Python standard library. | Runs. The conflicting lines use `requests` (`Session`, `session.mount`, `session.get(..., timeout=...)`) and pydantic (`field_validator`). The pair card shows **Grounded with library docs (Tavily)**. |

An empty env value hides that button. Leaving the variable unset keeps the default path, which `frontend/vite.config.ts` resolves from the config file.

## Checkout demo

| Branch | Change |
| --- | --- |
| `main` | `checkout.py` (price × qty, discount, tax) + `python3 -m unittest` tests |
| `feat/discount-cap` | Caps the discount at a fixed amount (`MAX_DISCOUNT = 20.00`), applied to the **pre-tax subtotal**. Touches only `apply_discount` (top of the file). Carries an explicit `ASSUMPTION: apply_discount receives the PRE-TAX subtotal` comment and docstring. |
| `feat/tax-before-discount` | Applies tax **before** the discount in `total()` (bottom of the file). Carries an explicit `CHANGE: tax is now applied BEFORE the discount, so apply_discount receives the TAX-INCLUSIVE amount` comment and docstring. |
| `docs/readme` | Harmless branch that only edits `README.md`. |

Both feature branches change the **same file** (`checkout.py`) but in far-apart
regions (more than the 3-line adjacency window the Sentinel uses), so the merge
has **no textual conflict** (`overlapping_files=0`). The clash is purely
semantic: the two branches make opposite assumptions about what
`apply_discount` receives. So:

- **git heuristic**: 1 shared file, 0 overlapping regions → low risk (~10/100).
- **Nemotron**: sees both changes (with the surrounding function context) and
  the explicit ASSUMPTION/CHANGE comments → flags the semantic clash (the
  discount cap assumes a pre-tax subtotal, while the other branch taxes before
  discounting).
- **Tavily**: stays idle. `checkout.py` and its tests import only the Python
  standard library (`unittest`). A search runs only when changed files import
  a third-party library.

Each branch passes its tests on its own. After merging both branches (no
textual conflict) the result is wrong and at least one test fails.

### Recreate

The generator is idempotent (the old folder is removed first):

```bash
python3 demo/make_demo_repo.py
```

### Verify the merge failure

`--verify` clones the demo repo into a temporary directory, merges both
feature branches into a scratch branch, runs the tests, and prints the failing
assert. The scratch branch only exists in the temp clone. `demo/checkout-demo/`
keeps exactly `main`, `feat/discount-cap`, `feat/tax-before-discount`, and
`docs/readme`:

```bash
python3 demo/make_demo_repo.py --verify
```

Expected output (abridged):

```
Merged feat/discount-cap and feat/tax-before-discount into scratch/merge-both
Running tests on the merged result...
...
FAIL: test_total_with_cap (test_discount_cap.DiscountCapTests.test_total_with_cap)
AssertionError: 200.0 != 198.0
...
FAILED (failures=2)
Expected failure: the merged result is semantically wrong.
```

## API demo (this one triggers Tavily)

| Branch | Change |
| --- | --- |
| `main` | `client.py`: `requests.Session()`, `session.mount(...)`, `session.get(..., timeout=...)`, and a pydantic `Quote` model. `normalize_amount` returns the payload unchanged (dollars). `invoice_total` adds a fee in those dollars. |
| `feat/cents-payload` | The quote endpoint sends **integer cents**. `normalize_amount` and the pydantic `field_validator` divide by 100, and the session mounts both schemes and always passes `timeout` to `session.get`. Touches the top of `client.py`. Commit subject starts with `ASSUMPTION:`. |
| `feat/fee-on-cents` | `invoice_total` treats its input as **raw cents** and divides by 100 after the fee. Touches the bottom of `client.py`. Commit subject starts with `CHANGE:`. |
| `docs/readme` | Harmless branch that only edits `README.md`. |

Same shape as the checkout demo: one shared file, regions farther apart than
the 3-line adjacency window, no textual conflict. The clash is the units. One
branch converts cents to dollars before pricing. The other still divides by
100 inside `invoice_total`. Merged, a $100 quote is billed as $1.

- **git heuristic**: 1 shared file, 0 overlapping regions → low risk (~10/100).
- **Nemotron**: sees the ASSUMPTION and CHANGE and flags the double divide.
- **Tavily**: the changed lines name `session.mount`, `session.get`, and
  `field_validator`, so the lookup queries `requests` and `pydantic` and the
  pair card lists the docs under **Grounded with library docs (Tavily)**.
- **Branch tests**: each feature branch adds a test file. Those tests pass on
  their own branch and fail on the merge, which is what marks the pair
  confirmed.

Tests run with `python3 -m unittest` and do not use the network. They call the
pure helpers only. If `requests` or `pydantic` is not installed, the test
files stub that import so discovery still runs. Where the packages exist
(the backend virtualenv does), the real libraries are imported and the same
assertions pass.

### Recreate

```bash
python3 demo/make_api_demo_repo.py
```

### Verify the merge failure

Same pattern as the checkout demo. Each branch is checked on its own first
(those must pass), then both feature branches are merged in a temp clone:

```bash
python3 demo/make_api_demo_repo.py --verify
```

Expected output (abridged):

```
main: tests passed
feat/cents-payload: tests passed
feat/fee-on-cents: tests passed
docs/readme: tests passed
Merged feat/cents-payload and feat/fee-on-cents into scratch/merge-both
Running tests on the merged result...
...
FAIL: test_invoice_uses_dollars_not_cents
AssertionError: 2.2 != 220.0
FAIL: test_normalize_still_passes_cents_through
AssertionError: 100.0 != 10000.0
FAILED (failures=2)
Expected failure: the merged result divides by 100 twice.
```

## Using them in the dashboard

**Try demo repo** fills the repository field with the absolute path to
`demo/checkout-demo/`. **Try API demo (Tavily)** fills it with
`demo/api-demo/`. Use the API demo when you want a judge to see grounded
library docs on a real run. See `frontend/README.md` for the env overrides.
