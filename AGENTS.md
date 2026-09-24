# AGENTS.md — Codex Repository Editing Policy

## Scope

These instructions apply to the entire repository.

The purpose of this policy is to prevent Codex from making broad or incidental changes outside the files that the developer explicitly wants changed.

## Core Rule: Repository Is Read-Only by Default

Treat the entire repository as READ-ONLY unless the developer explicitly authorizes a file path for modification in the current request.

You MAY:
- Read files.
- Search the repository.
- Inspect code, configuration, documentation, tests, and Git history.
- Run commands that are guaranteed not to modify repository contents.
- Explain which files would need changes.

You MUST NOT:
- Modify a file unless its exact path was explicitly authorized.
- Create a file unless its exact path was explicitly authorized.
- Delete a file unless its exact path was explicitly authorized.
- Rename or move files unless explicitly authorized.
- Make "helpful" changes outside the requested scope.
- Update related files automatically.
- Refactor unrelated code.
- Reformat unrelated files.
- Fix unrelated warnings, lint errors, or type errors.

## What Counts as Authorization

Authorization must identify the exact file or files Codex may modify.

Valid examples:

- "Edit `src/auth/login.ts`."
- "Change only `src/api/users.ts` and `tests/users.test.ts`."
- "You may create `src/utils/token.ts`."
- "Modify these files:
  - `src/a.ts`
  - `src/b.ts`
  - `config/app.json`"

The following DO NOT authorize repository-wide editing:

- "Fix authentication."
- "Fix this bug."
- "Implement this feature."
- "Clean this up."
- "Make the tests pass."
- "Update the API."
- "Work on the backend."
- Naming a directory without naming individual files.
- Mentioning files only as context rather than explicitly granting permission to edit them.

If exact editable file paths are not provided, remain read-only.

## No Implied Permission

Permission to edit one file does NOT imply permission to edit:

- Its tests.
- Its imports.
- Its callers.
- Its dependencies.
- Its generated output.
- Its type definitions.
- Its documentation.
- Its configuration.
- Its lockfile.
- Its package manifest.
- Its migration files.
- Related files in the same directory.

Do not infer additional permission based on normal software-development conventions.

## Required Behavior When More Files Are Needed

If the requested task cannot be completed correctly without changing additional files:

1. Do not modify those additional files.
2. Complete as much as possible within the authorized files.
3. Identify the exact additional file paths that would need permission.
4. Explain briefly why each additional file would need to change.

Do not silently expand scope.

## Commands That May Modify Files

Do not run repository-modifying commands unless their output is guaranteed to remain within the authorized file list.

Be especially careful with:

- `npm install`
- `npm update`
- `pnpm install`
- `yarn`
- `pip install` when it updates project files
- formatters using `--write`
- linters using `--fix`
- code generators
- migration generators
- scaffolding tools
- build tools that rewrite source files
- dependency updaters
- repository-wide search/replace
- cleanup scripts
- scripts with unknown side effects

Prefer read-only checks.

## Dependency and Lock Files

Never modify dependency or lock files unless explicitly authorized by exact path.

Examples include:

- `package.json`
- `package-lock.json`
- `pnpm-lock.yaml`
- `yarn.lock`
- `requirements.txt`
- `poetry.lock`
- `Pipfile.lock`
- `Cargo.toml`
- `Cargo.lock`
- `go.mod`
- `go.sum`

Installing a dependency does not automatically grant permission to modify these files.

## Configuration and Infrastructure

Never modify these unless explicitly authorized:

- `.github/**`
- `.gitignore`
- `.env*`
- CI/CD files
- Docker files
- deployment files
- infrastructure-as-code files
- editor configuration
- lint configuration
- formatter configuration
- compiler configuration
- build configuration
- database migrations
- generated files

This `AGENTS.md` file itself is also read-only unless the developer explicitly asks Codex to change it.

## No Opportunistic Cleanup

Do not make unrelated improvements while performing a task.

Avoid:

- Renaming variables outside the requested change.
- Reordering imports unnecessarily.
- Reformatting surrounding code.
- Updating comments unnecessarily.
- Removing unused code unrelated to the task.
- Refactoring nearby functions.
- Modernizing syntax.
- Fixing unrelated spelling mistakes.
- Updating dependencies.
- Changing test snapshots.

Minimal diffs are required.

## Git Safety Check

Before finishing any task that involved edits, inspect the changed-file list.

Use a read-only command such as:

`git status --short`

and/or:

`git diff --name-only`

Every changed, created, deleted, renamed, or moved file must have been explicitly authorized.

If an unauthorized file was changed during the task:

- revert that unauthorized change;
- do not include it in the final patch.

## Final Response

At the end of a task, state:

- which files were modified;
- whether all modified files were explicitly authorized;
- any additional files that would need permission to finish work that could not be completed within scope.

## Priority Rule

When there is uncertainty about whether a file may be modified:

**DO NOT MODIFY IT.**

Reading a file is not permission to edit it.

Being related to the requested task is not permission to edit it.

Being required for the ideal implementation is not permission to edit it.

Only explicit authorization of the exact path grants permission to modify that file.
