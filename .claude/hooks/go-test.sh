#!/usr/bin/env bash
set -euo pipefail

marker=.claude/.cache/go-changed
[[ -f "$marker" ]] || exit 0
rm -f "$marker"

make test-unit-go
