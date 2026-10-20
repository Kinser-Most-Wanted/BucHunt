# BucHunt

BucHunt is a customizable scavenger hunt platform for the East Tennessee State University community.

The integrated sprint supports creating hunts, defining tasks with answers and coordinates, saving and retrieving server-side JSON configuration, and displaying player tasks with persisted completion. Hunt creators can create hunts immediately, manage their own hunts, and contribute to hunts shared with them. Google account integration and access-code joining remain future work.

## Local development

Use Node.js 22+ and pnpm 10.33.0.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm serve
```

Open `http://127.0.0.1:3000/admin.html` (Hunt Studio). No API token or AWS access is needed. Create a hunt, add tasks, and follow the player link. Use **My hunts** to reopen hunts you own or contribute to.

For collaboration, a contributor opens Hunt Studio and copies their creator ID. The hunt owner selects the hunt and adds that ID under **Contributors**. Contributors can add tasks; only the owner can grant or remove contributor access.

Until Google sign-in is implemented, an automatic private browser cookie identifies each creator. The UI labels this as a temporary profile. Use the same browser profile to return to your hunts; clearing cookies or using another browser creates a different identity. This is not Google authentication. Server saves update `data/hunts.json`; contributor grants and player progress are stored separately. Use `DATA_DIRECTORY` to select a different private data directory.

```sh
pnpm lint
pnpm format:check
pnpm exec playwright install --with-deps chromium
pnpm test
```

See [Hunt configuration](Documentation/hunt_configuration.md) for the JSON format, API, persistence guarantees, deployment requirements and recovery limitations. The AWS deployment now needs an application server and persistent disk; the previous static-hosting permissions alone are insufficient. Build, test, peer review, deployment, and deployed verification must succeed before the sprint is considered Done.
