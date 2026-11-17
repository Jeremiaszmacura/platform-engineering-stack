#!/usr/bin/env bash
# Exit code 2 makes Claude Code feed stderr back to Claude and keep it working.
set -uo pipefail

cache=.claude/.cache
failed=0

# run_checks <kind> <make targets...>: runs the targets if <kind> changed; clears the marker only when they pass.
run_checks() {
    local marker="$cache/$1-changed"
    shift
    [[ -f "$marker" ]] || return 0

    local output
    if output=$(make "$@" 2>&1); then
        rm -f "$marker"
    else
        printf 'make %s failed:\n%s\n\n' "$*" "$(tail -n 80 <<<"$output")" >&2
        failed=1
    fi
}

run_checks go tidy-go lint-go test-unit-go
run_checks python lint-python test-unit-python
run_checks frontend build-frontend test-unit-frontend

if [[ -f "$cache/cluster-changed" ]]; then
    rm -f "$cache/cluster-changed"
    echo "Cluster files changed: run ./recreate-cluster.sh && make test-e2e, or tell the user why not." >&2
    failed=1
fi

[[ $failed -eq 0 ]] || exit 2
