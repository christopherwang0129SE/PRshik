# Bench report

## Headline

660 cases, 493 ok, 167 replay_failed, 0 timeout, 0 error. 4 flagged, 1 confirmed. Cost 1.546. 6 textual conflicts (separate category).

Mined flagged: TP 3, FP 1, FN 247, TN 242.
Hand flagged: TP 0, FP 1, FN 2, TN 271.

The confidence strong slice includes broke cases with confidence revert, explicit-merge-fix, or medium, plus every clean case from those same repos.

660 cases. Cost 1.546 (mean 0.002, median 0.001). Seconds 8227.099 (mean 12.465, median 6.156).

## Non-ok statuses

| repo | replay_failed | timeout | error | other |
|---|---:|---:|---:|---:|
| PyCQA__isort | 3 | 0 | 0 | 0 |
| aio-libs__multidict | 13 | 0 | 0 | 0 |
| aio-libs__yarl | 2 | 0 | 0 | 0 |
| arrow-py__arrow | 1 | 0 | 0 | 0 |
| colinhacks__zod | 37 | 0 | 0 | 0 |
| encode__httpx | 1 | 0 | 0 | 0 |
| encode__uvicorn | 4 | 0 | 0 | 0 |
| fastapi__fastapi | 5 | 0 | 0 | 0 |
| fastapi__sqlmodel | 2 | 0 | 0 | 0 |
| honojs__hono | 9 | 0 | 0 | 0 |
| hynek__structlog | 2 | 0 | 0 | 0 |
| jazzband__pip-tools | 1 | 0 | 0 | 0 |
| marshmallow-code__marshmallow | 11 | 0 | 0 | 0 |
| pallets__click | 5 | 0 | 0 | 0 |
| pallets__flask | 2 | 0 | 0 | 0 |
| pallets__jinja | 1 | 0 | 0 | 0 |
| pallets__werkzeug | 10 | 0 | 0 | 0 |
| psf__black | 38 | 0 | 0 | 0 |
| psf__requests | 2 | 0 | 0 | 0 |
| pydantic__pydantic-settings | 10 | 0 | 0 | 0 |
| python-attrs__attrs | 1 | 0 | 0 | 0 |
| python-jsonschema__jsonschema | 1 | 0 | 0 | 0 |
| sindresorhus__ky | 4 | 0 | 0 | 0 |
| tqdm__tqdm | 2 | 0 | 0 | 0 |

## Mined ground truth

### Flagged (high or test-confirmed)

| slice | n | TP | FP | FN | TN | precision | recall | specificity | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| overall | 493 | 3 | 1 | 247 | 242 | 0.750 | 0.012 | 0.996 | 0.024 |
| repo Delgan__loguru | 2 | 0 | 0 | 1 | 1 | - | 0.000 | 1.000 | - |
| repo PyCQA__isort | 43 | 0 | 0 | 20 | 23 | - | 0.000 | 1.000 | - |
| repo Textualize__rich | 2 | 0 | 0 | 1 | 1 | - | 0.000 | 1.000 | - |
| repo aio-libs__multidict | 5 | 0 | 0 | 2 | 3 | - | 0.000 | 1.000 | - |
| repo aio-libs__yarl | 14 | 0 | 0 | 7 | 7 | - | 0.000 | 1.000 | - |
| repo arrow-py__arrow | 11 | 0 | 0 | 5 | 6 | - | 0.000 | 1.000 | - |
| repo axios__axios | 4 | 0 | 0 | 2 | 2 | - | 0.000 | 1.000 | - |
| repo colinhacks__zod | 119 | 1 | 0 | 60 | 58 | 1.000 | 0.016 | 1.000 | 0.032 |
| repo dateutil__dateutil | 10 | 0 | 0 | 5 | 5 | - | 0.000 | 1.000 | - |
| repo encode__httpx | 19 | 1 | 0 | 9 | 9 | 1.000 | 0.100 | 1.000 | 0.182 |
| repo encode__starlette | 4 | 0 | 0 | 2 | 2 | - | 0.000 | 1.000 | - |
| repo encode__uvicorn | 16 | 0 | 0 | 8 | 8 | - | 0.000 | 1.000 | - |
| repo fastapi__fastapi | 17 | 0 | 0 | 8 | 9 | - | 0.000 | 1.000 | - |
| repo fastapi__sqlmodel | 6 | 0 | 0 | 4 | 2 | - | 0.000 | 1.000 | - |
| repo honojs__hono | 19 | 0 | 0 | 11 | 8 | - | 0.000 | 1.000 | - |
| repo httpie__cli | 4 | 0 | 0 | 2 | 2 | - | 0.000 | 1.000 | - |
| repo jazzband__pip-tools | 9 | 0 | 0 | 4 | 5 | - | 0.000 | 1.000 | - |
| repo marshmallow-code__marshmallow | 13 | 0 | 0 | 7 | 6 | - | 0.000 | 1.000 | - |
| repo more-itertools__more-itertools | 10 | 0 | 0 | 5 | 5 | - | 0.000 | 1.000 | - |
| repo pallets__click | 11 | 0 | 0 | 4 | 7 | - | 0.000 | 1.000 | - |
| repo pallets__flask | 8 | 0 | 0 | 4 | 4 | - | 0.000 | 1.000 | - |
| repo pallets__jinja | 3 | 0 | 0 | 2 | 1 | - | 0.000 | 1.000 | - |
| repo pallets__werkzeug | 10 | 0 | 0 | 7 | 3 | - | 0.000 | 1.000 | - |
| repo psf__black | 62 | 0 | 0 | 33 | 29 | - | 0.000 | 1.000 | - |
| repo psf__requests | 10 | 0 | 0 | 5 | 5 | - | 0.000 | 1.000 | - |
| repo pydantic__pydantic-settings | 32 | 1 | 1 | 14 | 16 | 0.500 | 0.067 | 0.941 | 0.118 |
| repo pytest-dev__pluggy | 6 | 0 | 0 | 3 | 3 | - | 0.000 | 1.000 | - |
| repo python-attrs__attrs | 7 | 0 | 0 | 4 | 3 | - | 0.000 | 1.000 | - |
| repo python-jsonschema__jsonschema | 5 | 0 | 0 | 2 | 3 | - | 0.000 | 1.000 | - |
| repo sindresorhus__ky | 8 | 0 | 0 | 3 | 5 | - | 0.000 | 1.000 | - |
| repo tqdm__tqdm | 4 | 0 | 0 | 3 | 1 | - | 0.000 | 1.000 | - |
| language python | 343 | 2 | 1 | 171 | 169 | 0.667 | 0.012 | 0.994 | 0.023 |
| language ts | 150 | 1 | 0 | 76 | 73 | 1.000 | 0.013 | 1.000 | 0.026 |
| confidence medium | 8 | 0 | 0 | 8 | 0 | - | 0.000 | - | - |
| confidence none | 243 | 0 | 1 | 0 | 242 | 0.000 | - | 0.996 | - |
| confidence revert | 5 | 0 | 0 | 5 | 0 | - | 0.000 | - | - |
| confidence strong | 135 | 0 | 0 | 13 | 122 | - | 0.000 | 1.000 | - |
| confidence weak | 237 | 3 | 0 | 234 | 0 | 1.000 | 0.013 | - | 0.025 |

### Confirmed (test-confirmed only)

| slice | n | TP | FP | FN | TN | precision | recall | specificity | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| overall | 493 | 0 | 1 | 250 | 242 | 0.000 | 0.000 | 0.996 | - |
| repo Delgan__loguru | 2 | 0 | 0 | 1 | 1 | - | 0.000 | 1.000 | - |
| repo PyCQA__isort | 43 | 0 | 0 | 20 | 23 | - | 0.000 | 1.000 | - |
| repo Textualize__rich | 2 | 0 | 0 | 1 | 1 | - | 0.000 | 1.000 | - |
| repo aio-libs__multidict | 5 | 0 | 0 | 2 | 3 | - | 0.000 | 1.000 | - |
| repo aio-libs__yarl | 14 | 0 | 0 | 7 | 7 | - | 0.000 | 1.000 | - |
| repo arrow-py__arrow | 11 | 0 | 0 | 5 | 6 | - | 0.000 | 1.000 | - |
| repo axios__axios | 4 | 0 | 0 | 2 | 2 | - | 0.000 | 1.000 | - |
| repo colinhacks__zod | 119 | 0 | 0 | 61 | 58 | - | 0.000 | 1.000 | - |
| repo dateutil__dateutil | 10 | 0 | 0 | 5 | 5 | - | 0.000 | 1.000 | - |
| repo encode__httpx | 19 | 0 | 0 | 10 | 9 | - | 0.000 | 1.000 | - |
| repo encode__starlette | 4 | 0 | 0 | 2 | 2 | - | 0.000 | 1.000 | - |
| repo encode__uvicorn | 16 | 0 | 0 | 8 | 8 | - | 0.000 | 1.000 | - |
| repo fastapi__fastapi | 17 | 0 | 0 | 8 | 9 | - | 0.000 | 1.000 | - |
| repo fastapi__sqlmodel | 6 | 0 | 0 | 4 | 2 | - | 0.000 | 1.000 | - |
| repo honojs__hono | 19 | 0 | 0 | 11 | 8 | - | 0.000 | 1.000 | - |
| repo httpie__cli | 4 | 0 | 0 | 2 | 2 | - | 0.000 | 1.000 | - |
| repo jazzband__pip-tools | 9 | 0 | 0 | 4 | 5 | - | 0.000 | 1.000 | - |
| repo marshmallow-code__marshmallow | 13 | 0 | 0 | 7 | 6 | - | 0.000 | 1.000 | - |
| repo more-itertools__more-itertools | 10 | 0 | 0 | 5 | 5 | - | 0.000 | 1.000 | - |
| repo pallets__click | 11 | 0 | 0 | 4 | 7 | - | 0.000 | 1.000 | - |
| repo pallets__flask | 8 | 0 | 0 | 4 | 4 | - | 0.000 | 1.000 | - |
| repo pallets__jinja | 3 | 0 | 0 | 2 | 1 | - | 0.000 | 1.000 | - |
| repo pallets__werkzeug | 10 | 0 | 0 | 7 | 3 | - | 0.000 | 1.000 | - |
| repo psf__black | 62 | 0 | 0 | 33 | 29 | - | 0.000 | 1.000 | - |
| repo psf__requests | 10 | 0 | 0 | 5 | 5 | - | 0.000 | 1.000 | - |
| repo pydantic__pydantic-settings | 32 | 0 | 1 | 15 | 16 | 0.000 | 0.000 | 0.941 | - |
| repo pytest-dev__pluggy | 6 | 0 | 0 | 3 | 3 | - | 0.000 | 1.000 | - |
| repo python-attrs__attrs | 7 | 0 | 0 | 4 | 3 | - | 0.000 | 1.000 | - |
| repo python-jsonschema__jsonschema | 5 | 0 | 0 | 2 | 3 | - | 0.000 | 1.000 | - |
| repo sindresorhus__ky | 8 | 0 | 0 | 3 | 5 | - | 0.000 | 1.000 | - |
| repo tqdm__tqdm | 4 | 0 | 0 | 3 | 1 | - | 0.000 | 1.000 | - |
| language python | 343 | 0 | 1 | 173 | 169 | 0.000 | 0.000 | 0.994 | - |
| language ts | 150 | 0 | 0 | 77 | 73 | - | 0.000 | 1.000 | - |
| confidence medium | 8 | 0 | 0 | 8 | 0 | - | 0.000 | - | - |
| confidence none | 243 | 0 | 1 | 0 | 242 | 0.000 | - | 0.996 | - |
| confidence revert | 5 | 0 | 0 | 5 | 0 | - | 0.000 | - | - |
| confidence strong | 135 | 0 | 0 | 13 | 122 | - | 0.000 | 1.000 | - |
| confidence weak | 237 | 0 | 0 | 237 | 0 | - | 0.000 | - | - |


## Hand-checked ground truth

### Flagged (high or test-confirmed)

| slice | n | TP | FP | FN | TN | precision | recall | specificity | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| overall | 274 | 0 | 1 | 2 | 271 | 0.000 | 0.000 | 0.996 | - |
| repo Delgan__loguru | 1 | 0 | 0 | 0 | 1 | - | - | 1.000 | - |
| repo PyCQA__isort | 23 | 0 | 0 | 0 | 23 | - | - | 1.000 | - |
| repo Textualize__rich | 2 | 0 | 0 | 0 | 2 | - | - | 1.000 | - |
| repo aio-libs__multidict | 3 | 0 | 0 | 0 | 3 | - | - | 1.000 | - |
| repo aio-libs__yarl | 8 | 0 | 0 | 0 | 8 | - | - | 1.000 | - |
| repo arrow-py__arrow | 6 | 0 | 0 | 0 | 6 | - | - | 1.000 | - |
| repo axios__axios | 3 | 0 | 0 | 0 | 3 | - | - | 1.000 | - |
| repo colinhacks__zod | 62 | 0 | 0 | 0 | 62 | - | - | 1.000 | - |
| repo dateutil__dateutil | 5 | 0 | 0 | 0 | 5 | - | - | 1.000 | - |
| repo encode__httpx | 10 | 0 | 0 | 0 | 10 | - | - | 1.000 | - |
| repo encode__starlette | 2 | 0 | 0 | 0 | 2 | - | - | 1.000 | - |
| repo encode__uvicorn | 9 | 0 | 0 | 0 | 9 | - | - | 1.000 | - |
| repo fastapi__fastapi | 17 | 0 | 0 | 0 | 17 | - | - | 1.000 | - |
| repo fastapi__sqlmodel | 2 | 0 | 0 | 0 | 2 | - | - | 1.000 | - |
| repo honojs__hono | 8 | 0 | 0 | 0 | 8 | - | - | 1.000 | - |
| repo httpie__cli | 2 | 0 | 0 | 0 | 2 | - | - | 1.000 | - |
| repo jazzband__pip-tools | 5 | 0 | 0 | 0 | 5 | - | - | 1.000 | - |
| repo marshmallow-code__marshmallow | 6 | 0 | 0 | 0 | 6 | - | - | 1.000 | - |
| repo more-itertools__more-itertools | 5 | 0 | 0 | 0 | 5 | - | - | 1.000 | - |
| repo pallets__click | 8 | 0 | 0 | 0 | 8 | - | - | 1.000 | - |
| repo pallets__flask | 4 | 0 | 0 | 0 | 4 | - | - | 1.000 | - |
| repo pallets__jinja | 1 | 0 | 0 | 0 | 1 | - | - | 1.000 | - |
| repo pallets__werkzeug | 4 | 0 | 0 | 0 | 4 | - | - | 1.000 | - |
| repo psf__black | 32 | 0 | 0 | 2 | 30 | - | 0.000 | 1.000 | - |
| repo psf__requests | 9 | 0 | 0 | 0 | 9 | - | - | 1.000 | - |
| repo pydantic__pydantic-settings | 18 | 0 | 1 | 0 | 17 | 0.000 | - | 0.944 | - |
| repo pytest-dev__pluggy | 3 | 0 | 0 | 0 | 3 | - | - | 1.000 | - |
| repo python-attrs__attrs | 4 | 0 | 0 | 0 | 4 | - | - | 1.000 | - |
| repo python-jsonschema__jsonschema | 3 | 0 | 0 | 0 | 3 | - | - | 1.000 | - |
| repo sindresorhus__ky | 8 | 0 | 0 | 0 | 8 | - | - | 1.000 | - |
| repo tqdm__tqdm | 1 | 0 | 0 | 0 | 1 | - | - | 1.000 | - |
| language python | 193 | 0 | 1 | 2 | 190 | 0.000 | 0.000 | 0.995 | - |
| language ts | 81 | 0 | 0 | 0 | 81 | - | - | 1.000 | - |
| confidence medium | 8 | 0 | 0 | 2 | 6 | - | 0.000 | 1.000 | - |
| confidence none | 243 | 0 | 1 | 0 | 242 | 0.000 | - | 0.996 | - |
| confidence revert | 2 | 0 | 0 | 0 | 2 | - | - | 1.000 | - |
| confidence strong | 32 | 0 | 0 | 2 | 30 | - | 0.000 | 1.000 | - |
| confidence weak | 21 | 0 | 0 | 0 | 21 | - | - | 1.000 | - |

### Confirmed (test-confirmed only)

| slice | n | TP | FP | FN | TN | precision | recall | specificity | F1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| overall | 274 | 0 | 1 | 2 | 271 | 0.000 | 0.000 | 0.996 | - |
| repo Delgan__loguru | 1 | 0 | 0 | 0 | 1 | - | - | 1.000 | - |
| repo PyCQA__isort | 23 | 0 | 0 | 0 | 23 | - | - | 1.000 | - |
| repo Textualize__rich | 2 | 0 | 0 | 0 | 2 | - | - | 1.000 | - |
| repo aio-libs__multidict | 3 | 0 | 0 | 0 | 3 | - | - | 1.000 | - |
| repo aio-libs__yarl | 8 | 0 | 0 | 0 | 8 | - | - | 1.000 | - |
| repo arrow-py__arrow | 6 | 0 | 0 | 0 | 6 | - | - | 1.000 | - |
| repo axios__axios | 3 | 0 | 0 | 0 | 3 | - | - | 1.000 | - |
| repo colinhacks__zod | 62 | 0 | 0 | 0 | 62 | - | - | 1.000 | - |
| repo dateutil__dateutil | 5 | 0 | 0 | 0 | 5 | - | - | 1.000 | - |
| repo encode__httpx | 10 | 0 | 0 | 0 | 10 | - | - | 1.000 | - |
| repo encode__starlette | 2 | 0 | 0 | 0 | 2 | - | - | 1.000 | - |
| repo encode__uvicorn | 9 | 0 | 0 | 0 | 9 | - | - | 1.000 | - |
| repo fastapi__fastapi | 17 | 0 | 0 | 0 | 17 | - | - | 1.000 | - |
| repo fastapi__sqlmodel | 2 | 0 | 0 | 0 | 2 | - | - | 1.000 | - |
| repo honojs__hono | 8 | 0 | 0 | 0 | 8 | - | - | 1.000 | - |
| repo httpie__cli | 2 | 0 | 0 | 0 | 2 | - | - | 1.000 | - |
| repo jazzband__pip-tools | 5 | 0 | 0 | 0 | 5 | - | - | 1.000 | - |
| repo marshmallow-code__marshmallow | 6 | 0 | 0 | 0 | 6 | - | - | 1.000 | - |
| repo more-itertools__more-itertools | 5 | 0 | 0 | 0 | 5 | - | - | 1.000 | - |
| repo pallets__click | 8 | 0 | 0 | 0 | 8 | - | - | 1.000 | - |
| repo pallets__flask | 4 | 0 | 0 | 0 | 4 | - | - | 1.000 | - |
| repo pallets__jinja | 1 | 0 | 0 | 0 | 1 | - | - | 1.000 | - |
| repo pallets__werkzeug | 4 | 0 | 0 | 0 | 4 | - | - | 1.000 | - |
| repo psf__black | 32 | 0 | 0 | 2 | 30 | - | 0.000 | 1.000 | - |
| repo psf__requests | 9 | 0 | 0 | 0 | 9 | - | - | 1.000 | - |
| repo pydantic__pydantic-settings | 18 | 0 | 1 | 0 | 17 | 0.000 | - | 0.944 | - |
| repo pytest-dev__pluggy | 3 | 0 | 0 | 0 | 3 | - | - | 1.000 | - |
| repo python-attrs__attrs | 4 | 0 | 0 | 0 | 4 | - | - | 1.000 | - |
| repo python-jsonschema__jsonschema | 3 | 0 | 0 | 0 | 3 | - | - | 1.000 | - |
| repo sindresorhus__ky | 8 | 0 | 0 | 0 | 8 | - | - | 1.000 | - |
| repo tqdm__tqdm | 1 | 0 | 0 | 0 | 1 | - | - | 1.000 | - |
| language python | 193 | 0 | 1 | 2 | 190 | 0.000 | 0.000 | 0.995 | - |
| language ts | 81 | 0 | 0 | 0 | 81 | - | - | 1.000 | - |
| confidence medium | 8 | 0 | 0 | 2 | 6 | - | 0.000 | 1.000 | - |
| confidence none | 243 | 0 | 1 | 0 | 242 | 0.000 | - | 0.996 | - |
| confidence revert | 2 | 0 | 0 | 0 | 2 | - | - | 1.000 | - |
| confidence strong | 32 | 0 | 0 | 2 | 30 | - | 0.000 | 1.000 | - |
| confidence weak | 21 | 0 | 0 | 0 | 21 | - | - | 1.000 | - |


## Top catches

Ground truth: hand.

No true positives.

## Worst misses

Ground truth: hand.

- `psf__black-658c8d8d-aafc21aa` (not flagged, medium) [A](https://github.com/psf/black/commit/658c8d8d96047c5ba77be4aecc2545a22d5e35b9) [B](https://github.com/psf/black/commit/aafc21aa77f5c4d2ebcb833aa60faba6c2138b94) [fix](https://github.com/psf/black/commit/78163939f157d9e18a8c0528fc5e1c58b1c1e69c). verification: -; branch tests: neither branch added or modified a test file
- `psf__black-c26c7728-2918ea3b` (not flagged, medium) [A](https://github.com/psf/black/commit/c26c7728e883db1425f7ed7affec41da3b3200a3) [B](https://github.com/psf/black/commit/2918ea3b079bbb617b2f9f0d5bc0b84fde04e48e) [fix](https://github.com/psf/black/commit/9b161072c13c0ec32c9ca9bd48fad17f781a56d4). verification: -; branch tests: no branch test passed on its own branch, nothing to compare

## False alarms

Ground truth: hand.

- `pydantic__pydantic-settings-a853a132-c2fd92ff` (confirmed, none) [A](https://github.com/pydantic/pydantic-settings/commit/a853a132cfeeb69b72c8c9f0378f860e9becfd3f) [B](https://github.com/pydantic/pydantic-settings/commit/c2fd92ffa74b14ed38fd8fcb1f77d087ca4a960e). verification: generated test also passes on the merge; branch tests: 1 test(s) from the branches' own test files pass on their branch and fail on the merge of A+B (not on the merge-base, twice on the merge), e.g. tests.test_settings
