# General

* At the end of each plan, provide a list of any unresolved questions that need answers. Keep the questions extremely concise.

## Programming rules

@shared/clean-code.md
@shared/go-programming-rules.md

## Debugging

* When you encounter an error or a failing test, resolve it in a separate subagent rather than in the main context. Prepare all the context needed to reproduce and understand the issue, then spawn a subagent to investigate and propose a fix.
* The subagent should propose a fix. If the proposed fix is not aligned with the architectural decisions, programming rules, or best practices, the main agent should reject it and provide feedback. The subagent should then propose a new fix.

## Project-specific rules

* Before modifying the project's source code, always read and follow the service design described in @../documentation/docs/design.md. If the design is unclear, ask for clarification before proceeding.
