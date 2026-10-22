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
const adminWorkspace = document.getElementById("admin-workspace") as HTMLElement | null;
const adminDenied = document.getElementById("admin-denied") as HTMLElement | null;
const adminAccessPanel = document.getElementById("admin-access") as HTMLElement | null;
const accountMenu = document.getElementById("admin-account-menu") as HTMLDetailsElement | null;
const accountDisplayName = document.querySelector<HTMLElement>('[data-testid="admin-display-name"]');
const accountEmailDetails = document.querySelector<HTMLElement>('[data-testid="admin-google-email"]');
const accountEmail = document.querySelector<HTMLOutputElement>('[data-testid="admin-email-value"]');
const accountEmailToggle = document.querySelector<HTMLButtonElement>('[data-testid="admin-email-toggle"]');
const accountEmailCopy = document.querySelector<HTMLButtonElement>('[data-testid="admin-copy-email"]');
const accountIdDetails = document.querySelector<HTMLElement>('[data-testid="admin-google-account-id"]');
const accountId = document.querySelector<HTMLOutputElement>('[data-testid="admin-id-value"]');
const accountIdToggle = document.querySelector<HTMLButtonElement>('[data-testid="admin-id-toggle"]');
const accountIdCopy = document.querySelector<HTMLButtonElement>('[data-testid="admin-copy-id"]');
const accountStatus = document.querySelector<HTMLElement>('[data-testid="admin-account-status"]');
const isHomePage = document.body.dataset.page === "home";
const isAdminPage = document.body.dataset.page === "admin";
const statusText = document.getElementById("admin-status") as HTMLElement;
const signOut = document.getElementById("sign-out") as HTMLButtonElement | null;
const homeSignInLink = document.getElementById("home-sign-in-link") as HTMLElement | null;
const PLAYER_SESSION_KEY = "buchunt.player-session";
const PLAYER_PROFILE_KEY_PREFIX = "buchunt.player-profile.";
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let google: GoogleIdentity | undefined;
let verifiedCredential: string | undefined;
function warmGoogleSignIn() {
  return Promise.allSettled([
    loadGoogle(),
    request("/api/auth/config"),
  ]);
}
let homeGoogleWarmup = isHomePage ? warmGoogleSignIn() : undefined;
async function getGoogleConfig() {
  if (homeGoogleWarmup) {
    const warmup = homeGoogleWarmup;
    homeGoogleWarmup = undefined;
    const [scriptResult, configResult] = await warmup;
    if (scriptResult.status === "rejected") throw scriptResult.reason;
    if (configResult.status === "rejected") throw configResult.reason;
    return configResult.value;
  }
  const [, config] = await Promise.all([
    loadGoogle(),
    request("/api/auth/config"),
  ]);
  return config;
}

function clearPlayerSession(): void {
  try { sessionStorage.removeItem(PLAYER_SESSION_KEY); } catch { /* Storage may be unavailable. */ }
}
function rememberPlayerSession(user: { subject?: unknown; email?: unknown }, credential?: string): void {
  if (typeof user.subject !== "string" || typeof user.email !== "string") return;
  try {
    if (!credential) {
      const saved = JSON.parse(sessionStorage.getItem(PLAYER_SESSION_KEY) ?? "null") as {
        provider?: unknown;
        accountId?: unknown;
        email?: unknown;
        idToken?: unknown;
      } | null;
      if (
        saved?.provider === "google" &&
        saved.accountId === user.subject &&
        saved.email === user.email &&
        typeof saved.idToken === "string" &&
        saved.idToken !== "verified-server-session"
      ) return;
      return;
    }
    sessionStorage.setItem(PLAYER_SESSION_KEY, JSON.stringify({
      provider: "google",
      accountId: user.subject,
      email: user.email,
      idToken: credential,
    }));
  } catch { /* The server session remains authoritative if browser storage is unavailable. */ }
}
function setAccountMenu(user: { subject?: unknown; email?: unknown; role?: unknown }): void {
  if (!accountMenu) return;
  const subject = typeof user.subject === "string" ? user.subject : "";
  const email = typeof user.email === "string" ? user.email : "";
  let nickname = email.split("@")[0] || "Google account";
  try {
    const savedName = localStorage
      .getItem(`${PLAYER_PROFILE_KEY_PREFIX}${subject}`)
      ?.trim();
    if (savedName) nickname = savedName;
  } catch {
    // Use the Google account name if browser storage is unavailable.
  }
  if (accountDisplayName) {
    accountDisplayName.textContent = `${nickname}${user.role === "administrator" ? " (Admin)" : ""}`;
  }
  if (accountEmail) accountEmail.textContent = email;
  if (accountId) accountId.textContent = subject;
  if (accountMenu) {
    accountMenu.hidden = false;
    accountMenu.open = false;
  }
  if (accountEmailDetails) accountEmailDetails.hidden = false;
  if (accountEmail) accountEmail.hidden = true;
  if (accountEmailToggle) {
    accountEmailToggle.hidden = false;
    accountEmailToggle.textContent = "Show Google account email";
    accountEmailToggle.setAttribute("aria-expanded", "false");
  }
  if (accountEmailCopy) accountEmailCopy.hidden = true;
  if (accountIdDetails) accountIdDetails.hidden = false;
  if (accountId) accountId.hidden = true;
  if (accountIdToggle) {
    accountIdToggle.hidden = false;
    accountIdToggle.textContent = "Show Google account ID";
    accountIdToggle.setAttribute("aria-expanded", "false");
  }
  if (accountIdCopy) accountIdCopy.hidden = true;
  if (accountStatus) {
    accountStatus.hidden = true;
    accountStatus.textContent = "";
  }
}
function toggleAccountDetail(
  value: HTMLOutputElement | null,
  toggle: HTMLButtonElement | null,
  copy: HTMLButtonElement | null,
  label: string,
): void {
  if (!value || !toggle || !copy) return;
  value.hidden = !value.hidden;
  const revealed = !value.hidden;
  copy.hidden = !revealed;
  toggle.textContent = `${revealed ? "Hide" : "Show"} Google account ${label}`;
  toggle.setAttribute("aria-expanded", String(revealed));
}
function copyAccountDetail(
  value: HTMLOutputElement | null,
  label: string,
): void {
  if (!value || !accountStatus) return;
  void navigator.clipboard.writeText(value.textContent ?? "").then(() => {
    accountStatus.textContent = `Google account ${label} copied.`;
    accountStatus.hidden = false;
  }).catch(() => {
    accountStatus.textContent = `Could not copy the Google account ${label}.`;
    accountStatus.hidden = false;
  });
}
accountEmailToggle?.addEventListener("click", () =>
  toggleAccountDetail(accountEmail, accountEmailToggle, accountEmailCopy, "email"),
);
accountIdToggle?.addEventListener("click", () =>
  toggleAccountDetail(accountId, accountIdToggle, accountIdCopy, "ID"),
);
accountEmailCopy?.addEventListener("click", () => copyAccountDetail(accountEmail, "email"));
accountIdCopy?.addEventListener("click", () => copyAccountDetail(accountId, "ID"));
function signedOut(message: string): void {
  clearTimeout(expiryTimer);
  clearPlayerSession();
  if (loginPanel) loginPanel.hidden = false;
  if (googleButton) googleButton.hidden = !isHomePage;
  if (adminWorkspace) adminWorkspace.hidden = true;
  if (adminDenied) adminDenied.hidden = true;
  if (adminAccessPanel) adminAccessPanel.hidden = false;
  if (accountMenu) {
    accountMenu.hidden = true;
    accountMenu.open = false;
  }
  if (accountEmailDetails) accountEmailDetails.hidden = true;
  if (accountEmail) accountEmail.hidden = true;
  if (accountEmailToggle) {
    accountEmailToggle.hidden = false;
    accountEmailToggle.textContent = "Show Google account email";
    accountEmailToggle.setAttribute("aria-expanded", "false");
  }
  if (accountEmailCopy) accountEmailCopy.hidden = true;
  if (accountIdDetails) accountIdDetails.hidden = true;
  if (accountId) accountId.hidden = true;
  if (accountIdToggle) {
    accountIdToggle.hidden = false;
    accountIdToggle.textContent = "Show Google account ID";
    accountIdToggle.setAttribute("aria-expanded", "false");
  }
  if (accountIdCopy) accountIdCopy.hidden = true;
  if (accountStatus) {
    accountStatus.hidden = true;
    accountStatus.textContent = "";
  }
  if (homeSignInLink) homeSignInLink.hidden = false;
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
  if (isHomePage) {
    window.location.replace("./player.html");
    return;
  }
  if (isAdministrator && isAdminPage) await request("/api/admin/capabilities");
  if (loginPanel) loginPanel.hidden = true;
  if (googleButton) googleButton.hidden = true;
  if (adminAccessPanel) adminAccessPanel.hidden = isAdministrator;
  if (accountMenu) setAccountMenu(user);
  if (adminWorkspace) adminWorkspace.hidden = !isAdministrator;
  if (adminDenied) adminDenied.hidden = isAdministrator;
  if (homeSignInLink) homeSignInLink.hidden = true;
  statusText.textContent = isAdministrator
    ? "Administrator access verified."
    : "";
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
  const config = await getGoogleConfig();
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
signOut?.addEventListener("click", async () => {
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
    signedOut(isHomePage ? "" : "Sign in from the BucHunt home page to continue.");
  }
  if (isHomePage) await prepareGoogle();
}
void initialize().catch(showError);
export {};
