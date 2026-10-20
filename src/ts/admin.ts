interface GoogleIdentity {
  accounts: {
    id: {
      initialize(options: {
        client_id: string;
        nonce: string;
        auto_select: boolean;
        callback: (result: { credential: string }) => void;
      }): void;
      renderButton(
        element: HTMLElement,
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

const loginPanel = document.getElementById("admin-login") as HTMLElement | null;
const googleButton = document.getElementById("google-sign-in") as HTMLElement | null;
const adminPanel = document.getElementById("admin-panel") as HTMLElement | null;
const userPanel = document.getElementById("user-panel") as HTMLElement | null;
const signedInPanel = document.getElementById("signed-in") as HTMLElement | null;
const adminLink = document.getElementById("administration-link") as HTMLElement | null;
const adminHomeLink = document.getElementById("admin-home-link") as HTMLElement | null;
const homeRoleStatus = document.getElementById("home-role-status") as HTMLElement | null;
const isHomePage = document.body.dataset.page === "home";
const isAdminPage = document.body.dataset.page === "admin";
const statusText = document.getElementById("admin-status") as HTMLElement;
const identity = document.getElementById("admin-identity") as HTMLElement;
const signOut = document.getElementById("sign-out") as HTMLButtonElement;
const homeSignInLink = document.getElementById("home-sign-in-link") as HTMLElement | null;
const PLAYER_SESSION_KEY = "buchunt.player-session";
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let google: GoogleIdentity | undefined;
let verifiedCredential: string | undefined;

function clearPlayerSession(): void {
  try { sessionStorage.removeItem(PLAYER_SESSION_KEY); } catch { /* Storage may be unavailable. */ }
}
function rememberPlayerSession(user: { subject?: unknown; email?: unknown }, credential?: string): void {
  if (typeof user.subject !== "string" || typeof user.email !== "string") return;
  try {
    sessionStorage.setItem(PLAYER_SESSION_KEY, JSON.stringify({
      provider: "google",
      accountId: user.subject,
      email: user.email,
      idToken: credential ?? "verified-server-session",
    }));
  } catch { /* The server session remains authoritative if browser storage is unavailable. */ }
}
function signedOut(message: string): void {
  clearTimeout(expiryTimer);
  clearPlayerSession();
  if (loginPanel) loginPanel.hidden = !isHomePage;
  if (googleButton) googleButton.hidden = !isHomePage;
  if (adminPanel) adminPanel.hidden = true;
  if (userPanel) userPanel.hidden = true;
  if (signedInPanel) signedInPanel.hidden = true;
  if (adminLink) adminLink.hidden = true;
  if (adminHomeLink) adminHomeLink.hidden = true;
  if (homeSignInLink) homeSignInLink.hidden = false;
  identity.textContent = "";
  statusText.textContent = message;
}
async function request(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) signedOut(data.error ?? "Sign in required.");
    throw new Error(data.error ?? "Request failed.");
  }
  return data;
}
async function showSession(): Promise<void> {
  const data = await request("/api/auth/session");
  const user = data.user as { subject?: unknown; email?: unknown; role?: unknown; expiresAt?: unknown };
  const isAdministrator = user.role === "administrator";
  rememberPlayerSession(user, verifiedCredential);
  verifiedCredential = undefined;
  if (isAdministrator && isAdminPage) await request("/api/admin/capabilities");
  if (loginPanel) loginPanel.hidden = true;
  if (googleButton) googleButton.hidden = true;
  if (signedInPanel) signedInPanel.hidden = false;
  if (adminPanel) adminPanel.hidden = !isAdministrator;
  if (userPanel) userPanel.hidden = isAdministrator;
  if (adminLink) adminLink.hidden = !isAdministrator;
  if (adminHomeLink) adminHomeLink.hidden = !isAdministrator;
  if (homeSignInLink) homeSignInLink.hidden = true;
  identity.textContent = `Signed in as ${typeof user.email === "string" ? user.email : "your Google account"}.`;
  if (homeRoleStatus) homeRoleStatus.textContent = isAdministrator
    ? "Your account has administrator access and player access."
    : "Your player profile is ready.";
  statusText.textContent = isAdministrator
    ? "Signed in with administrator access."
    : (isAdminPage ? "Signed in. This account does not have administrator access." : "Signed in.");
  clearTimeout(expiryTimer);
  if (typeof user.expiresAt === "number") {
    expiryTimer = setTimeout(() => {
      signedOut("Session expired. Sign in again.");
      if (isHomePage) void prepareGoogle().catch(showError);
    }, Math.max(0, user.expiresAt * 1000 - Date.now()));
  }
}
function showError(error: unknown): void {
  statusText.textContent = error instanceof Error ? error.message : "Unable to complete Google sign-in. Reload to try again.";
}
async function prepareGoogle(): Promise<void> {
  if (!isHomePage || !googleButton) return;
  await loadGoogle();
  const config = await request("/api/auth/config");
  google?.accounts.id.initialize({
    client_id: config.clientId,
    nonce: config.nonce,
    auto_select: false,
    callback: result => {
      statusText.textContent = "Verifying Google sign-in…";
      void request("/api/auth/login", { credential: result.credential })
        .then(async () => {
          verifiedCredential = result.credential;
          await showSession();
        })
        .catch(async error => {
          signedOut(error instanceof Error ? error.message : "Google sign-in failed.");
          await prepareGoogle();
        })
        .catch(showError);
    },
  });
  googleButton.replaceChildren();
  google?.accounts.id.renderButton(googleButton, {
    type: "standard", theme: "outline", size: "large",
    shape: "pill", text: "signin_with", width: 280,
  });
}
signOut.addEventListener("click", async () => {
  signOut.disabled = true;
  try {
    await request("/api/auth/logout", {});
    google?.accounts.id.disableAutoSelect();
    signedOut("Signed out of BucHunt.");
    if (isHomePage) await prepareGoogle();
  } catch (error) {
    showError(error);
  } finally {
    signOut.disabled = false;
  }
});
async function loadGoogle(): Promise<void> {
  const existingGoogle = (window as Window & { google?: GoogleIdentity }).google;
  if (existingGoogle) { google = existingGoogle; return; }
  if (google) return;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google sign-in could not load. Reload to try again."));
    document.head.append(script);
  });
  google = (window as Window & { google?: GoogleIdentity }).google;
}
async function initialize(): Promise<void> {
  try {
    await showSession();
    return;
  } catch {
    signedOut(isHomePage ? "Sign in with Google to continue." : "Sign in from the BucHunt home page to continue.");
  }
  if (isHomePage) await prepareGoogle();
}
void initialize().catch(showError);
export {};
