import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { LoginTicket, OAuth2Client } from "google-auth-library";
import { createAdminHandler, type SessionStore } from "./admin.ts";

const config = { clientId: "google-web-client.apps.googleusercontent.com", origin: "https://example.com", adminEmails: ["admin@example.com"] };
const identity = { subject: "google-admin-id", email: "admin@example.com" };
type StoredSession = Parameters<SessionStore["put"]>[1];
const key = (kind: string, token: string) => `${kind}:${createHash("sha256").update(token).digest("hex")}`;
const event = (path = "/api/admin/capabilities", method = "GET", cookies: string[] = [], body = JSON.stringify({ credential: "signed-google-id-token" })) => ({
  rawPath: path, requestContext: { http: { method } },
  headers: { origin: config.origin, "content-type": "application/json" } as Record<string, string | undefined>,
  cookies, body, isBase64Encoded: false,
});
function memoryStore() {
  const records = new Map<string, StoredSession>();
  const store: SessionStore = {
    async get(id) { return records.get(id); },
    async put(id, value) { records.set(id, value); },
    async take(id) {
      const value = records.get(id);
      records.delete(id);
      return value;
    },
  };
  return { records, store };
}
type Handler = ReturnType<typeof createAdminHandler>;
async function begin(handler: Handler) {
  const response = await handler(event("/api/auth/config"));
  assert.equal(response.statusCode, 200);
  return { nonce: JSON.parse(response.body).nonce as string, cookie: response.cookies[0].split(";")[0], response };
}
async function signIn(handler: Handler, extraCookies: string[] = []) {
  const pending = await begin(handler);
  return handler(event("/api/auth/login", "POST", [pending.cookie, ...extraCookies]));
}
function seedSession(records: Map<string, StoredSession>, changes: Partial<StoredSession> = {}) {
  const token = "a".repeat(64);
  records.set(key("session", token), { kind: "session", ...identity, expiresAt: Math.floor(Date.now() / 1000) + 3600, ...changes });
  return `__Host-buchunt-session=${token}`;
}

test("Google configuration creates a short-lived, browser-bound nonce stored only as a hash", async () => {
  const { records, store } = memoryStore();
  const handler = createAdminHandler(config, store, async () => identity);
  const { nonce, response } = await begin(handler);
  assert.deepEqual(JSON.parse(response.body), { clientId: config.clientId, nonce });
  assert.match(nonce, /^[a-f0-9]{64}$/);
  assert.match(response.cookies[0], /; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=300$/);
  assert.equal(records.has(nonce), false);
  assert.equal(records.get(key("login", nonce))?.kind, "login");
  assert.equal(response.headers["cache-control"], "no-store");
});

test("an approved Google identity receives a secure session with its administrator role and protected capabilities", async () => {
  const { records, store } = memoryStore();
  const handler = createAdminHandler({ ...config, adminEmails: [" ADMIN@example.com "] }, store, async (credential, nonce) => {
    assert.equal(credential, "signed-google-id-token");
    assert.match(nonce, /^[a-f0-9]{64}$/);
    return identity;
  });
  const response = await signIn(handler);
  assert.equal(response.statusCode, 200);
  assert.match(response.cookies[0], /^__Host-buchunt-session=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600$/);
  assert.match(response.cookies[1], /^__Host-buchunt-login=;.*Max-Age=0$/);
  const sessionCookie = response.cookies[0].split(";")[0];
  const token = sessionCookie.split("=")[1];
  assert.equal(response.body.includes(token), false);
  assert.equal(response.body.includes("signed-google-id-token"), false);
  assert.equal(records.get(key("session", token))?.subject, identity.subject);
  const user = { ...identity, expiresAt: JSON.parse(response.body).user.expiresAt, role: "administrator" };
  assert.deepEqual(JSON.parse(response.body), { user });
  const capabilities = await handler(event("/api/admin/capabilities", "GET", [sessionCookie]));
  assert.equal(capabilities.statusCode, 200);
  assert.deepEqual(JSON.parse(capabilities.body).administrator, {
    ...identity, expiresAt: user.expiresAt,
  });
  assert.deepEqual(JSON.parse(capabilities.body).capabilities, ["administrative.access"]);
  const session = await handler(event("/api/auth/session", "GET", [sessionCookie]));
  assert.equal(session.statusCode, 200);
  assert.deepEqual(JSON.parse(session.body), { user });
  assert.equal((await handler(event("/api/admin/unknown", "GET", [sessionCookie]))).statusCode, 404);
});

test("the Google nonce is single use and cannot be replayed or used without its browser cookie", async () => {
  const { store } = memoryStore();
  let verifications = 0;
  const handler = createAdminHandler(config, store, async () => { verifications++; return identity; });
  const pending = await begin(handler);
  assert.equal((await handler(event("/api/auth/login", "POST"))).statusCode, 401);
  assert.equal(verifications, 0);
  assert.equal((await handler(event("/api/auth/login", "POST", [pending.cookie]))).statusCode, 200);
  assert.equal((await handler(event("/api/auth/login", "POST", [pending.cookie]))).statusCode, 401);
  assert.equal(verifications, 1);
});

test("expired and unknown nonces are rejected before Google verification", async () => {
  const { records, store } = memoryStore();
  const handler = createAdminHandler(config, store, async () => { assert.fail("Google must not receive an invalid nonce"); });
  const pending = await begin(handler);
  records.get(key("login", pending.nonce))!.expiresAt = 0;
  assert.equal((await handler(event("/api/auth/login", "POST", [pending.cookie]))).statusCode, 401);
  assert.equal((await handler(event("/api/auth/login", "POST", [`__Host-buchunt-login=${"b".repeat(64)}`]))).statusCode, 401);
});

test("a verified Google user can sign in, retain a session after admin denial, and sign out", async () => {
  const { records, store } = memoryStore();
  const handler = createAdminHandler(config, store, async () => ({ ...identity, email: "visitor@example.com" }));
  const response = await signIn(handler);
  assert.equal(response.statusCode, 200);
  assert.equal(records.size, 1);
  const user = { ...identity, email: "visitor@example.com", expiresAt: JSON.parse(response.body).user.expiresAt, role: "user" };
  assert.deepEqual(JSON.parse(response.body), { user });
  const sessionCookie = response.cookies[0].split(";")[0];
  for (const route of ["capabilities", "hunts", "tasks", "unknown"]) {
    const denied = await handler(event(`/api/admin/${route}`, "GET", [sessionCookie]));
    assert.equal(denied.statusCode, 403);
    assert.deepEqual(denied.cookies, []);
  }
  const session = await handler(event("/api/auth/session", "GET", [sessionCookie]));
  assert.equal(session.statusCode, 200);
  assert.deepEqual(JSON.parse(session.body), { user });
  assert.equal((await handler(event("/api/auth/logout", "POST", [sessionCookie]))).statusCode, 200);
  assert.equal(records.size, 0);
  assert.equal((await handler(event("/api/auth/session", "GET", [sessionCookie]))).statusCode, 401);
});

test("unauthenticated requests cannot reach existing or future administrative capabilities", async () => {
  const { store } = memoryStore();
  const handler = createAdminHandler(config, store, async () => { assert.fail("authentication must not run"); });
  for (const route of ["/api/auth/session", "/api/admin/capabilities", "/api/admin/hunts", "/api/admin/tasks", "/api/admin/unknown"]) {
    assert.equal((await handler(event(route))).statusCode, 401);
  }
  assert.equal((await handler(event("/api/auth/logout", "POST"))).statusCode, 401);
});

test("expired, missing, tampered and wrong-kind sessions fail closed", async () => {
  const { records, store } = memoryStore();
  const handler = createAdminHandler(config, store, async () => identity);
  const session = seedSession(records, { expiresAt: 0 });
  assert.equal((await handler(event("/api/auth/session", "GET", [session]))).statusCode, 401);
  assert.equal((await handler(event("/api/admin/capabilities", "GET", [session]))).statusCode, 401);
  seedSession(records, { kind: "login" });
  assert.equal((await handler(event("/api/auth/session", "GET", [session]))).statusCode, 401);
  records.clear();
  assert.equal((await handler(event("/api/auth/session", "GET", [session]))).statusCode, 401);
  assert.equal((await handler(event("/api/auth/session", "GET", [`__Host-buchunt-session=${"c".repeat(64)}`]))).statusCode, 401);
});

test("administrator removal demotes an existing session and promotion grants access without another login", async () => {
  const { records, store } = memoryStore();
  const sessionCookie = seedSession(records);
  const regularHandler = createAdminHandler({ ...config, adminEmails: [] }, store, async () => identity);
  const demoted = await regularHandler(event("/api/auth/session", "GET", [sessionCookie]));
  assert.equal(demoted.statusCode, 200);
  assert.equal(JSON.parse(demoted.body).user.role, "user");
  assert.equal((await regularHandler(event("/api/admin/capabilities", "GET", [sessionCookie]))).statusCode, 403);
  assert.equal(records.size, 1);
  const administratorHandler = createAdminHandler(config, store, async () => identity);
  const promoted = await administratorHandler(event("/api/auth/session", "GET", [sessionCookie]));
  assert.equal(promoted.statusCode, 200);
  assert.equal(JSON.parse(promoted.body).user.role, "administrator");
  assert.equal((await administratorHandler(event("/api/admin/capabilities", "GET", [sessionCookie]))).statusCode, 200);
});

test("client-supplied identity and role cannot grant administrator access", async () => {
  const { records, store } = memoryStore();
  const verifiedIdentity = { subject: "google-visitor-id", email: "visitor@example.com" };
  const handler = createAdminHandler(config, store, async () => verifiedIdentity);
  const pending = await begin(handler);
  const forgedCredentials = JSON.stringify({ credential: "signed-google-id-token", email: identity.email, role: "administrator" });
  const response = await handler(event("/api/auth/login", "POST", [pending.cookie], forgedCredentials));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body).user, { ...verifiedIdentity, expiresAt: JSON.parse(response.body).user.expiresAt, role: "user" });
  const sessionCookie = response.cookies[0].split(";")[0];
  const record = records.get(key("session", sessionCookie.split("=")[1]))!;
  Object.assign(record, { role: "administrator" });
  const session = await handler(event("/api/auth/session", "GET", [sessionCookie]));
  assert.equal(JSON.parse(session.body).user.role, "user");
  assert.equal((await handler(event("/api/admin/capabilities", "GET", [sessionCookie]))).statusCode, 403);
});

test("former admin authentication routes stay behind the administrator guard", async () => {
  const { records, store } = memoryStore();
  const handler = createAdminHandler(config, store, async () => identity);
  const sessionCookie = seedSession(records);
  for (const [route, method] of [["config", "GET"], ["login", "POST"], ["session", "GET"], ["logout", "POST"]]) {
    assert.equal((await handler(event(`/api/admin/${route}`, method))).statusCode, 401);
    assert.equal((await handler(event(`/api/admin/${route}`, method, [sessionCookie]))).statusCode, 404);
    const regularHandler = createAdminHandler({ ...config, adminEmails: [] }, store, async () => identity);
    assert.equal((await regularHandler(event(`/api/admin/${route}`, method, [sessionCookie]))).statusCode, 403);
    assert.equal(records.size, 1);
  }
});

test("logout removes the server session, clears the cookie and prevents replay", async () => {
  const { records, store } = memoryStore();
  const handler = createAdminHandler(config, store, async () => identity);
  const session = seedSession(records);
  const response = await handler(event("/api/auth/logout", "POST", [session]));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { signedOut: true });
  assert.match(response.cookies[0], /^__Host-buchunt-session=;.*Max-Age=0$/);
  assert.equal(records.size, 0);
  assert.equal((await handler(event("/api/auth/session", "GET", [session]))).statusCode, 401);
  assert.equal((await handler(event("/api/admin/capabilities", "GET", [session]))).statusCode, 401);
});

test("a new login rotates and revokes the existing browser session", async () => {
  const { records, store } = memoryStore();
  const handler = createAdminHandler(config, store, async () => identity);
  const previous = seedSession(records);
  const response = await signIn(handler, [previous]);
  assert.equal(response.statusCode, 200);
  assert.equal((await handler(event("/api/auth/session", "GET", [previous]))).statusCode, 401);
  assert.equal((await handler(event("/api/auth/session", "GET", [response.cookies[0].split(";")[0]]))).statusCode, 200);
  assert.equal(records.size, 1);
});

test("cross-origin and missing-origin writes are denied before any session mutation", async () => {
  const { records, store } = memoryStore();
  const handler = createAdminHandler(config, store, async () => { assert.fail("Google must not run"); });
  const session = seedSession(records);
  for (const path of ["/api/auth/login", "/api/auth/logout", "/api/admin/hunts"]) {
    for (const origin of ["https://attacker.example", undefined]) {
      const request = event(path, "POST", [session]);
      request.headers.origin = origin;
      assert.equal((await handler(request)).statusCode, 403);
      assert.equal(records.size, 1);
    }
  }
});

test("malformed credentials, oversized bodies and ambiguous cookies are denied", async () => {
  const { store } = memoryStore();
  const handler = createAdminHandler(config, store, async () => { assert.fail("Google must not run"); });
  for (const body of ["null", "{", "{}", "[]", JSON.stringify({ credential: 123 }), JSON.stringify({ credential: "" }), "x".repeat(16385)]) {
    assert.equal((await handler(event("/api/auth/login", "POST", [], body))).statusCode, 400);
  }
  const encoded = { ...event("/api/auth/login", "POST"), isBase64Encoded: true };
  assert.equal((await handler(encoded)).statusCode, 400);
  const wrongContentType = event("/api/auth/login", "POST");
  wrongContentType.headers["content-type"] = "text/plain";
  assert.equal((await handler(wrongContentType)).statusCode, 400);
  const pending = await begin(handler);
  assert.equal((await handler(event("/api/auth/login", "POST", [pending.cookie, pending.cookie]))).statusCode, 401);
  assert.equal((await handler(event("/api/auth/session", "GET", ["__Host-buchunt-session=bad-token"]))).statusCode, 401);
  const duplicate = `__Host-buchunt-session=${"a".repeat(64)}`;
  assert.equal((await handler(event("/api/auth/session", "GET", [duplicate, duplicate]))).statusCode, 401);
});

test("missing Google configuration disables sign-in", async () => {
  const { store } = memoryStore();
  for (const changes of [{ clientId: "" }, { origin: "" }]) {
    const handler = createAdminHandler({ ...config, ...changes }, store, async () => { assert.fail("Google must not run"); });
    assert.equal((await handler(event("/api/auth/config"))).statusCode, 503);
    assert.equal((await handler(event("/api/auth/login", "POST"))).statusCode, 503);
  }
});

test("an empty or whitespace-only administrator allowlist still permits ordinary Google sign-in", async () => {
  for (const adminEmails of [[], [" ", ""]]) {
    const { store } = memoryStore();
    const handler = createAdminHandler({ ...config, adminEmails }, store, async () => identity);
    const response = await signIn(handler);
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).user.role, "user");
    const sessionCookie = response.cookies[0].split(";")[0];
    assert.equal((await handler(event("/api/auth/session", "GET", [sessionCookie]))).statusCode, 200);
    assert.equal((await handler(event("/api/admin/capabilities", "GET", [sessionCookie]))).statusCode, 403);
  }
});

test("the Google verification boundary checks audience, verified email, nonce and authorized party", async t => {
  const payload = {
    iss: "https://accounts.google.com", aud: config.clientId, iat: 1, exp: 9999999999,
    sub: identity.subject, email: identity.email, email_verified: true, nonce: "", azp: config.clientId,
  };
  let claims = { ...payload };
  const calls: { idToken: string; audience: string }[] = [];
  t.mock.method(OAuth2Client.prototype, "verifyIdToken", async (options: { idToken: string; audience: string }) => {
    calls.push(options);
    return new LoginTicket("", claims);
  });
  const { store } = memoryStore();
  const handler = createAdminHandler(config, store);
  const accepted = await begin(handler);
  claims = { ...payload, nonce: accepted.nonce };
  assert.equal((await handler(event("/api/auth/login", "POST", [accepted.cookie]))).statusCode, 200);
  assert.deepEqual(calls[0], { idToken: "signed-google-id-token", audience: config.clientId });
  for (const changes of [{ email_verified: false }, { nonce: "wrong-nonce" }, { azp: "another-client" }, { sub: "" }, { email: "" }]) {
    const pending = await begin(handler);
    claims = { ...payload, nonce: pending.nonce, ...changes };
    assert.equal((await handler(event("/api/auth/login", "POST", [pending.cookie]))).statusCode, 401);
  }
});

test("invalid Google tokens and verification failures never create a session or leak provider details", async t => {
  t.mock.method(OAuth2Client.prototype, "verifyIdToken", async () => { throw new Error("sensitive provider failure"); });
  const { records, store } = memoryStore();
  const handler = createAdminHandler(config, store);
  const response = await signIn(handler);
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.includes("sensitive provider failure"), false);
  assert.equal(records.size, 0);
  assert.ok(response.cookies.every(value => value.includes("Max-Age=0")));
});

test("session store outages fail closed without leaking storage details", async () => {
  const unavailable = async () => { throw new Error("sensitive storage failure"); };
  const handler = createAdminHandler(config, { get: unavailable, put: unavailable, take: unavailable }, async () => identity);
  for (const request of [event("/api/auth/config"), event("/api/auth/session", "GET", [`__Host-buchunt-session=${"a".repeat(64)}`])]) {
    const response = await handler(request);
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.includes("sensitive storage failure"), false);
  }
});
