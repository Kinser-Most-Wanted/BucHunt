import { OAuth2Client } from "google-auth-library";
import { DeleteItemCommand, DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";

interface ApiEvent {
  rawPath: string;
  headers: Record<string, string | undefined>;
  cookies?: string[];
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string } };
}
interface Config { clientId: string; origin: string; adminEmails: string[]; }
interface StoredSession { kind: "login" | "session"; subject: string; email: string; expiresAt: number; }
export interface SessionStore {
  get(key: string): Promise<StoredSession | undefined>;
  put(key: string, value: StoredSession): Promise<void>;
  take(key: string): Promise<StoredSession | undefined>;
}
type VerifyGoogle = (credential: string, nonce: string) => Promise<{ subject: string; email: string }>;
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const sessionCookie = "__Host-buchunt-session";
const loginCookie = "__Host-buchunt-login";
const cookie = (name: string, token: string, age: number) =>
  `${name}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
const now = () => Math.floor(Date.now() / 1000);
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
async function sessionKey(kind: string, token: string) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return `${kind}:${Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function createAdminHandler(config: Config, store: SessionStore, verifyGoogle?: VerifyGoogle) {
  const allowed = new Set(config.adminEmails.map(email => email.trim().toLowerCase()).filter(Boolean));
  const google = new OAuth2Client(config.clientId);
  const verify: VerifyGoogle = verifyGoogle ?? (async (credential, nonce) => {
    try {
      // Google's library validates Google's signature, issuer, audience and expiry.
      const ticket = await google.verifyIdToken({ idToken: credential, audience: config.clientId });
      const payload = ticket.getPayload() as (ReturnType<typeof ticket.getPayload> & { nonce?: string });
      if (!payload?.sub || !payload.email || payload.email_verified !== true || payload.nonce !== nonce ||
          (payload.azp && payload.azp !== config.clientId)) throw new Error("Invalid identity");
      return { subject: payload.sub, email: payload.email.toLowerCase() };
    } catch {
      throw new HttpError(401, "Google sign-in could not be verified. Please try again.");
    }
  });
  return async (event: ApiEvent) => {
    const headers: Record<string, string> = {
      "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff",
    };
    const reply = (statusCode: number, value: unknown, cookies: string[] = []) =>
      ({ statusCode, headers, cookies, body: JSON.stringify(value) });
    try {
      if (!config.clientId || !config.origin) throw new HttpError(503, "Google sign-in is not configured.");
      const method = event.requestContext.http.method;
      const path = event.rawPath;
      const requestHeaders = Object.fromEntries(Object.entries(event.headers).map(([key, value]) => [key.toLowerCase(), value]));
      const rawCookies = event.cookies ?? (requestHeaders.cookie ? requestHeaders.cookie.split(/;\s*/) : []);
      const readCookie = (name: string) => {
        const matches = rawCookies.filter(value => value.startsWith(`${name}=`));
        const value = matches.length === 1 ? matches[0].slice(name.length + 1) : "";
        return /^[a-f0-9]{64}$/.test(value) ? value : "";
      };
      if (method !== "GET" && requestHeaders.origin !== config.origin) throw new HttpError(403, "Request origin denied.");
      if (path === "/api/auth/config" && method === "GET") {
        const nonce = randomToken();
        await store.put(await sessionKey("login", nonce), { kind: "login", subject: "", email: "", expiresAt: now() + 300 });
        return reply(200, { clientId: config.clientId, nonce }, [cookie(loginCookie, nonce, 300)]);
      }
      if (path === "/api/auth/login" && method === "POST") {
        if (!requestHeaders["content-type"]?.toLowerCase().startsWith("application/json") ||
            !event.body || event.body.length > 16384 || event.isBase64Encoded) throw new HttpError(400, "A Google sign-in credential is required.");
        let credentials;
        try { credentials = JSON.parse(event.body) as { credential?: unknown }; }
        catch { throw new HttpError(400, "Invalid JSON request."); }
        if (!credentials || typeof credentials.credential !== "string" || !credentials.credential) throw new HttpError(400, "A Google sign-in credential is required.");
        const nonce = readCookie(loginCookie);
        if (!nonce) throw new HttpError(401, "Start Google sign-in again.");
        // Delete atomically: each browser-bound Google nonce can be used only once.
        const pending = await store.take(await sessionKey("login", nonce));
        if (!pending || pending.kind !== "login" || pending.expiresAt <= now()) throw new HttpError(401, "Start Google sign-in again.");
        const identity = await verify(credentials.credential, nonce);
        const previous = readCookie(sessionCookie);
        if (previous) await store.take(await sessionKey("session", previous));
        const token = randomToken();
        const session: StoredSession = { kind: "session", ...identity, expiresAt: now() + 3600 };
        await store.put(await sessionKey("session", token), session);
        const user = { subject: session.subject, email: session.email, expiresAt: session.expiresAt,
          role: allowed.has(session.email.toLowerCase()) ? "administrator" : "user" };
        return reply(200, { user }, [cookie(sessionCookie, token, 3600), cookie(loginCookie, "", 0)]);
      }
      // All signed-in users may inspect and end their own session.
      const token = readCookie(sessionCookie);
      if (!token) throw new HttpError(401, "Sign-in required.");
      const key = await sessionKey("session", token);
      const session = await store.get(key);
      if (!session || session.kind !== "session" || session.expiresAt <= now()) throw new HttpError(401, "Session expired. Sign in again.");
      const isAdministrator = allowed.has(session.email.toLowerCase());
      const identity = { subject: session.subject, email: session.email, expiresAt: session.expiresAt };
      if (path === "/api/auth/logout" && method === "POST") {
        await store.take(key);
        return reply(200, { signedOut: true }, [cookie(sessionCookie, "", 0)]);
      }
      if (path === "/api/auth/session" && method === "GET") {
        return reply(200, { user: { ...identity, role: isAdministrator ? "administrator" : "user" } });
      }
      // Every current and future /api/admin route must check the server-derived role.
      if (path === "/api/admin" || path.startsWith("/api/admin/")) {
        if (!isAdministrator) throw new HttpError(403, "Administrator access required.");
        if (path === "/api/admin/capabilities" && method === "GET") {
          return reply(200, { administrator: identity, capabilities: ["administrative.access"] });
        }
      }
      return reply(404, { error: "Capability not found." });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 503;
      const message = error instanceof HttpError ? error.message : "Sign-in is temporarily unavailable.";
      return reply(status, { error: message }, status === 401 ? [cookie(sessionCookie, "", 0), cookie(loginCookie, "", 0)] : []);
    }
  };
}

const dynamo = new DynamoDBClient({});
function dynamoStore(table: string): SessionStore {
  const decode = (item: Record<string, { S?: string; N?: string }> | undefined): StoredSession | undefined => {
    if (!item) return undefined;
    return JSON.parse(item.data.S ?? "null") as StoredSession | undefined;
  };
  return {
    async get(key) {
      const result = await dynamo.send(new GetItemCommand({ TableName: table, Key: { id: { S: key } }, ConsistentRead: true }));
      return decode(result.Item);
    },
    async put(key, value) {
      await dynamo.send(new PutItemCommand({ TableName: table, Item: {
        id: { S: key }, data: { S: JSON.stringify(value) }, expiresAt: { N: String(value.expiresAt) },
      } }));
    },
    async take(key) {
      const result = await dynamo.send(new DeleteItemCommand({ TableName: table, Key: { id: { S: key } }, ReturnValues: "ALL_OLD" }));
      return decode(result.Attributes);
    },
  };
}
export async function handler(event: ApiEvent) {
  const env = (globalThis as typeof globalThis & { process: { env: Record<string, string | undefined> } }).process.env;
  const { GOOGLE_CLIENT_ID: clientId, ADMIN_ORIGIN: origin, ADMIN_EMAILS: emails, ADMIN_SESSION_TABLE: table } = env;
  if (!clientId || !origin || !table) return {
    statusCode: 503, headers: { "cache-control": "no-store" }, body: '{"error":"Google sign-in is not configured."}',
  };
  return createAdminHandler({ clientId, origin, adminEmails: (emails ?? "").split(",") }, dynamoStore(table))(event);
}
