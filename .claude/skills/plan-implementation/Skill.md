---
name: plan-implementation
description: While planning the implementation of a solution, create Markdown file out of it.
---

When planning the implementation of a solution, create Markdown file with following information:
* All context data needed to implement the solution in separate Claude Code context window.
* Acceptance criteria for the issue.
* Testing suite to perform tests for the issue.
* Mark that documentation update is needed after the implementation is done.
* Security considerations that should be taken into account during the implementation.
* File structure of the implementation, if needed.
* Ensure that the implementation plan follow architecture and design decisions of the project.

Save it as `plans/<short-name>.md`. `plans/` is git-ignored: plans are working notes, never part of the repository. Never commit them (no `git add -f`) and never link to them from code or docs.
