const loginForm = document.getElementById("admin-login") as HTMLFormElement;
const adminPanel = document.getElementById("admin-panel") as HTMLElement;
const statusText = document.getElementById("admin-status") as HTMLElement;
const identity = document.getElementById("admin-identity") as HTMLElement;
const signIn = document.getElementById("sign-in") as HTMLButtonElement;
const signOut = document.getElementById("sign-out") as HTMLButtonElement;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;

function signedOut(message: string): void {
  clearTimeout(expiryTimer);
  loginForm.hidden = false;
  adminPanel.hidden = true;
  identity.textContent = "";
  statusText.textContent = message;
}

async function request(path: string, body?: unknown) {
  const response = await fetch(`/api/admin/${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) signedOut(data.error ?? "Sign in required.");
    throw new Error(data.error ?? "Administrative request failed.");
  }
  return data;
}

async function showCapabilities(): Promise<void> {
  const data = await request("capabilities");
  loginForm.hidden = true;
  adminPanel.hidden = false;
  identity.textContent = `Signed in as ${data.administrator.username}.`;
  statusText.textContent = "Administrative access granted.";
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => signedOut("Session expired. Sign in again."),
    Math.max(0, data.administrator.expiresAt * 1000 - Date.now()));
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  signIn.disabled = true;
  statusText.textContent = "Signing in…";
  const fields = new FormData(loginForm);
  try {
    await request("login", { username: fields.get("username"), password: fields.get("password") });
    loginForm.reset();
    await showCapabilities();
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message : "Unable to sign in. Try again.";
  } finally {
    (document.getElementById("password") as HTMLInputElement).value = "";
    signIn.disabled = false;
  }
});

signOut.addEventListener("click", async () => {
  signOut.disabled = true;
  try {
    await request("logout", {});
    signedOut("Signed out.");
  } catch (error) {
    statusText.textContent = error instanceof Error ? error.message : "Unable to sign out. Try again.";
  } finally { signOut.disabled = false; }
});

void showCapabilities().catch(error => {
  signedOut(error instanceof Error ? error.message : "Unable to check session. Try again.");
});

export {};
