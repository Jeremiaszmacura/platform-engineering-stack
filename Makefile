# Services are discovered automatically: Go by go.mod, Python by tox.ini.
GO_SERVICES := $(shell find . -name 'go.mod' -not -path '*/vendor/*' -exec dirname {} \; | sort -u)
PYTHON_SERVICES := $(shell find . -name 'tox.ini' -not -path '*/.venv/*' -not -path '*/node_modules/*' -exec dirname {} \; | sort -u)

E2E_DIR := e2e
E2E_VENV := $(E2E_DIR)/.venv

.PHONY: help all build build-go build-frontend test test-unit test-unit-go test-unit-python test-e2e lint lint-go lint-python

help:
	@echo "Targets:"
	@echo "  build           Build all Go services and the frontend"
	@echo "  test-unit       Run Go and Python unit tests"
	@echo "  test-e2e        Run end-to-end tests (needs a running cluster: ./recreate-cluster.sh)"
	@echo "  lint            Run Go linters and pre-commit hooks"
	@echo "  all             build + test-unit"

all: build test

# Build

build: build-go build-frontend

build-go:
	@for service in $(GO_SERVICES); do \
		echo "==> go build: $$service"; \
		(cd $$service && go build ./...) || exit 1; \
	done

build-frontend:
	cd frontend-app && npm ci && npm run build

# Testing

test: test-unit

test-unit: test-unit-go test-unit-python

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

test-e2e:
	python3 -m venv $(E2E_VENV)
	$(E2E_VENV)/bin/pip install --quiet -r $(E2E_DIR)/requirements.txt
	cd $(E2E_DIR) && .venv/bin/pytest

# Linting (reports only; never rewrites files)

lint: lint-go lint-python

lint-go:
	@for service in $(GO_SERVICES); do \
		echo "==> golangci-lint: $$service"; \
		(cd $$service && golangci-lint run --timeout=5m) || exit 1; \
	done

lint-python:
	@for service in $(PYTHON_SERVICES); do \
		echo "==> tox pre-commit: $$service"; \
		(cd $$service && tox -e pre-commit) || exit 1; \
	done
