# BucHunt
BucHunt is a customizable, location-based scavenger hunt platform designed to engage, educate, and entertain the East Tennessee State University community and its many sub-groups.

## Administrative access (PBI 7)

Open `/admin.html` on the deployed HTTPS site. Administrators sign in with a
provisioned Cognito username and password. Public sign-up is disabled. Only users
whose validated access token belongs to this application's pool/client and includes
the `Administrators` group can use administrative APIs.

The server sets a host-only `HttpOnly; Secure; SameSite=Strict` cookie lasting at
most one hour. Tokens are never exposed to page JavaScript or local storage.
Every protected request calls Cognito `GetUser` to validate the token, including
revocation, before trusting its issuer, client, expiry, identity and group claims.
Writes also require the exact deployed site Origin. Responses are not cached.
Logout calls `GlobalSignOut`, invalidating all the user's Cognito sessions, and
clears the cookie. Sessions expire without automatic refresh.

Endpoints:

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/api/admin/login` | JSON `{ "username": "…", "password": "…" }`; creates a cookie only for authenticated administrators |
| GET | `/api/admin/session` | Returns the authenticated administrator and expiry |
| GET | `/api/admin/capabilities` | Returns the authenticated administrator and `administrative.access` |
| POST | `/api/admin/logout` | Revokes sessions and clears the cookie |

Unauthenticated API requests return 401, authenticated non-administrators return
403, and unknown administrative routes return 404 only after authentication.
Malformed login input returns 400; provider throttling returns 429; provider
outages fail closed with 503. API Gateway throttles requests and Cognito applies
its password-attempt protections. The static login page itself is public.

Hunt/task CRUD is not implemented in this repository. Add future handlers inside
the guarded section of `src/server/admin.ts`, using the validated administrator
identity, rather than exposing a separate unguarded route. No hunt or task data
is claimed to be managed by this PBI.

### Build and verify

Use Node.js 22.18 or newer and the pinned pnpm version. No additional packages
are required. The backend uses the runtime's built-in HTTP APIs.

```sh
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm check:admin
pnpm test:admin
pnpm lint
```

The backend tests cover login success/failure, unauthenticated access, session
identity, invalid/expired/foreign tokens, group authorization, logout/replay,
request origins, malformed input and provider failures. These tests mock Cognito;
the deployed smoke checks below also need to pass against AWS.

### Deploy

The infrastructure adds a private administrator user pool, Lambda and HTTP API.
CloudFront forwards `/api/admin*` requests to that API with cookies and Origin,
with caching disabled. API errors retain their actual status codes; the previous
static-site 403/404-to-200 fallback is removed so it cannot mask API denials.

The existing `deploy/deploy.sh` is unchanged and does not supply the new code
parameters or IAM capability. Use the following commands instead. They require
AWS CLI credentials with CloudFormation/IAM/Lambda/Cognito/API Gateway/S3 and
CloudFront deployment permissions, a private artifact bucket in the stack's
region, and `zip`. Use a unique immutable object key for every backend release.
The example uses Bash; keep the working directory at the repository root.

```sh
STACK_NAME=BucHunt
ARTIFACT_BUCKET=your-private-artifact-bucket
RELEASE_KEY=admin/pbi7-v1.zip
STAGING_DIR="$(mktemp -d)"

pnpm build:admin "$STAGING_DIR/backend"
(cd "$STAGING_DIR/backend" && zip "$STAGING_DIR/admin.zip" admin.js)
aws s3 cp "$STAGING_DIR/admin.zip" "s3://$ARTIFACT_BUCKET/$RELEASE_KEY"
aws cloudformation validate-template --template-body file://deploy/infrastructure.yml
aws cloudformation deploy --stack-name "$STACK_NAME" \
  --template-file deploy/infrastructure.yml --capabilities CAPABILITY_IAM \
  --parameter-overrides AdminCodeBucket="$ARTIFACT_BUCKET" AdminCodeKey="$RELEASE_KEY"

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
root, with no package manifest. The cookie requires HTTPS, so the static local
`pnpm serve` command cannot exercise authentication. The configured allowed
Origin is the distribution's HTTPS domain; custom domains require an explicit
backend Origin configuration change.

### Provision administrators

Read the stack's `AdminUserPoolId` output. With a privileged AWS administrator
account, create a user, set a permanent password, and add group membership:

```sh
POOL_ID=your-stack-admin-user-pool-id
ADMIN_USERNAME=your-administrator-username
aws cognito-idp admin-create-user --user-pool-id "$POOL_ID" \
  --username "$ADMIN_USERNAME" --message-action SUPPRESS
aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL_ID" \
  --username "$ADMIN_USERNAME" --group-name Administrators
```

Set a permanent password using the Cognito console or the AWS CLI
`admin-set-user-password` operation with `--permanent`, taking care not to store
the password in source control or shell history. Passwords must contain at least
14 characters including upper/lowercase letters, a number and a symbol. Complete
provisioning before login; the page does not handle temporary-password or MFA
challenges. Never make an arbitrary user an administrator based on a browser
field. To remove access immediately, remove group membership and call
`admin-user-global-sign-out` (or disable the user); removing a group alone does
not invalidate already-issued token claims before expiry.

### Deployed smoke checks

1. Request `/api/admin/capabilities` without a cookie: expect 401 JSON.
2. Sign in with an incorrect password: expect denial and no session.
3. Sign in with a provisioned administrator: expect the administrative panel;
   inspect the cookie flags and verify the capabilities response identifies that user.
4. Sign in with a provisioned user outside `Administrators`: expect 403.
5. Sign out, then replay the previous cookie against the API: expect 401.
6. Send a login/logout POST with a different Origin: expect 403.
7. Expire/revoke a session, then retry a protected request: expect denial.

Cognito's [access token documentation](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html)
describes the group claims; [GlobalSignOut](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_GlobalSignOut.html)
describes revocation behavior.
