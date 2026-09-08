# Tools

## Purpose

This document defines the main tools the team plans to use during development, planning, review, and testing.

The team will try to use GitHub as much as possible so work, issues, review, and progress stay centralized.

---

## Primary Tool Set

### GitHub
GitHub will be the primary platform for the project.

It will be used for:
- repository hosting
- source control
- pull requests
- code review
- issues
- project boards
- branch workflow visibility

GitHub is the center of the team workflow.

---

### Docker
Docker will be used for testing environments.

Docker is important because it:
- keeps local testing consistent across machines
- helps reduce environment-specific issues
- aligns with the AWS environment mindset
- provides a repeatable way to run and validate the project

The team should prefer testing in Docker-based environments rather than assuming local machine behavior is enough.

---

### Excalidraw
Excalidraw will be used for diagrams and lightweight design communication.

It can be used for:
- architecture sketches
- feature flow diagrams
- state flow diagrams
- interaction concepts
- quick review visuals

The goal is lightweight communication, not overly formal documentation.

---

## Development Tooling

### TypeScript
TypeScript will be used for application code.

Why:
- stronger type safety
- clearer interfaces
- easier maintenance as the project grows
- better long-term readability

### Prettier
Prettier will be used for formatting.

Why:
- consistent formatting
- fewer style debates
- faster review focus on actual logic

### ESLint
ESLint will be used for linting.

Why:
- enforces code quality rules
- catches common mistakes early
- keeps code style and correctness more consistent

---

## GitHub-Centered Workflow

The team will use GitHub as much as possible for coordination.

This includes:
- using issues for tasking
- using GitHub Projects for sprint board management
- using pull requests for review
- using branches to manage release flow
- keeping progress visible in the repository workflow

---

## Tool Summary

The core team tools are:

- **GitHub** for source control, issues, pull requests, and project boards
- **Docker** for testing environments
- **Excalidraw** for design diagrams
- **TypeScript** for implementation
- **Prettier** for formatting
- **ESLint** for linting

---

## Working Agreement

The team should prefer:
- GitHub-native workflow where practical
- Docker-based validation for real testing
- lightweight diagrams in Excalidraw for communication
- consistent development standards enforced with TypeScript, Prettier, and ESLint
