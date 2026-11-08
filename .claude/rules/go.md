---
paths:
  - "**/*.go"
  - "**/go.mod"
---

## Go specific programming rules

* Write idiomatic Go, not translated Java/C++/Python. Prefer simple, explicit, readable code over clever abstractions.
* Always run and respect gofmt and goimports. Do not invent formatting rules. Keep imports grouped: standard library first, then third-party/project imports.
* Keep the happy path unindented. Handle errors and edge cases early, return quickly, and avoid unnecessary else after return, continue, or break.
* Handle every error explicitly. Never discard errors with _. Return, wrap, or handle errors. Do not use panic for normal service failures.
* Use clear error values and messages. Error strings should be lowercase, without trailing punctuation. Add context when returning errors, but avoid noisy or duplicate context.
* Pass context.Context explicitly. For request-scoped work, accept ctx context.Context as the first parameter. Do not store contexts in structs. Respect cancellation, deadlines, and timeouts.
* Make goroutine lifetimes obvious. Every goroutine should have a clear exit path. Avoid goroutine leaks, blocked sends/receives, unbounded concurrency, and races.
* Use interfaces only where consumed. Return concrete types from producers. Define small interfaces in the consuming package only when they are needed. Avoid "interface pollution" and mock-driven interfaces.
* Use Go naming conventions consistently. Use camelCase for unexported names and PascalCase for exported names. Keep names short and clear; avoid stutter (`vaultclient.Client`, not `vaultclient.VaultClient`).
