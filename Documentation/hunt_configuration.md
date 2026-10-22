# Hunt configuration

## Scope and files

Hunts and their Tasks are stored together in a private JSON configuration file. The sprint integration implements validated file reads/writes and an HTTP API using this format. Access codes, location verification, scoring, hint delivery, and gameplay ordering enforcement remain future work.

- `data/hunts.json` is the empty initial store: `{ "schemaVersion": 1, "hunts": [] }`.
- `data/hunts.example.json` is an illustrative fixture with two embedded Tasks. Its IDs, answers, coordinates, and dates are fictional test data; do not load it as production configuration.
- `data/hunts.schema.json` defines the Draft 2020-12 JSON Schema.
- `src/ts/foundation/types.ts` supplies the corresponding TypeScript interfaces.

Keep real answer-bearing configuration outside the publicly served `src/` directory. The application server enforces hunt owner/contributor authorization and returns player-facing projections without `requiredAnswer` or private owner metadata. Do not expose the raw configuration through a public file endpoint.

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

Open `http://127.0.0.1:3000/admin.html` (Hunt Studio). There is no administrator API token, no global administrator role, and no AWS access requirement for hunt creators. Anyone with a temporary creator profile can create a hunt. The server derives ownership from that profile and ignores client-supplied `ownerId` values. IDs, timestamps and draft status are generated on the server.

**My hunts** lists only hunts this profile owns or contributes to. Select a hunt to load its tasks; manual hunt-ID entry is no longer needed for editing. Creating a hunt selects it automatically. The public player link still includes the hunt ID; access-code joining is later work.

Until Google sign-in is integrated, `GET /api/admin/session` automatically sets a random, HttpOnly, SameSite browser cookie. Its SHA-256 hash becomes a public `browser:<hash>` creator ID. Public IDs are safe to share and cannot be used as the private session cookie to impersonate their owners. This is a temporary browser identity, not an authenticated Google account. Clearing cookies, changing browser profiles, or moving devices loses access to that profile; no account recovery or linking is implemented yet. Google integration must verify identity on the server and explicitly link/migrate these IDs before replacing them.

To collaborate, the contributor opens Hunt Studio and copies their creator ID. The hunt owner selects the hunt and adds that ID under **Contributors**. Contributors can retrieve the hunt's private configuration and add tasks. Only the owner can grant or remove contributor access. Grants are stored in private `hunt-contributors.json`, using `{ "schemaVersion": 1, "contributors": { "<hunt-id>": ["<creator-id>"] } }`. This keeps the existing version-1 hunt schema unchanged. The server enforces access on each request; hiding or altering controls in the browser cannot bypass it. Membership persists across application restarts and removal revokes subsequent access immediately.

Legacy hunts created with the former shared token retain their existing owner IDs and their stored data. They are not automatically claimed by the first visitor. Records owned by `sprint-admin` require a controlled one-time reassignment to the intended creator's ID by the data operator; back up the JSON and stop the writer before doing so. Never distribute the origin secret as a means to claim a hunt.

By default the server writes the real `data/hunts.json` file. Set `DATA_DIRECTORY` to use another private directory. Missing stores start empty on first save; malformed stores and unsupported schema versions fail without overwriting existing bytes. Every mutation validates the complete hunt, including all embedded tasks. Concurrent mutations in the single application process are queued. Each save writes an exclusive temporary file, synchronizes it, atomically renames it, and synchronizes the containing directory on POSIX. Windows synchronizes the file but does not support this directory sync operation. Failed writes return a failed operation rather than a successful response. Do not run multiple writers against the same files or place them on a filesystem without atomic rename semantics.

Player responses omit required answers and owner metadata. Correct answers update a separate private `player-progress.json`, keyed by an anonymous browser cookie and hunt ID. Completion survives reloads and server restarts. Separate browser profiles have independent completion. Clearing cookies loses access to that anonymous progress. This adds only a minimal answer flow to demonstrate #38; account-backed player identity, access-code joining, publication controls, scoring, and sequential completion enforcement remain later work.

### HTTP operations

| Method | Path                                           | Result                                               |
| ------ | ---------------------------------------------- | ---------------------------------------------------- |
| GET    | `/api/admin/session`                           | Start or restore the temporary creator profile       |
| GET    | `/api/admin/hunts`                             | List only owned or contributed hunts                 |
| GET    | `/api/admin/hunts/:id/contributors`            | List contributors (owner only)                       |
| POST   | `/api/admin/hunts/:id/contributors`            | Add a creator ID (owner only)                        |
| DELETE | `/api/admin/hunts/:id/contributors/:creatorId` | Revoke contributor access (owner only)               |
| GET    | `/api/health`                                  | Application readiness response                       |
| POST   | `/api/admin/hunts`                             | Validate and persist a new hunt                      |
| GET    | `/api/admin/hunts/:id`                         | Retrieve private hunt/task configuration             |
| POST   | `/api/admin/hunts/:id/tasks`                   | Validate and persist an embedded task                |
| GET    | `/api/player/hunts/:id`                        | Public task projection and this browser's completion |
| POST   | `/api/player/hunts/:id/tasks/:taskId/answer`   | Validate an answer and persist completion            |

Creator requests use the automatic private cookie. Creating a hunt requires a creator session; reading a private hunt or adding a task additionally requires ownership or contributor membership. Only owners can manage contributor membership. There is no shared creator credential. JSON bodies are limited to 64 KiB. API responses use the shared `OperationResult` shape and disable caching. Failures distinguish validation (400), authorization (401/403), missing records/routes (404), and storage failure (500). Server failures include a request ID; structured error logs omit answers, credentials, and request bodies. Static file serving excludes server code and private JSON files.

### Deployment and verification

The former S3-only deployment could not write a server-side JSON file. The revised stack keeps a private versioned S3 bucket for release archives and runs the Node application as an unprivileged systemd service on one Amazon Linux 2023 EC2 instance. CloudFront provides HTTPS, forwards API methods/cookies without caching, and sends a private origin token. The origin security group accepts port 3000 only from CloudFront's managed prefix list. The private CloudFront origin token is generated in Secrets Manager, loaded into a root-readable environment file as `ORIGIN_TOKEN`, and never included in release archives. It protects the infrastructure origin only and grants no hunt ownership or editing privileges. The historical CloudFormation logical resource name `AdminSecret` is retained to avoid replacing the existing secret; its output is now named `OriginSecretArn`. Creators and browser tests do not read it. The deployment selects the namespaced `node-22` executable described in the [Amazon Linux documentation](https://docs.aws.amazon.com/linux/al2023/ug/nodejs.html).

Runtime JSON is under `/var/lib/buchunt` on encrypted EBS, outside release directories. Application deployment replaces a code symlink and restarts systemd without replacing configuration. Application and instance restarts preserve data. **Instance replacement is a recovery operation:** the root volume is retained on termination, but a replacement instance does not automatically attach the old data. Snapshot/restore `/var/lib/buchunt` before replacing an instance or changing its AMI/network. Retained volumes continue to incur storage charges after a stack/PR environment is destroyed; the existing destroy workflow deletes the stack and artifact bucket, not retained volumes. Backups and old-release retention are operator responsibilities.

The deploy script accepts an existing public `VPC_ID` and `SUBNET_ID`, or discovers a public subnet in the default VPC. The VPC must have DNS hostnames enabled and the subnet must have outbound internet access. The deployment role needs CloudFormation, S3, CloudFront, EC2/prefix-list discovery, SSM command/status, Secrets Manager, and IAM role/profile creation and pass-role permissions for these stack resources. The prior static-only role may need those permissions added by the AWS administrator. There are EC2/EBS/Secrets Manager costs in addition to the prior static hosting costs.

```sh
bash deploy/deploy.sh bucstop-stage
```

The delivery workflow first requires build, lint, formatting, and all automated tests to pass. It then deploys and runs the actual administration/player browser workflow against the HTTPS output URL; any failure fails the delivery job. Deployment traces remain disabled for privacy; no creator token retrieval is part of deployment verification. Verification creates a small dedicated test hunt in each deployed environment. No production data is used for tests. Tests use temporary stores locally and never overwrite tracked `data/hunts.json`.

`pnpm test` covers definition validation, restart persistence, failed writes, corrupt stores, concurrent task saves, owner/contributor authorization, grant/revoke persistence, public-ID impersonation rejection, answer privacy, player isolation, navigation, and the create-hunt/add-task/reload/answer workflow. Before merging into `stage`, obtain the team's two peer reviews and confirm the deployment job passes. A locally passing build alone does not satisfy the Definition of Done.

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

## Google-account task progress (#40)

The new player progress flow sends a Google ID token in the
`Authorization: Bearer <token>` header and uses `credentials: "omit"` for every
account API request. These endpoints never read or set application cookies.
Existing creator sessions, shared login/logout, and anonymous player endpoints
retain their previous cookie behavior. Anonymous progress is not migrated into
Google accounts automatically.

The backend verifies Google's signature, issuer, audience, expiry, verified email,
and authorized party through `google-auth-library`. It derives the storage key
from the verified Google subject, rather than trusting an account ID or email
submitted by the browser. Set `GOOGLE_CLIENT_ID` to the same client ID used by the
existing sign-in integration. The deployment script supplies it to EC2 and
packages the existing authentication runtime dependencies. No additional AWS
service or IAM permission is needed.

Task completion is stored in the private
`DATA_DIRECTORY/account-player-progress.json` (`/var/lib/buchunt` on AWS):

```json
{
  "schemaVersion": 1,
  "players": {
    "google-<sha256 of verified Google subject>": {
      "<hunt-id>": ["<completed-task-id>"]
    }
  }
}
```

Correct answers are saved before success is returned. Missing task IDs remain
incomplete. Returning with another valid token for the same Google account
restores the same completion state, including from another browser or device.
The saved-hunt list includes hunts with recorded task progress; opening a hunt
without completing a task does not create a saved-progress record. Corrupt or
unreadable progress, and missing hunt definitions referenced by saved progress,
return errors without inventing completion states or overwriting invalid data.
The existing single-writer, atomic-save, and backup requirements apply.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/player/account/config` | Public Google client ID; no token or cookie required |
| GET | `/api/player/account/hunts` | Restore this account's hunts with saved progress |
| GET | `/api/player/account/hunts/:id` | Read tasks and this account's completion state |
| POST | `/api/player/account/hunts/:id/tasks/:taskId/answer` | Validate `{ "answer": "..." }` and persist completion |

Except for config, these routes require a valid Google bearer token. They return
`OperationResult` responses with 401 for invalid/expired identity, 400 for invalid
answers, 404 for missing hunts/tasks, and 500 for storage failures. Config returns
503 when Google sign-in is not configured. Responses disable caching; failure
logs retain request IDs without recording tokens or answers.

The player page preserves hunt-ID lookup and uses server progress instead of
local hunt lists. If the token from the existing sign-in expires, or the old
login restores only its cookie session, the player page offers Google
reauthentication without using those cookies for progress. Tokens are held in
`sessionStorage`; display names remain browser-local preferences.

Access-code generation, validation, joining, participation management, publication,
and availability rules are outside this change and are owned by the teammate's
admission work. The existing reserved `accessCode: null` field and its schema are
unchanged. Hunt-ID lookup retains the existing ability to read tasks and submit
answers; admission checks can be integrated at the account route boundary later.

Tests cover durable completion, restart recovery, fresh browser contexts,
account isolation, incomplete-task preservation, invalid tokens, reauthentication,
storage failures, and cookie omission. Tests inject a local identity verifier;
production has no HTTP or environment switch to bypass Google verification.
Live Google/AWS verification and the team's peer reviews remain required before
merge.
