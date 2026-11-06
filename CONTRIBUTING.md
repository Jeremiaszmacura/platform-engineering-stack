# Contributing Guidelines

## Claude Code

While working with Claude Code, please keep the following guidelines in mind to ensure a smooth and efficient collaboration:
* Start conversations with plan mode - this helps to clarify the task and set expectations by exploring codebase, identifying relevant files, and outlining the steps needed to complete the task.
* When a task is long, create GitHub Issues after planning the implementation. This saves the plan and lets you reference it while working on each step in separate context windows. It also helps avoid exceeding the context window, which can reduce code consistency and quality.
* Keep CLAUDE.md file with code principles and guidelines. This allows Claude Code to refer to it when making decisions about code style, architecture, and best practices, ensuring that the codebase remains consistent and maintainable.
* Block destructive commands like `rm -rf` or `git push --force` in `.claude/settings.json` to prevent accidental data loss or disruption to the repository. This adds an extra layer of safety when working with the codebase.
