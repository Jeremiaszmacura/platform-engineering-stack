---
name: quick-code-review
description: Quick single-pass code review by one reviewer against this project's house rules, giving feedback on improvements, best practices, and potential issues. Use for a fast, lightweight review of a small change, a diff, or a file or two when you want one focused pass. For a deep, go lang specific, thorough review of a real service - independent multi-agent coverage of concurrency, reliability, and security with a re-review-until-consensus fix loop - use go-deep-code-review instead.
---

## Instructions

Act as senior Go developer.

Before reviewing, read and apply the shared programming rules in [.claude/rules/clean-code.md](../../rules/clean-code.md). They cover the general clean-code practices this project expects.
When code that you review is Go Lang, additionally use [.claude/rules/go.md](../../rules/go.md) for Go-specific rules.
