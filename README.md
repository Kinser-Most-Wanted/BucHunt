# BucHunt

BucHunt is a customizable scavenger hunt platform for the East Tennessee State University community.

The integrated sprint supports creating hunts, defining tasks with answers and coordinates, saving and retrieving server-side JSON configuration, and displaying player tasks with persisted completion. Administrative operations require an API token; full account authentication and access-code joining remain future work.

## Local development

Use Node.js 22+ and pnpm 10.33.0.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm serve
```

Open `http://127.0.0.1:3000/admin.html` and enter `local-development-only` as the administrator API token. Create a hunt, add tasks, then follow the player link. To work on an existing hunt, enter its ID and select **Load existing hunt tasks**. Server saves update `data/hunts.json`; player progress is stored separately. Use `DATA_DIRECTORY` to select a different private data directory. A shared deployment must supply its own private `ADMIN_TOKEN`.

```sh
pnpm lint
pnpm format:check
pnpm exec playwright install --with-deps chromium
pnpm test
```

See [Hunt configuration](Documentation/hunt_configuration.md) for the JSON format, API, persistence guarantees, deployment requirements and recovery limitations. The AWS deployment now needs an application server and persistent disk; the previous static-hosting permissions alone are insufficient. Build, test, peer review, deployment, and deployed verification must succeed before the sprint is considered Done.
