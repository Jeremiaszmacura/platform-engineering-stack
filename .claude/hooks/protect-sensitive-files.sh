#!/usr/bin/env bash
set -euo pipefail
file=$(jq -r '.tool_input.file_path // ""')

# Glob patterns; file_path is usually absolute, so match .git at any depth.
deny_globs=(".git/*" "*/.git/*")

for g in "${deny_globs[@]}"; do
  # $g is unquoted on purpose so [[ ]] matches it as a glob pattern.
  if [[ "$file" == $g ]]; then
    echo "Edits to '$file' are blocked." 1>&2
    exit 2
  fi
done

exit 0
