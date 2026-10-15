import { test } from "node:test";
import assert from "node:assert/strict";
import { createAdminHandler } from "./admin.ts";

const config = { region: "us-east-1", poolId: "us-east-1_test", clientId: "test-client", origin: "https://example.com" };
const claims = {
  iss: `https://cognito-idp.${config.region}.amazonaws.com/${config.poolId}`,
  client_id: config.clientId, token_use: "access", sub: "admin-id", username: "administrator",
  exp: Math.floor(Date.now() / 1000) + 3600, "cognito:groups": ["Administrators"],
};
const token = (changes = {}) => `header.${Buffer.from(JSON.stringify({ ...claims, ...changes })).toString("base64url")}.signature`;
const event = (path = "capabilities", method = "GET", accessToken?: string) => ({
  rawPath: `/api/admin/${path}`, requestContext: { http: { method } },
  headers: { origin: config.origin, "content-type": "application/json" },
  cookies: accessToken ? [`__Host-buchunt-admin=${accessToken}`] : [],
  body: JSON.stringify({ username: "administrator", password: "example-only-password" }),
});

test("valid credentials grant access with a secure cookie and no token in the response body", async () => {
  const operations: string[] = [];
  const handler = createAdminHandler(config, async (operation, body) => {
    operations.push(operation);
    if (operation === "InitiateAuth") {
      assert.deepEqual(body.AuthParameters, { USERNAME: "administrator", PASSWORD: "example-only-password" });
      return { AuthenticationResult: { AccessToken: token() } };
    }
    return { Username: "administrator" };
  });
  const response = await handler(event("login", "POST"));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(operations, ["InitiateAuth", "GetUser"]);
  assert.match(response.cookies[0], /Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=\d+/);
  assert.equal(response.body.includes(token()), false);
  assert.equal(response.headers["cache-control"], "no-store");
});

test("invalid credentials and incomplete challenges never create a session", async () => {
  const challenged = createAdminHandler(config, async () => ({ ChallengeName: "NEW_PASSWORD_REQUIRED" }));
  assert.equal((await challenged(event("login", "POST"))).statusCode, 401);
  const denied = createAdminHandler(config, async () => { throw new Error("provider rejected request"); });
  const response = await denied(event("login", "POST"));
  assert.notEqual(response.statusCode, 200);
  assert.equal(response.body.includes("provider rejected"), false);
});

test("unauthenticated requests cannot reach any administrative capability", async () => {
  const handler = createAdminHandler(config, async () => { assert.fail("provider must not be called"); });
  for (const route of ["session", "capabilities", "hunts", "tasks", "unknown"]) {
    assert.equal((await handler(event(route))).statusCode, 401);
  }
  assert.equal((await handler(event("logout", "POST"))).statusCode, 401);
});

test("authenticated capabilities are processed with the validated administrator identity", async () => {
  const handler = createAdminHandler(config, async (operation, body) => {
    assert.equal(operation, "GetUser");
    assert.equal(body.AccessToken, token());
    return { Username: "administrator" };
  });
  const response = await handler(event("capabilities", "GET", token()));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body).administrator, { username: "administrator", subject: "admin-id", expiresAt: claims.exp });
  assert.equal((await handler(event("session", "GET", token()))).statusCode, 200);
  assert.equal((await handler(event("unknown", "GET", token()))).statusCode, 404);
});

test("expired, foreign, wrong-client, ID and non-admin tokens are denied", async () => {
  const handler = createAdminHandler(config, async () => ({ Username: "administrator" }));
  for (const changes of [{ exp: 0 }, { iss: "https://attacker.example/pool" }, { client_id: "another-client" },
    { token_use: "id" }, { username: "another-user" }]) {
    assert.equal((await handler(event("capabilities", "GET", token(changes)))).statusCode, 401);
  }
  assert.equal((await handler(event("capabilities", "GET", token({ "cognito:groups": [] })))).statusCode, 403);
});

test("tampered and revoked tokens are rejected through the Cognito validation boundary", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ __type: "NotAuthorizedException" }), { status: 400 });
  try {
    const handler = createAdminHandler(config);
    assert.equal((await handler(event("capabilities", "GET", token()))).statusCode, 401);
    assert.equal((await handler(event("login", "POST"))).statusCode, 401);
  } finally { globalThis.fetch = originalFetch; }
});

test("logout revokes the token and clears the cookie; replay then fails", async () => {
  let revoked = false;
  const handler = createAdminHandler(config, async operation => {
    if (revoked) throw new Error("revoked");
    if (operation === "GlobalSignOut") { revoked = true; return {}; }
    return { Username: "administrator" };
  });
  const response = await handler(event("logout", "POST", token()));
  assert.equal(response.statusCode, 200);
  assert.match(response.cookies[0], /Max-Age=0/);
  assert.notEqual((await handler(event("capabilities", "GET", token()))).statusCode, 200);
});

test("cross-origin and missing-origin writes are denied before authentication", async () => {
  const handler = createAdminHandler(config, async () => { assert.fail("must reject before authentication"); });
  const request = event("login", "POST");
  request.headers.origin = "https://attacker.example";
  assert.equal((await handler(request)).statusCode, 403);
  request.headers.origin = "";
  assert.equal((await handler(request)).statusCode, 403);
});

test("malformed credentials and cookies are rejected", async () => {
  const handler = createAdminHandler(config, async () => { assert.fail("must reject malformed input"); });
  for (const body of ["null", "{", "{}", JSON.stringify({ username: "admin", password: 123 })]) {
    assert.equal((await handler({ ...event("login", "POST"), body })).statusCode, 400);
  }
  assert.equal((await handler(event("capabilities", "GET", "bad-token"))).statusCode, 401);
  const duplicate = event("session", "GET", token());
  duplicate.cookies.push(duplicate.cookies[0]);
  assert.equal((await handler(duplicate)).statusCode, 401);
});

test("provider throttling and outage fail closed without leaking details", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [429, 500]) {
      globalThis.fetch = async () => new Response("{}", { status });
      const response = await createAdminHandler(config)(event("capabilities", "GET", token()));
      assert.equal(response.statusCode, status === 429 ? 429 : 503);
    }
  } finally { globalThis.fetch = originalFetch; }
});
