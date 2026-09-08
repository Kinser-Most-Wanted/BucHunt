# Coding Standards

## Purpose

This document defines the coding standards for the project. The goal is to keep the codebase readable, maintainable, consistent across contributors, and easy to review.

The team will use:

- TypeScript for application logic
- Prettier for formatting
- ESLint for linting
- Docker for consistent local testing
- a `src/`-based project structure

---

## General Principles

All code should be:

- readable
- consistent across the project
- modular where practical
- small in scope per feature

The team should prefer simple solutions over overly complex ones unless complexity is clearly justified.

---

## Language Standards

- All application logic should be written in TypeScript
- Avoid plain JavaScript for new application logic unless there is a clear reason
- Use TypeScript types and interfaces where they improve clarity
- Avoid using `any` unless there is no practical alternative

---

## Formatting Standards

Prettier will be the source of truth for formatting.

### Rules
- Run Prettier before opening a pull request
- Do not manually fight the formatter
- Keep formatting changes separate from unrelated logic changes where practical

---

## Linting Standards

ESLint will be used to enforce code quality and consistency.

### Rules
- Code should pass ESLint before review
- Warnings should be addressed where reasonable
- Errors should be resolved before merge
- Do not disable lint rules unless there is a team discussion

---

## Naming Conventions

Use clear and descriptive names.

### Variables
Use names that describe what the value represents.

Good examples:
- `playerPosition`
- `currentWave`
- `enemySpawnTimer`

Bad examples:
- `x`
- `stuff`
- `tempValue`
- `thing`

### Functions
Function names should describe what they do.

Good examples:
- `spawnEnemy`
- `updateScore`
- `handleTouchInput`

### Types and Interfaces
Use clear names for shared shapes and data.

Good examples:
- `PlayerState`
- `EnemyConfig`
- `GameSettings`

---

## Equality and Conditionals

- Use strict equality operators: `===` and `!==`
- Keep conditionals easy to read
- Avoid deeply nested conditionals when a clearer structure is possible
- Prefer early returns when they improve readability

---

## Functions

Functions should:

- do one thing well
- be reasonably small
- have clear inputs and outputs
- avoid unnecessary side effects
- be named clearly

Good practice:
- split large logic into helpers
- keep rendering, input, and storage logic separate when practical

---

## Comments

Comments should explain **why**, not restate **what** the code already says.

### Good comments
- explain intent
- document edge-case handling
- explain a browser-specific workaround
- note a design tradeoff

### Poor comments
- restate obvious code
- describe trivial assignments
- leave outdated notes behind

---

## File Organization

All project source should live under `src/`.

```text
project/
├── src/
│   ├── index.html
│   ├── css/
│   ├── ts/
│   └── assets/
├── Dockerfile
├── compose.yml
├── README.md
└── docs/
