# Local developer tasks. Nothing here pushes, deploys or touches CI.
PYTHON ?= python3
N ?= 5
FORCED ?= 3
MAX_USD ?= 1.0

.PHONY: setup dev demo
setup:
	$(PYTHON) -m venv backend/.venv
	backend/.venv/bin/python -m pip install -r backend/requirements.txt
	cd frontend && npm ci
	backend/.venv/bin/python demo/make_demo_repo.py
	backend/.venv/bin/python demo/make_api_demo_repo.py

dev:
	$(PYTHON) demo/dev.py

demo:
	cd backend && .venv/bin/python ../demo/run_demo.py

.PHONY: eval-reliability
# Needs NEBIUS_API_KEY in the environment. Runs each case N times with no cache.
eval-reliability:
	cd backend && PYTHONPATH=. $(PYTHON) scripts/eval_reliability.py --runs $(N) --forced-runs $(FORCED) --max-usd $(MAX_USD)
