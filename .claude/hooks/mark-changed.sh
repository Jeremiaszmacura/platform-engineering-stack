#!/usr/bin/env bash
set -euo pipefail

file=$(jq -r '.tool_input.file_path // ""')

# mark <kind>: records that files of this kind changed, for stop-checks.sh.
mark() {
    mkdir -p .claude/.cache
    touch ".claude/.cache/$1-changed"
}

case "$file" in
    */.git/*|*/node_modules/*|*/.venv/*|*/vendor/*|*/dist/*) ;;
    # case stops at the first match: alert rules need their unit tests and, as cluster files, the e2e tests too.
    */monitoring/prometheus/k8s/alerts.yml) mark rules; mark cluster ;;
    */monitoring/prometheus/alerts.test.yml) mark rules ;;
    */e2e/*|*/k8s/*|*/platform/*|*/Dockerfile|*/recreate-cluster.sh) mark cluster ;;
    */documentation/web/site/*) mark go; mark frontend ;;
    *.go|*/go.mod|*/go.sum) mark go ;;
    # openapi.yaml generates Python models, so it counts as Python.
    *.py|*/openapi.yaml|*/tox.ini|*/requirements*.txt) mark python ;;
    *.ts|*.tsx|*.js|*.jsx|*.css|*.html|*/package.json|*/package-lock.json) mark frontend ;;
esac
