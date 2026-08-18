# Primary Targets

.PHONY: all build build-go test

all: build test

GO_SERVICES := $(shell find . -name 'go.mod' -not -path '*/vendor/*' -exec dirname {} \; | sort -u)
PYTHON_SERVICES := $(shell find . -name 'tox.ini' -not -path '*/.venv/*' -exec dirname {} \; | sort -u)

build: build-go

build-go:
	@for service in $(GO_SERVICES); do \
		echo "==> go build: $$service"; \
		(cd $$service && go build ./...) || exit 1; \
	done

test: test-unit

# Testing

.PHONY: test-unit test-unit-go test-unit-python test-e2e

E2E_DIR := e2e
E2E_VENV := $(E2E_DIR)/.venv
# Extra pytest arguments, e.g. E2E_PYTEST_ARGS='-m "not external"' to skip the
# tests that reach a third-party API (CI does exactly that).
E2E_PYTEST_ARGS ?=

test-unit: test-unit-go test-unit-python

test-e2e:
	@echo "==> e2e tests: $(E2E_DIR) (requires a running cluster, see ./recreate-cluster.sh)"
	python3 -m venv $(E2E_VENV)
	$(E2E_VENV)/bin/pip install --quiet -r $(E2E_DIR)/requirements.txt
	cd $(E2E_DIR) && .venv/bin/pytest $(E2E_PYTEST_ARGS)

test-unit-go:
	@for service in $(GO_SERVICES); do \
		echo "==> go test: $$service"; \
		(cd $$service && go test ./...) || exit 1; \
	done

test-unit-python:
	@for service in $(PYTHON_SERVICES); do \
		echo "==> tox tests: $$service"; \
		(cd $$service && tox -e tests) || exit 1; \
	done

# Dependency hygiene

.PHONY: tidy tidy-go

tidy: tidy-go

tidy-go:
	@for service in $(GO_SERVICES); do \
		echo "==> go mod tidy: $$service"; \
		(cd $$service && go mod tidy) || exit 1; \
	done

# Linting and formatting

.PHONY: lint lint-go lint-python format

lint: lint-go lint-python

lint-go:
	@for service in $(GO_SERVICES); do \
		echo "==> golangci-lint: $$service"; \
		(cd $$service && golangci-lint run --fix --timeout=5m) || exit 1; \
	done

lint-python:
	@for service in $(PYTHON_SERVICES); do \
		echo "==> tox pre-commit: $$service"; \
		(cd $$service && tox -e pre-commit) || exit 1; \
	done

# Help

help:
	@echo "Available targets:"
	@echo "  build: Build all Go services"
	@echo "  test-unit: Run unit tests"
	@echo "  test-e2e: Run end-to-end tests against a running cluster"
	@echo "  tidy: Run go mod tidy across all Go services"
	@echo "  lint: Run all linters"
