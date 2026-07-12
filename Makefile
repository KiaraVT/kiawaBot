.PHONY: sync check

sync:
	python scripts/sync.py

check:
	python scripts/sync.py --check
