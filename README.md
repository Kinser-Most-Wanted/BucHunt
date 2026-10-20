# BucHunt
BucHunt is a customizable, location-based scavenger hunt platform designed to engage, educate, and entertain the East Tennessee State University community and its many sub-groups.

## Google sign-in and administrative access (PBI 7)

Open `/admin.html` on the deployed HTTPS site and select **Sign in with Google**.
Anyone with a Google account and verified email can sign in as a regular user.
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

### Deploy

The infrastructure adds a private DynamoDB session table, Lambda and HTTP API.
CloudFront forwards `/api/auth*` and `/api/admin*` requests to that API with cookies
and Origin, with caching disabled. API errors retain their actual status codes;
the previous static-site 403/404-to-200 fallback is removed so it cannot mask API
denials.

The existing `deploy/deploy.sh` is unchanged and does not supply the new code
parameters or IAM capability. Use the following commands instead. They require
AWS CLI credentials with CloudFormation/IAM/Lambda/DynamoDB/API Gateway/S3 and
CloudFront deployment permissions, a private artifact bucket in the stack's
region, and `zip`. Use a unique immutable object key for every backend release.
The example uses Bash; keep the working directory at the repository root.

```sh
STACK_NAME=BucHunt
ARTIFACT_BUCKET=your-private-artifact-bucket
RELEASE_KEY=admin/pbi7-google-v1.zip
GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
ADMIN_EMAILS=admin@example.com,second-admin@example.com
STAGING_DIR="$(mktemp -d)"

pnpm build:admin "$STAGING_DIR/backend"
npm install --omit=dev --prefix "$STAGING_DIR/backend" \
  @aws-sdk/client-dynamodb@3.1152.0 google-auth-library@10.9.1
(cd "$STAGING_DIR/backend" && zip -r "$STAGING_DIR/admin.zip" .)
aws s3 cp "$STAGING_DIR/admin.zip" "s3://$ARTIFACT_BUCKET/$RELEASE_KEY"
aws cloudformation validate-template --template-body file://deploy/infrastructure.yml
aws cloudformation deploy --stack-name "$STACK_NAME" \
  --template-file deploy/infrastructure.yml --capabilities CAPABILITY_IAM \
  --parameter-overrides AdminCodeBucket="$ARTIFACT_BUCKET" AdminCodeKey="$RELEASE_KEY" \
    GoogleClientId="$GOOGLE_CLIENT_ID" AdminEmails="$ADMIN_EMAILS"

pnpm exec tsc --outDir "$STAGING_DIR/site/js"
cp src/index.html src/game.html src/admin.html "$STAGING_DIR/site/"
cp -R src/assets src/css "$STAGING_DIR/site/"
BUCKET_NAME="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" --output text)"
DISTRIBUTION_ID="$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" --output text)"
aws s3 sync "$STAGING_DIR/site" "s3://$BUCKET_NAME" --delete
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths '/*'
```

Only the staged public files are uploaded; backend source/tests and frontend
TypeScript are excluded. The Lambda archive contains CommonJS `admin.js` at its
root and the production dependencies installed in staging. Do not copy the
repository's `package.json` into this archive: its `type: module` setting does not
match the compiled Lambda. The cookie requires HTTPS, so the static local
`pnpm serve` command cannot exercise authentication. The configured allowed
Origin is the distribution's HTTPS domain; custom domains require an explicit
backend Origin configuration change.

### Deployed smoke checks

1. Request `/api/admin/capabilities` without a cookie: expect 401 JSON.
2. Submit an invalid or expired Google credential after starting login: expect
   denial and no session. Reusing a consumed login nonce must also be denied.
3. Sign in with an allowlisted Google account: expect the administrative panel and
   role `administrator` from `/api/auth/session`; inspect the cookie flags and
   verify the capabilities response identifies that user.
4. Sign in with a verified Google account outside `AdminEmails`: expect successful
   login, role `user` from `/api/auth/session`, and 403 from
   `/api/admin/capabilities`. No administrative controls should appear.
5. Sign out, then replay the previous cookie against either protected API: expect
   401.
6. Send a login/logout POST with a different Origin: expect 403.
7. Remove an administrator email from the configured allowlist and deploy the
   update: the existing session becomes role `user` and administrative requests
   return 403. Restore the email and deploy: that session regains role
   `administrator`. Expired sessions return 401 regardless of role.
8. Configure an empty `AdminEmails`: regular sign-in still works and all users
   receive 403 from administrative routes. An empty `GoogleClientId` still returns
   503 and prevents sign-in.
