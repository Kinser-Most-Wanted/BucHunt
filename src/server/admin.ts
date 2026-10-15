interface ApiEvent {
  rawPath: string;
  headers: Record<string, string | undefined>;
  cookies?: string[];
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string } };
}

interface Config {
  region: string;
  poolId: string;
  clientId: string;
  origin: string;
}

type Transport = (operation: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const cookieName = "__Host-buchunt-admin";
const cookie = (token: string, age: number) =>
  `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;

export function createAdminHandler(config: Config, transport?: Transport) {
  const call: Transport = transport ?? (async (operation, body) => {
    const response = await fetch(`https://cognito-idp.${config.region}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": `AWSCognitoIdentityProviderService.${operation}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      const failure = await response.json() as { __type?: string };
      if (response.status === 429 || failure.__type?.endsWith("TooManyRequestsException")) {
        throw new HttpError(429, "Too many requests. Try again later.");
      }
      if (response.status >= 500) throw new HttpError(503, "Authentication is temporarily unavailable.");
      throw new HttpError(401, "Administrative authentication failed.");
    }
    return await response.json() as Record<string, unknown>;
  });

  async function authenticate(token: string) {
    if (!token || token.length > 3800 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
      throw new HttpError(401, "Administrator sign-in required.");
    }
    // GetUser validates the signature, expiry and revocation with Cognito on every request.
    // Claims are trusted only after this succeeds; decoding alone is not authentication.
    const user = await call("GetUser", { AccessToken: token });
    let claims: Record<string, unknown>;
    try {
      const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      claims = JSON.parse(atob(payload)) as Record<string, unknown>;
    } catch {
      throw new HttpError(401, "Administrator sign-in required.");
    }
    if (claims.iss !== `https://cognito-idp.${config.region}.amazonaws.com/${config.poolId}` ||
        claims.client_id !== config.clientId || claims.token_use !== "access" ||
        typeof claims.exp !== "number" || claims.exp <= Date.now() / 1000 ||
        typeof claims.sub !== "string" || claims.username !== user.Username) {
      throw new HttpError(401, "Administrator sign-in required.");
    }
    if (!Array.isArray(claims["cognito:groups"]) || !claims["cognito:groups"].includes("Administrators")) {
      throw new HttpError(403, "Administrator access required.");
    }
    return { username: user.Username, subject: claims.sub, expiresAt: claims.exp };
  }

  return async (event: ApiEvent) => {
    const headers = {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    };
    const reply = (statusCode: number, value: unknown, cookies: string[] = []) =>
      ({ statusCode, headers, cookies, body: JSON.stringify(value) });
    try {
      const method = event.requestContext.http.method;
      const path = event.rawPath;
      const requestHeaders = Object.fromEntries(Object.entries(event.headers).map(([key, value]) => [key.toLowerCase(), value]));
      if (method !== "GET" && requestHeaders.origin !== config.origin) {
        throw new HttpError(403, "Request origin denied.");
      }
      if (path === "/api/admin/login" && method === "POST") {
        if (!requestHeaders["content-type"]?.toLowerCase().startsWith("application/json") ||
            !event.body || event.body.length > 8192 || event.isBase64Encoded) {
          throw new HttpError(400, "A JSON username and password are required.");
        }
        let credentials;
        try { credentials = JSON.parse(event.body) as { username?: unknown; password?: unknown }; }
        catch { throw new HttpError(400, "Invalid JSON request."); }
        if (!credentials || typeof credentials.username !== "string" ||
            !credentials.username.trim() || credentials.username.length > 128 ||
            typeof credentials.password !== "string" || !credentials.password || credentials.password.length > 256) {
          throw new HttpError(400, "A username and password are required.");
        }
        const result = await call("InitiateAuth", {
          AuthFlow: "USER_PASSWORD_AUTH", ClientId: config.clientId,
          AuthParameters: { USERNAME: credentials.username, PASSWORD: credentials.password },
        });
        const auth = result.AuthenticationResult as { AccessToken?: string } | undefined;
        if (!auth?.AccessToken) throw new HttpError(401, "Administrative authentication failed. Complete account provisioning first.");
        const administrator = await authenticate(auth.AccessToken);
        return reply(200, { administrator }, [cookie(auth.AccessToken, Math.min(3600, Math.floor(administrator.expiresAt - Date.now() / 1000)))]);
      }

      // Every other administrative route, including unknown/future routes, must pass this guard.
      const rawCookies = event.cookies ?? (requestHeaders.cookie ? requestHeaders.cookie.split(/;\s*/) : []);
      const tokens = rawCookies.filter(value => value.startsWith(`${cookieName}=`));
      if (tokens.length !== 1) throw new HttpError(401, "Administrator sign-in required.");
      const token = tokens[0].slice(cookieName.length + 1);
      const administrator = await authenticate(token);
      if (path === "/api/admin/logout" && method === "POST") {
        await call("GlobalSignOut", { AccessToken: token });
        return reply(200, { signedOut: true }, [cookie("", 0)]);
      }
      if (path === "/api/admin/session" && method === "GET") return reply(200, { administrator });
      if (path === "/api/admin/capabilities" && method === "GET") {
        return reply(200, { administrator, capabilities: ["administrative.access"] });
      }
      return reply(404, { error: "Administrative capability not found." });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 503;
      const message = error instanceof HttpError ? error.message : "Authentication is temporarily unavailable.";
      return reply(status, { error: message }, status === 401 ? [cookie("", 0)] : []);
    }
  };
}

export async function handler(event: ApiEvent) {
  const env = (globalThis as typeof globalThis & { process: { env: Record<string, string | undefined> } }).process.env;
  const { AWS_REGION: region, ADMIN_POOL_ID: poolId, ADMIN_CLIENT_ID: clientId, ADMIN_ORIGIN: origin } = env;
  if (!region || !poolId || !clientId || !origin) {
    return { statusCode: 503, headers: { "cache-control": "no-store" }, body: '{"error":"Authentication is not configured."}' };
  }
  return createAdminHandler({ region, poolId, clientId, origin })(event);
}
