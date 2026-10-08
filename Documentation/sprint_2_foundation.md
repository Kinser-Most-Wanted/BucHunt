# Sprint 2 shared foundation

## Scope

This shell supplies navigation, independent UI regions, TypeScript contracts, and test selectors. It does not implement any PBI acceptance criteria. Forms remain disabled until their owners implement the complete behavior. No credentials, answers, or saved configuration are embedded in public assets.

## Run

Run `pnpm install --frozen-lockfile`, `pnpm build`, then `pnpm run serve`. Open http://localhost:3000. After changing TypeScript, rebuild or use `pnpm build:watch` in a second terminal. Deployment already builds TypeScript and uploads src. Do not commit generated src/js files.
Run `pnpm exec playwright install chromium` and `pnpm run test:e2e` for the shell smoke test. That test covers navigation and disabled placeholders, not feature completion.

## Independent work

| Issue                       | Primary file                                            | Interface / UI region                        |
| --------------------------- | ------------------------------------------------------- | -------------------------------------------- |
| #31 Create hunt             | src/ts/features/createHunt.ts                           | mountCreateHunt; HuntInput; create-hunt      |
| #32 Define task             | src/ts/features/defineTask.ts                           | mountDefineTask; TaskInput; define-task      |
| #38 Display tasks           | src/ts/features/displayTasks.ts                         | mountDisplayTasks; PlayerHunt; display-tasks |
| #34 JSON persistence        | src/ts/features/huntRepository.ts                       | HuntRepository                               |
| #33 Validation              | src/ts/features/validateDefinitions.ts                  | DefinitionValidator; ValidationIssue         |
| #43 Admin access            | src/ts/features/adminAccess.ts                          | AuthenticationService; admin-access          |
| #35 Automated verification  | tests/deployment.spec.ts and future feature tests       | data-testid selectors; service doubles       |
| #36 Deployment verification | existing deployment workflow and future live-site tests | build outputs and deployed URL               |

Each mount function receives its root element and a service dependency. Tests can inject service doubles directly, without waiting for another PBI. Keep DOM queries inside the supplied root. Feature owners should use their own module first; coordinate shared HTML, contracts, bootstrap, and CSS edits to reduce merge conflicts. The existing mainMenu.ts and game.html remain outside this skeleton.

## Contract decisions

Hunt name and description are provisional basic identifying fields: the PBIs do not specify the final required field set. The validation owner and PO must agree on those rules. Task inputs contain a display label, required answer, and optional latitude/longitude pair; answer matching and location rules remain undecided.
OperationResult distinguishes success from not-implemented, validation, unauthorized, not-found, storage, and network failures. A successful creation means the server has persisted it, not merely updated a browser object.
PlayerHunt contains PlayerTask values with completed status and no requiredAnswer. Authentication must protect server administrative operations; hiding UI or enabling forms is not authorization.
DefinitionValidator is an interface only. Its exported implementation is undefined until #33 supplies one. Do not treat that as successful validation.

## JSON files, not a database

The future server owns a private JSON file with this shape:

```json
{
  "schemaVersion": 1,
  "hunts": [
    {
      "id": "example-hunt-id",
      "name": "Example",
      "description": "Example description",
      "tasks": [
        {
          "id": "example-task-id",
          "huntId": "example-hunt-id",
          "displayLabel": "Example task",
          "requiredAnswer": "Private server-only example",
          "location": { "latitude": 36.3, "longitude": -82.4 }
        }
      ]
    }
  ]
}
```

This example is documentation, not a shipped data fixture. Keep the JSON outside the publicly served src directory. Do not use localStorage as server persistence. #34 must implement file parsing, schema checks, retrieval after restart, failed-write handling, and safe atomic writes with serialized concurrent mutations. Only report success after the write succeeds. Player completion storage is separate from hunt definitions and needs a player identity decision.

S3 + CloudFront currently host the static frontend. They do not run a server process that can authenticate administrators and edit a local JSON file. Server runtime, durable file location, API URL, sessions, and deployment wiring still need team decisions and separate implementation. No server, database, API endpoint, or infrastructure resource is added by this shell.

Suggested API boundaries for team agreement (not implemented): administrative session creation/deletion; create hunt; add task; get administrative hunt; get player hunt. Use server-issued session cookies and enforce authorization/validation on the server. Never return required answers to players.

## Integration

Freeze shared contracts before parallel development. Review a proposed contract change with affected owners. Inject doubles for unavailable services and keep production adapters explicitly unimplemented until real services exist. #35 should add success/failure tests as PBIs become implemented. #36 should verify the deployed URL after deployment, separately from local smoke tests.
