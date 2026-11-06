#!/usr/bin/env bash
set -euo pipefail

file=$(jq -r '.tool_input.file_path // ""')

# openapi.yaml counts as Python source: it generates a service's HTTP models,
# and `make lint-python` is what fails when they were not regenerated.
[[ "$file" == *.py || "$file" == */openapi.yaml ]] || exit 0
case "$file" in
    */.venv/*|*/venv/*|*/.git/*) exit 0 ;;
esac

mkdir -p .claude/.cache
touch .claude/.cache/python-changed
