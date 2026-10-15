# Hunt configuration

## Scope and files

Hunts and their Tasks are stored together in a private JSON configuration file. The sprint integration implements validated file reads/writes and an HTTP API using this format. Access codes, location verification, scoring, hint delivery, and gameplay ordering enforcement remain future work.

- `data/hunts.json` is the empty initial store: `{ "schemaVersion": 1, "hunts": [] }`.
- `data/hunts.example.json` is an illustrative fixture with two embedded Tasks. Its IDs, answers, coordinates, and dates are fictional test data; do not load it as production configuration.
- `data/hunts.schema.json` defines the Draft 2020-12 JSON Schema.
- `src/ts/foundation/types.ts` supplies the corresponding TypeScript interfaces.

Keep real answer-bearing configuration outside the publicly served `src/` directory. The application server enforces administrative token authorization and returns player-facing projections without `requiredAnswer` or private owner metadata. Do not expose the raw configuration through a public file endpoint.

## File metadata

| Field           | Type                   | Meaning                                         |
| --------------- | ---------------------- | ----------------------------------------------- |
| `schemaVersion` | Integer, currently `1` | Identifies the format understood by the reader. |
| `hunts`         | Array of Hunts         | All Hunt definitions; an empty array is valid.  |

The initial foundation already reserved version 1. This specifies that initial format before persistence exists. Once stored configuration is in use, incompatible changes require a new version and an explicit migration. Unsupported versions must be rejected rather than silently interpreted.

## Hunt fields

All fields listed below must be present in persisted records.

| Field           | Type                                | Meaning                                                                                              |
| --------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `id`            | Nonblank string                     | Stable Hunt identifier; preserve it when editing.                                                    |
| `name`          | Nonblank string                     | Hunt title; preserves the foundation's existing field name.                                          |
| `description`   | Nonblank string                     | Summary or participant instructions.                                                                 |
| `ownerId`       | Nonblank string                     | Reference to the owner identity, not a copied name or email.                                         |
| `beginsAt`      | UTC date-time string                | Scheduled beginning.                                                                                 |
| `endsAt`        | UTC date-time string or `null`      | Closing time, or no scheduled closing.                                                               |
| `status`        | `draft`, `published`, or `archived` | Publication lifecycle; scheduled activity is determined separately from dates.                       |
| `createdAt`     | UTC date-time string                | Creation timestamp.                                                                                  |
| `updatedAt`     | UTC date-time string                | Last configuration edit, including edits to embedded Tasks.                                          |
| `accessCode`    | `null`                              | Placeholder only. Strings are intentionally rejected until access code functionality is implemented. |
| `taskOrderMode` | `sequential` or `any`               | Intended completion order.                                                                           |
| `tasks`         | Array of Tasks                      | Tasks owned exclusively by this Hunt; an empty array is valid for a new draft.                       |

Use ISO 8601 UTC timestamps ending in `Z`, for example `2026-10-15T14:00:00Z`. Fractional seconds are permitted. `endsAt` must be later than `beginsAt` when provided, and `updatedAt` must not precede `createdAt`.

Recommended creation values: `status: "draft"`, `endsAt: null`, `accessCode: null`, `taskOrderMode: "sequential"`, and `tasks: []`. Set both timestamps to the creation time. The trusted server must determine the owner from the authenticated identity rather than trusting an arbitrary client `ownerId`.

## Task fields

All fields listed below must be present in persisted records.

| Field                 | Type                      | Meaning                                                                                                                                        |
| --------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | Nonblank string           | Stable Task identifier, unique within its Hunt.                                                                                                |
| `displayLabel`        | Nonblank string           | Short Task title; preserves the foundation's existing field name.                                                                              |
| `description`         | Nonblank string           | Full question or instructions.                                                                                                                 |
| `requiredAnswer`      | Nonblank string           | Private correct answer; preserves the existing field name.                                                                                     |
| `location`            | Object                    | Contains numeric `latitude` (-90 through 90) and `longitude` (-180 through 180). Coordinates are stored only; no proximity check is performed. |
| `order`               | Integer, at least 1       | Intended position within this Hunt.                                                                                                            |
| `answerCaseSensitive` | Boolean                   | Declares whether case matters when answer comparison is later implemented.                                                                     |
| `hint`                | Nonblank string or `null` | Optional participant help.                                                                                                                     |
| `points`              | Integer, at least 0       | Configured score for this Task.                                                                                                                |

Recommended initial values: `answerCaseSensitive: false`, `hint: null`, and `points: 0`. Assign a unique positive `order` within the Hunt. Store Tasks in ascending order for readability; `order`, rather than array position, is authoritative. In `sequential` mode it defines the intended completion sequence. In `any` mode it defines display order only. Reordering a Task must not replace its ID.

Tasks are embedded and cannot be shared between Hunts. Stored Tasks do not duplicate `huntId`; the containing Hunt determines ownership. The existing player-facing `PlayerTask.huntId` remains available to consumers and must be derived from the parent Hunt when projecting data.

The case-sensitivity flag does not define whitespace or punctuation handling. The answer-validation feature must explicitly agree on those rules.

## Validation and persistence

The schema checks required fields, types, nonblank text, enum values, timestamp format, coordinate bounds, and numeric constraints. Unknown properties are rejected to catch misspelled fields. Enable date-time format checking in the schema validator. JSON Schema defaults are descriptive; validation does not automatically populate missing fields.

The storage implementation additionally enforces unique Hunt IDs, unique Task IDs and order values within each Hunt, and the timestamp relationships described above. These cross-record and cross-field checks are not enforced by this JSON Schema.

The TypeScript interfaces express structure only; validate untrusted JSON at runtime. `HuntInput` and `TaskInput` use the same configuration fields; the creation path supplies initial values before validating and writing the resulting definition. Keep the existing create/retrieve repository methods unchanged.

Use safe atomic writes and serialize concurrent mutations. Report success only after the durable write succeeds. Test retrieval after restart and failed-write handling when runtime persistence is implemented.

Participant identity, progress, submitted answers, earned scores, and completion timestamps belong in separate participant state, not in the Hunt configuration. Only the configured `points` value belongs here.

## Sprint integration: implemented persistence

The sprint integration implements server reads/writes in `src/ts/server/huntStore.ts`, HTTP endpoints in `src/ts/server/server.ts`, and browser calls through `src/ts/features/huntRepository.ts`.

### Run locally

Use Node.js 22 or newer and the pinned pnpm version:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm serve
```

Open `http://127.0.0.1:3000/admin.html`. The loopback-only development token is `local-development-only`; enter it in **Administrator API token**. For shared environments set a private `ADMIN_TOKEN` of at least 16 characters. Binding to a non-loopback address requires an explicit token. Never put a real token in source control or in a URL. The token stays in the administration page's memory and is cleared on reload. Token authorization is a temporary administrative boundary, not the account/session authentication planned for #43.

Create a hunt, then add tasks using the automatically populated hunt ID. The server generates IDs, timestamps, the configured owner (`ADMIN_OWNER_ID`, default `sprint-admin`), and the initial draft status. It ignores a client-supplied owner identity. Use **Load existing hunt tasks** to retrieve stored definitions after a reload. Copy the hunt ID to the player page or follow the player link. Access codes remain unimplemented; this sprint's player selector uses the hunt ID.

By default the server writes the real `data/hunts.json` file. Set `DATA_DIRECTORY` to use another private directory. Missing stores start empty on first save; malformed stores and unsupported schema versions fail without overwriting existing bytes. Every mutation validates the complete hunt, including all embedded tasks. Concurrent mutations in the single application process are queued. Each save writes an exclusive temporary file, synchronizes it, atomically renames it, and synchronizes the containing directory on POSIX. Windows synchronizes the file but does not support this directory sync operation. Failed writes return a failed operation rather than a successful response. Do not run multiple writers against the same files or place them on a filesystem without atomic rename semantics.

Player responses omit required answers and owner metadata. Correct answers update a separate private `player-progress.json`, keyed by an anonymous browser cookie and hunt ID. Completion survives reloads and server restarts. Separate browser profiles have independent completion. Clearing cookies loses access to that anonymous progress. This adds only a minimal answer flow to demonstrate #38; account-backed player identity, access-code joining, publication controls, scoring, and sequential completion enforcement remain later work.

### HTTP operations

| Method | Path                                         | Result                                               |
| ------ | -------------------------------------------- | ---------------------------------------------------- |
| GET    | `/api/health`                                | Application readiness response                       |
| POST   | `/api/admin/hunts`                           | Validate and persist a new hunt                      |
| GET    | `/api/admin/hunts/:id`                       | Retrieve private hunt/task configuration             |
| POST   | `/api/admin/hunts/:id/tasks`                 | Validate and persist an embedded task                |
| GET    | `/api/player/hunts/:id`                      | Public task projection and this browser's completion |
| POST   | `/api/player/hunts/:id/tasks/:taskId/answer` | Validate an answer and persist completion            |

Administrative requests require `Authorization: Bearer <token>`. JSON bodies are limited to 64 KiB. API responses use the shared `OperationResult` shape and disable caching. Failures distinguish validation (400), authorization (401/403), missing records/routes (404), and storage failure (500). Server failures include a request ID; structured error logs omit answers, credentials, and request bodies. Static file serving excludes server code and private JSON files.

### Deployment and verification

The former S3-only deployment could not write a server-side JSON file. The revised stack keeps a private versioned S3 bucket for release archives and runs the Node application as an unprivileged systemd service on one Amazon Linux 2023 EC2 instance. CloudFront provides HTTPS, forwards API methods/cookies without caching, and sends a private origin token. The origin security group accepts port 3000 only from CloudFront's managed prefix list. Administrative/origin tokens are generated in Secrets Manager, loaded into a root-readable environment file, and never included in release archives. The deployment selects the namespaced `node-22` executable described in the [Amazon Linux documentation](https://docs.aws.amazon.com/linux/al2023/ug/nodejs.html).

Runtime JSON is under `/var/lib/buchunt` on encrypted EBS, outside release directories. Application deployment replaces a code symlink and restarts systemd without replacing configuration. Application and instance restarts preserve data. **Instance replacement is a recovery operation:** the root volume is retained on termination, but a replacement instance does not automatically attach the old data. Snapshot/restore `/var/lib/buchunt` before replacing an instance or changing its AMI/network. Retained volumes continue to incur storage charges after a stack/PR environment is destroyed; the existing destroy workflow deletes the stack and artifact bucket, not retained volumes. Backups and old-release retention are operator responsibilities.

The deploy script accepts an existing public `VPC_ID` and `SUBNET_ID`, or discovers a public subnet in the default VPC. The VPC must have DNS hostnames enabled and the subnet must have outbound internet access. The deployment role needs CloudFormation, S3, CloudFront, EC2/prefix-list discovery, SSM command/status, Secrets Manager, and IAM role/profile creation and pass-role permissions for these stack resources. The prior static-only role may need those permissions added by the AWS administrator. There are EC2/EBS/Secrets Manager costs in addition to the prior static hosting costs.

```sh
bash deploy/deploy.sh bucstop-stage
# Retrieve the administrator token with an authorized AWS identity:
aws secretsmanager get-secret-value --secret-id <AdminSecretArn-stack-output> --query SecretString --output text
```

The delivery workflow first requires build, lint, formatting, and all automated tests to pass. It then deploys and runs the actual administration/player browser workflow against the HTTPS output URL; any failure fails the delivery job. Deployment traces are disabled to avoid recording the administrative token. Verification creates a small dedicated test hunt in each deployed environment. No production data is used for tests. Tests use temporary stores locally and never overwrite tracked `data/hunts.json`.

`pnpm test` covers definition validation, restart persistence, failed writes, corrupt stores, concurrent task saves, HTTP authorization, answer privacy, player isolation, navigation, and the create-hunt/add-task/reload/answer workflow. Before merging into `stage`, obtain the team's two peer reviews and confirm the deployment job passes. A locally passing build alone does not satisfy the Definition of Done.

### Review findings against requested issues

| Issue | Finding on stage                                      | Integrated change                                                                           |
| ----- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| #31   | Disabled form and mount placeholder                   | Working creation, validation feedback, generated hunt ID and player link                    |
| #32   | Task form called an unimplemented repository          | Live save, retrieval, next-order selection, and reload support                              |
| #34   | JSON format existed without runtime persistence       | Validated atomic writes, serialized mutations, restart-safe reads and error reporting       |
| #38   | Player mount placeholder                              | Task labels, descriptions, incomplete/completed states and per-browser persisted completion |
| #33   | Validator existed without save integration            | Server validates every complete hunt before writing                                         |
| #36   | Static-only delivery without application verification | Writable runtime, required quality checks and deployed browser verification                 |

The homepage and `Documentation/sprint_2_foundation.md` still describe the earlier skeleton because they were outside the authorized edit list. Their navigation remains usable; the administration and player pages describe the implemented behavior.
