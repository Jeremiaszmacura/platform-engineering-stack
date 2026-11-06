#!/usr/bin/env bash
# Collects Go toolchain output (the review's "ground truth") into one Markdown file.
# Tool findings never fail the script; missing tools are marked "skipped".
#
# Usage: go_signal.sh --root <module root> --out <signal.md> [--changed] [--race]
#   --changed  also list files changed vs. HEAD
#   --race     also run `go test -race ./...`
set -uo pipefail

root="" out="" changed=false race=false
while [ $# -gt 0 ]; do
    case "$1" in
        --root) root=$2; shift 2 ;;
        --out) out=$2; shift 2 ;;
        --changed) changed=true; shift ;;
        --race) race=true; shift ;;
        *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
done
if [ -z "$root" ] || [ -z "$out" ]; then
    echo "usage: go_signal.sh --root <dir> --out <file> [--changed] [--race]" >&2
    exit 2
fi

cd "$root" || exit 2
mkdir -p "$(dirname "$out")"

# section <title> <command...>: runs the command (if installed) and appends
# its output, truncated to 200 lines, under a Markdown heading.
section() {
    local title=$1; shift
    {
        echo "## ${title}"
        if ! command -v "$1" > /dev/null 2>&1; then
            echo "_skipped: \`$1\` not installed_"
        else
            echo '```'
            "$@" 2>&1 | head -n 200
            echo "exit status: ${PIPESTATUS[0]}"
            echo '```'
        fi
        echo
    } >> "$out"
}

{
    echo "# Go toolchain signal"
    echo
    echo "- Module root: \`$(pwd)\`"
    echo "- Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "- go.mod: \`$(grep -m1 '^go ' go.mod)\`"
    echo
} > "$out"

if $changed; then
    section "Changed files (vs HEAD)" git diff --name-only HEAD -- .
fi
section "gofmt -l" gofmt -l .
section "go build" go build ./...
section "go vet" go vet ./...
section "golangci-lint" golangci-lint run --timeout=5m
section "staticcheck" staticcheck ./...
section "gosec" gosec -quiet ./...
section "govulncheck" govulncheck ./...
if $race; then
    section "go test -race" go test -race ./...
fi

echo "signal written to ${out}"
