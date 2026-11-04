# Export hunt results

Open **Manage hunts**, select a hunt you own or contribute to, and choose **Export PDF** or **Export CSV**. PDF is the primary report; CSV contains only the player task-status table. Both downloads use the application's existing creator authentication and hunt ownership/contributor permissions.

## PDF contents

- Hunt name, description, hunt ID, and creator's stored owner ID.
- Number of participants with saved participation records.
- Scheduled start and end dates, labeled in UTC. An unset end date displays **No end date**.
- One row per saved participant: full player identifier, optional display name, completed count, incomplete count, and a Completed/Incomplete status for each current hunt task.
- A task key identifies each task by label and ID. Large hunts split into sections of three tasks, repeat player identifiers and totals, and repeat table headers across pages.

## CSV contents

CSV contains the same table, with descriptive task labels and task IDs in the column headers. It uses UTF-8, quoted fields, escaped quotes, and CRLF record separators. Cells that could be interpreted as spreadsheet formulas receive a leading apostrophe. Empty hunts produce headers without participant rows. A hunt without tasks still lists saved participants with zero totals.

## Existing-data limits

Exports read the existing account and legacy browser progress files plus optional account display names. They do not write progress or collect additional player information. No collection of completion timestamps, time spent, or answer history is added. Existing incorrect-choice selections are not included in these task-status exports.

A participant is a player with a saved record for this hunt, including joined account players with zero completed tasks. Leaving a hunt removes that participation and progress record, so departed players are absent. Legacy browser players without saved progress cannot be counted. Multiple browser IDs can represent the same human; account and browser identities are not merged or guessed.

Completed counts reflect only tasks currently in the hunt, once per task. Deleted task IDs are ignored. Incomplete means there is no saved completion for the current task; it does not establish whether a player attempted it. Results use current hunt configuration, not historical task definitions or individual assignment snapshots.

Display names are optional, editable, and may not be unique; the stable player identifier is always included. Creator attribution uses the existing owner ID rather than guessing a real name or email. PDF's portable standard fonts show unsupported characters as visible `[U+code]` escapes; CSV preserves original Unicode text.

Downloads are generated on demand, marked `no-store`, and named `hunt-<hunt-id>-results.pdf` or `.csv`. No access codes, authentication tokens, correct answers, or incorrect-choice history are exported. Concurrent activity may occur while the separate existing stores are being read; exports are a current view, not a transactionally frozen historical record.

## Verification

Run `pnpm build`, `pnpm lint`, and `pnpm exec playwright test tests/huntResultsExport.test.ts tests/huntResultsExport.spec.ts`.
