import type { AuthenticationService } from "../foundation/contracts.js";
import type {
  AdminSession,
  GoogleAuthConfig,
  OperationResult,
} from "../foundation/types.js";

interface GoogleCredentialResponse {
  credential: string;
}
export interface GoogleIdentityApi {
  accounts: {
    id: {
      initialize(options: {
        client_id: string;
        nonce: string;
        auto_select: boolean;
        callback(response: GoogleCredentialResponse): void;
      }): void;
      renderButton(
        parent: HTMLElement,
        options: {
          type: "standard";
          theme: "outline";
          size: "large";
          shape: "pill";
          text: "signin_with";
          width: number;
        },
      ): void;
      disableAutoSelect(): void;
    };
  };
}
declare global {
  interface Window {
    google?: GoogleIdentityApi;
  }
}
let googleScript: Promise<void> | undefined;
export async function loadGoogleIdentity(): Promise<GoogleIdentityApi> {
  if (!window.google) {
    googleScript ??= new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () =>
        reject(new Error("Google sign-in could not load. Reload to try again."));
      document.head.append(script);
    }).catch((error: unknown) => {
      googleScript = undefined;
      throw error;
    });
    await googleScript;
  }
  if (!window.google) throw new Error("Google sign-in did not initialize.");
  return window.google;
}

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null
    ? (value as JsonObject)
    : null;
}
function failure<T>(message: string, code: "validation" | "unauthorized" | "network"): OperationResult<T> {
  return { ok: false, code, message };
}
type ApiResult =
  | { ok: true; response: Response; data: JsonObject }
  | { ok: false; error: OperationResult<never> };
async function api(path: string, body?: unknown): Promise<ApiResult> {
  try {
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = object(await response.json());
    if (!data) return { ok: false, error: failure("The sign-in service returned an invalid response.", "network") };
    return { ok: true, response, data };
  } catch {
    return { ok: false, error: failure("The sign-in service could not be reached. Try again.", "network") };
  }
}
function apiFailure<T>(response: Response, data: JsonObject): OperationResult<T> {
  const message =
    typeof data.error === "string" ? data.error : "Google sign-in failed.";
  const code =
    response.status === 401 || response.status === 403
      ? "unauthorized"
      : response.status >= 500
        ? "network"
        : "validation";
  return failure(message, code);
}
function parseSession(value: unknown): AdminSession | null {
  const payload = object(value);
  const user = object(payload?.user);
  if (
    !user ||
    typeof user.subject !== "string" ||
    typeof user.email !== "string" ||
    typeof user.expiresAt !== "number" ||
    !Number.isFinite(user.expiresAt) ||
    (user.role !== "administrator" && user.role !== "user")
  ) return null;
  return {
    subject: user.subject,
    email: user.email,
    expiresAt: user.expiresAt,
    role: user.role,
  };
}
export function createAuthenticationService(): AuthenticationService {
  return {
    async getGoogleConfig() {
      const result = await api("/api/auth/config");
      if (!result.ok) return result.error;
      if (!result.response.ok) return apiFailure(result.response, result.data);
      const config = result.data;
      if (
        typeof config.clientId !== "string" ||
        !config.clientId ||
        typeof config.nonce !== "string" ||
        !config.nonce
      ) return failure("Google sign-in is not configured correctly.", "network");
      return {
        ok: true,
        value: { clientId: config.clientId, nonce: config.nonce } satisfies GoogleAuthConfig,
      };
    },
    async signIn(credential) {
      const result = await api("/api/auth/login", { credential });
      if (!result.ok) return result.error;
      if (!result.response.ok) return apiFailure(result.response, result.data);
      const session = parseSession(result.data);
      return session
        ? { ok: true, value: session }
        : failure("The sign-in service returned an invalid session.", "network");
    },
    async getSession() {
      const result = await api("/api/auth/session");
      if (!result.ok) return result.error;
      if (!result.response.ok) return apiFailure(result.response, result.data);
      const session = parseSession(result.data);
      return session
        ? { ok: true, value: session }
        : failure("The sign-in service returned an invalid session.", "network");
    },
    async getCapabilities() {
      const result = await api("/api/admin/capabilities");
      if (!result.ok) return result.error;
      if (!result.response.ok) return apiFailure(result.response, result.data);
      return { ok: true, value: undefined };
    },
    async signOut() {
      const result = await api("/api/auth/logout", {});
      if (!result.ok) return result.error;
      if (result.response.status === 401) return { ok: true, value: undefined };
      if (!result.response.ok) return apiFailure(result.response, result.data);
      return { ok: true, value: undefined };
    },
  };
}
export function mountAdminAccess(
  root: HTMLElement,
  service: AuthenticationService,
): void {
  root.dataset.feature = "admin-access";
  const panel = root.querySelector<HTMLElement>("#admin-access");
  const loginPanel = root.querySelector<HTMLElement>("#admin-login");
  const buttonHost = root.querySelector<HTMLElement>("#google-sign-in");
  const adminPanel = root.querySelector<HTMLElement>("#admin-panel");
  const userPanel = root.querySelector<HTMLElement>("#user-panel");
  const signedInPanel = root.querySelector<HTMLElement>("#signed-in");
  const status = root.querySelector<HTMLElement>("#admin-status");
  const identity = root.querySelector<HTMLElement>("#admin-identity");
  const signOut = root.querySelector<HTMLButtonElement>("#sign-out");
  if (!panel || !loginPanel || !buttonHost || !adminPanel || !userPanel ||
      !signedInPanel || !status || !identity || !signOut) return;

  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let google: GoogleIdentityApi | undefined;
  const isAdminPage = document.body.dataset.page === "admin";
  const showSignedOut = (message: string): void => {
    clearTimeout(expiryTimer);
    loginPanel.hidden = false;
    adminPanel.hidden = true;
    userPanel.hidden = true;
    signedInPanel.hidden = true;
    identity.textContent = "";
    status.textContent = message;
  };
  const showSession = async (session: AdminSession): Promise<void> => {
    if (session.role === "administrator" && isAdminPage) {
      const capability = await service.getCapabilities();
      if (!capability.ok) {
        showSignedOut(capability.message);
        void prepareGoogle();
        return;
      }
    }
    loginPanel.hidden = true;
    signedInPanel.hidden = false;
    adminPanel.hidden = session.role !== "administrator";
    userPanel.hidden = session.role === "administrator";
    identity.textContent = `Signed in as ${session.email}.`;
    status.textContent = session.role === "administrator"
      ? "Signed in with administrator access."
      : isAdminPage
        ? "Signed in. This account does not have administrator access."
        : "Signed in.";
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => {
      showSignedOut("Session expired. Sign in again.");
      void prepareGoogle();
    }, Math.max(0, session.expiresAt * 1000 - Date.now()));
  };
  const handleCredential = async (credential: string): Promise<void> => {
    status.textContent = "Verifying Google sign-in…";
    const result = await service.signIn(credential);
    if (!result.ok) {
      showSignedOut(result.message);
      void prepareGoogle();
      return;
    }
    await showSession(result.value);
  };
  const prepareGoogle = async (): Promise<void> => {
    const config = await service.getGoogleConfig();
    if (!config.ok) {
      showSignedOut(config.message);
      return;
    }
    try {
      google = await loadGoogleIdentity();
      google.accounts.id.initialize({
        client_id: config.value.clientId,
        nonce: config.value.nonce,
        auto_select: false,
        callback: (response) => void handleCredential(response.credential),
      });
      buttonHost.replaceChildren();
      google.accounts.id.renderButton(buttonHost, {
        type: "standard",
        theme: "outline",
        size: "large",
        shape: "pill",
        text: "signin_with",
        width: 280,
      });
    } catch (error) {
      showSignedOut(error instanceof Error ? error.message : "Google sign-in could not load.");
    }
  };
  signOut.addEventListener("click", async () => {
    signOut.disabled = true;
    const result = await service.signOut();
    signOut.disabled = false;
    if (!result.ok) {
      status.textContent = result.message;
      return;
    }
    google?.accounts.id.disableAutoSelect();
    showSignedOut("Signed out of BucHunt.");
    void prepareGoogle();
  });
  void service.getSession().then((result) => {
    if (result.ok) return showSession(result.value);
    showSignedOut("Sign in with your Google account.");
    return prepareGoogle();
  }).catch(() => {
    showSignedOut("The sign-in service could not be reached. Try again.");
  });
}
