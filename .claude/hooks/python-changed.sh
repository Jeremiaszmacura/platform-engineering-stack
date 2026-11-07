#!/usr/bin/env bash
set -euo pipefail

file=$(jq -r '.tool_input.file_path // ""')

# openapi.yaml generates Python models, so it counts as Python.
[[ "$file" == *.py || "$file" == */openapi.yaml ]] || exit 0
case "$file" in
    */.venv/*|*/venv/*|*/.git/*) exit 0 ;;
esac

mkdir -p .claude/.cache
touch .claude/.cache/python-changed
