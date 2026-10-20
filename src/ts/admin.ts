interface GoogleIdentity {
  accounts: { id: {
    initialize(options: { client_id: string; nonce: string; auto_select: boolean; callback: (result: { credential: string }) => void }): void;
    renderButton(element: HTMLElement, options: { type: string; theme: string; size: string }): void;
    disableAutoSelect(): void;
  } };
}
const loginPanel = document.getElementById("admin-login") as HTMLElement;
const googleButton = document.getElementById("google-sign-in") as HTMLElement;
const adminPanel = document.getElementById("admin-panel") as HTMLElement;
const userPanel = document.getElementById("user-panel") as HTMLElement;
const signedInPanel = document.getElementById("signed-in") as HTMLElement;
const adminLink = document.getElementById("administration-link");
const isAdminPage = document.body.dataset.page === "admin";
const statusText = document.getElementById("admin-status") as HTMLElement;
const identity = document.getElementById("admin-identity") as HTMLElement;
const signOut = document.getElementById("sign-out") as HTMLButtonElement;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let google: GoogleIdentity;

function signedOut(message: string): void {
  clearTimeout(expiryTimer);
  loginPanel.hidden = false;
  adminPanel.hidden = true;
  userPanel.hidden = true;
  signedInPanel.hidden = true;
  if (adminLink) adminLink.hidden = true;
  identity.textContent = "";
  statusText.textContent = message;
}
async function request(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
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
  const isAdministrator = data.user.role === "administrator";
  if (isAdministrator && isAdminPage) await request("/api/admin/capabilities");
  loginPanel.hidden = true;
  signedInPanel.hidden = false;
  adminPanel.hidden = !isAdministrator;
  userPanel.hidden = isAdministrator;
  if (adminLink) adminLink.hidden = !isAdministrator;
  identity.textContent = `Signed in as ${data.user.email}.`;
  statusText.textContent = isAdministrator ? "Signed in with administrator access." :
    (isAdminPage ? "Signed in. This account does not have administrator access." : "Signed in.");
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => {
    signedOut("Session expired. Sign in again.");
    void prepareGoogle().catch(showError);
  }, Math.max(0, data.user.expiresAt * 1000 - Date.now()));
}
function showError(error: unknown): void {
  statusText.textContent = error instanceof Error ? error.message : "Unable to complete Google sign-in. Reload to try again.";
}
async function prepareGoogle(): Promise<void> {
  await loadGoogle();
  const config = await request("/api/auth/config");
  google.accounts.id.initialize({
    client_id: config.clientId, nonce: config.nonce, auto_select: false,
    callback: result => {
      statusText.textContent = "Verifying Google sign-in…";
      void request("/api/auth/login", { credential: result.credential })
        .then(showSession)
        .catch(async error => {
          signedOut(error instanceof Error ? error.message : "Google sign-in failed.");
          await prepareGoogle();
        }).catch(showError);
    },
  });
  googleButton.replaceChildren();
  google.accounts.id.renderButton(googleButton, { type: "standard", theme: "outline", size: "large" });
}
signOut.addEventListener("click", async () => {
  signOut.disabled = true;
  try {
    await request("/api/auth/logout", {});
    google?.accounts.id.disableAutoSelect();
    signedOut("Signed out of BucHunt.");
    await prepareGoogle();
  } catch (error) {
    showError(error);
    if (!loginPanel.hidden) await prepareGoogle().catch(showError);
  }
  finally { signOut.disabled = false; }
});
async function initialize(): Promise<void> {
  try {
    await showSession();
    return;
  } catch {
    signedOut("Sign in with your Google account.");
  }
  await prepareGoogle();
}
async function loadGoogle(): Promise<void> {
  const existingGoogle = (window as Window & { google?: GoogleIdentity }).google;
  if (existingGoogle) {
    google = existingGoogle;
    return;
  }
  if (google) return;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google sign-in could not load. Reload to try again."));
    document.head.append(script);
  });
  google = (window as Window & { google?: GoogleIdentity }).google as GoogleIdentity;
}
void initialize().catch(showError);
export {};
