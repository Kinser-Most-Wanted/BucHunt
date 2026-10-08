# Hunt configuration

## Scope and files

Hunts and their Tasks are stored together in a private JSON configuration file. This change defines the format only; it does not implement file reads/writes, an API, access code functionality, location verification, scoring, hints, or gameplay ordering.

- `data/hunts.json` is the empty initial store: `{ "schemaVersion": 1, "hunts": [] }`.
- `data/hunts.example.json` is an illustrative fixture with two embedded Tasks. Its IDs, answers, coordinates, and dates are fictional test data; do not load it as production configuration.
- `data/hunts.schema.json` defines the Draft 2020-12 JSON Schema.
- `src/ts/foundation/types.ts` supplies the corresponding TypeScript interfaces.

Keep real answer-bearing configuration outside the publicly served `src/` directory. The current static frontend deployment does not supply a writable server or durable storage. A future server must enforce administrative authorization and return player-facing projections without `requiredAnswer` or private owner metadata. Do not expose the raw configuration through a public file endpoint.

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

## Validation and future persistence

The schema checks required fields, types, nonblank text, enum values, timestamp format, coordinate bounds, and numeric constraints. Unknown properties are rejected to catch misspelled fields. Enable date-time format checking in the schema validator. JSON Schema defaults are descriptive; validation does not automatically populate missing fields.

The future storage implementation must additionally enforce unique Hunt IDs, unique Task IDs and order values within each Hunt, and the timestamp relationships described above. These cross-record and cross-field checks are not enforced by this JSON Schema.

The TypeScript interfaces express structure only; validate untrusted JSON at runtime. `HuntInput` and `TaskInput` use the same configuration fields; the future creation feature must supply recommended initial values before invoking the repository. Keep the existing create/retrieve repository methods unchanged.

Use safe atomic writes and serialize concurrent mutations. Report success only after the durable write succeeds. Test retrieval after restart and failed-write handling when runtime persistence is implemented.

Participant identity, progress, submitted answers, earned scores, and completion timestamps belong in separate participant state, not in the Hunt configuration. Only the configured `points` value belongs here.
