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

## Google sign-in and administrative access (PBI 7)

Open `/admin.html` on the deployed HTTPS site and use the **Administrator sign-in** panel. The Stage creator profile remains available on the same page for hunt management.
Accounts whose verified email appears in the server's `AdminEmails` allowlist
also receive administrator access. The shared sign-in page displays the account's
email and role; administrator controls appear only for administrators. BucHunt has
no separate password form or account creation flow.

The server sets a host-only `__Host-buchunt-session` cookie with
`HttpOnly; Secure; SameSite=Strict`, lasting at most one hour. Google Identity
Services returns a signed ID token to the page,
which sends it to the server without saving it to local storage. Google's official
library validates its signature, issuer, audience and expiry; the server additionally
requires a verified email and a five-minute, one-use nonce tied to the browser.
Successful login creates a new random application session. Only its SHA-256 hash
is stored as a DynamoDB lookup key. The administrator list determines permissions,
not whether someone can sign in.

Every authenticated request performs a strongly consistent session lookup and
checks expiry. The server calculates the user's current role from the email
allowlist on each request, and every administrative route also requires the
administrator role. Removing an email from the list removes administrator access
without signing the user out. DynamoDB TTL eventually removes expired records;
the server denies them immediately at their expiry time. Writes require the exact
deployed site Origin. Responses are not cached. Logout deletes the current
application session and clears its cookie; it leaves the user's Google account
signed in. Sessions expire without automatic refresh.

Endpoints:

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/auth/config` | Returns the public Google client ID and one-use login nonce; sets a browser-bound login cookie |
| POST | `/api/auth/login` | JSON `{ "credential": "GOOGLE_ID_TOKEN" }`; verifies Google identity and creates a session for any verified Google account |
| GET | `/api/auth/session` | Returns the authenticated user's subject, email, expiry and current `user` or `administrator` role |
| POST | `/api/auth/logout` | Deletes the current application session and clears its cookie |
| GET | `/api/admin/capabilities` | Returns the authenticated administrator and `administrative.access` |

Login and session responses use `{ "user": { "subject": "...", "email": "...",
"expiresAt": 0, "role": "user" } }`, with `administrator` for an allowlisted email
and the actual Unix expiry timestamp in `expiresAt`. Roles supplied by the browser
are never trusted. Authentication endpoints are under `/api/auth`; `/api/admin`
is exclusively for administrator capabilities.

Unauthenticated requests to protected endpoints return 401. Authenticated regular
users receive 403 from administrative routes while retaining access to their
session. Unknown administrative routes return 404 only after administrator
authorization. Malformed login input returns 400; invalid Google credentials
return 401. Missing Google configuration and session-store failures deny access
with 503. An empty administrator list still permits regular-user sign-in and
grants no administrator access. API Gateway throttles requests. The static login
page itself is public.

Hunt/task CRUD is not implemented in this repository. Add future handlers inside
the guarded section of `src/server/admin.ts`, using the validated administrator
identity, rather than exposing a separate unguarded route. No hunt or task data
is claimed to be managed by this PBI.

### Build and verify

Use Node.js 22.18 or newer and the pinned pnpm version. The backend uses
`google-auth-library` and `@aws-sdk/client-dynamodb`.

```sh
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm check:admin
pnpm test:admin
pnpm lint
```

The backend tests exercise regular-user and administrator login, server-side role
checks, role changes, session identity and expiry, logout/replay, login nonce
handling and request origins using test Google verification and session-store
implementations. The deployed smoke checks below also need to pass against Google
and AWS.

### Configure Google sign-in

In Google Cloud's **Google Auth Platform**, create or select a project, configure
the application's branding, set the audience to **External**, and create an OAuth
client with type **Web application**. For a public launch, publish the application
to **In production** and complete any verification Google requires. **Internal**
restricts access to the project's organization. Testing can apply test-user
restrictions; Google's current basic-identity-scope exception is described in its
[OAuth app state overview](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview).
Google Workspace policies can also restrict access. See Google's
[audience configuration guide](https://support.google.com/cloud/answer/15549945).
Copy the public client ID for the `GoogleClientId` stack parameter; this flow does
not use a client secret.

Add the site's HTTPS origin, for example `https://d123example.cloudfront.net`, to
the client's **Authorized JavaScript origins**, without `/admin.html` or a trailing
path. This implementation uses the Google Identity Services popup callback and
does not require an authorized redirect URI. For a new stack, obtain `SiteUrl`
after deployment and then add that origin before trying to sign in. Google's
[setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)
and [JavaScript API reference](https://developers.google.com/identity/gsi/web/reference/js-reference)
describe the origin and popup settings.

Pass a comma-separated list of exact Google email addresses as `AdminEmails`.
Only emails Google marks verified are accepted, compared without case sensitivity.
An empty value allows regular sign-in but grants no administrator access. To
grant or remove administrator access, update this parameter through CloudFormation;
every subsequent authenticated request uses the configured list. An existing
session gains or loses administrator permission after that deployment without
requiring another login. Google authenticates the user, and this server-side list
determines whether that user is an administrator.

The Stage deployment workflow builds and deploys the authentication Lambda alongside the hunt application. Configure the `ADMIN_ARTIFACT_BUCKET`, `GOOGLE_CLIENT_ID`, and `ADMIN_EMAILS` GitHub Actions variables before deployment. Hunt Studio's existing creator session continues to manage hunts independently of Google administrator access.
