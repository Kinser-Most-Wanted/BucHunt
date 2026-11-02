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
const googleButton = document.getElementById(
  "google-sign-in",
) as HTMLElement | null;
const adminWorkspace = document.getElementById(
  "admin-workspace",
) as HTMLElement | null;
const adminDenied = document.getElementById(
  "admin-denied",
) as HTMLElement | null;
const adminAccessPanel = document.getElementById(
  "admin-access",
) as HTMLElement | null;
const accountMenu = document.getElementById(
  "admin-account-menu",
) as HTMLDetailsElement | null;
const accountDisplayName = document.querySelector<HTMLElement>(
  '[data-testid="admin-display-name"]',
);
const accountNameEditToggle = document.querySelector<HTMLButtonElement>(
  '[data-testid="admin-change-display-name"]',
);
const accountNameForm = document.querySelector<HTMLFormElement>(
  '[data-testid="admin-account-name-form"]',
);
const accountNameInput = document.querySelector<HTMLInputElement>(
  '[data-testid="admin-account-name-input"]',
);
const accountStatus = document.querySelector<HTMLElement>(
  '[data-testid="admin-account-status"]',
);
let adminAccountNickname = "";
let adminAccountRoleLabel = "Player";
const isHomePage = document.body.dataset.page === "home";
const isAdminPage = document.body.dataset.page === "admin";
const foundationFeaturesReady = isAdminPage
  ? new Promise<void>((resolve) => {
      if (document.documentElement.dataset.buchuntFeaturesReady === "true") {
        resolve();
        return;
      }
      document.addEventListener("buchunt:features-ready", () => resolve(), {
        once: true,
      });
    })
  : Promise.resolve();
const statusText = document.getElementById("admin-status") as HTMLElement;
const signOut = document.getElementById("sign-out") as HTMLButtonElement | null;
const homeSignInLink = document.getElementById(
  "home-sign-in-link",
) as HTMLElement | null;
const PLAYER_SESSION_KEY = "buchunt.player-session";
const PLAYER_PROFILE_KEY_PREFIX = "buchunt.player-profile.";
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let google: GoogleIdentity | undefined;
let verifiedCredential: string | undefined;
function warmGoogleSignIn() {
  return Promise.allSettled([loadGoogle(), request("/api/auth/config")]);
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
  try {
    sessionStorage.removeItem(PLAYER_SESSION_KEY);
  } catch {
    /* Storage may be unavailable. */
  }
}
function rememberPlayerSession(
  user: { subject?: unknown; email?: unknown },
  credential?: string,
): void {
  if (typeof user.subject !== "string" || typeof user.email !== "string")
    return;
  try {
    if (!credential) {
      const saved = JSON.parse(
        sessionStorage.getItem(PLAYER_SESSION_KEY) ?? "null",
      ) as {
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
      )
        return;
      return;
    }
    sessionStorage.setItem(
      PLAYER_SESSION_KEY,
      JSON.stringify({
        provider: "google",
        accountId: user.subject,
        email: user.email,
        idToken: credential,
      }),
    );
  } catch {
    /* The server session remains authoritative if browser storage is unavailable. */
  }
}
async function loadAccountNickname(user: {
  subject?: unknown;
  email?: unknown;
  role?: unknown;
}): Promise<void> {
  if (typeof user.subject !== "string" || typeof user.email !== "string")
    return;
  let identity: { accountId?: unknown; idToken?: unknown } | null = null;
  try {
    identity = JSON.parse(
      sessionStorage.getItem(PLAYER_SESSION_KEY) ?? "null",
    ) as { accountId?: unknown; idToken?: unknown } | null;
  } catch {
    return;
  }
  if (
    identity?.accountId !== user.subject ||
    typeof identity.idToken !== "string" ||
    identity.idToken === "verified-server-session"
  )
    return;
  const headers = {
    Authorization: `Bearer ${identity.idToken}`,
    "Content-Type": "application/json",
  };
  try {
    const response = await fetch("/api/player/account/profile", {
      headers,
      credentials: "omit",
      cache: "no-store",
    });
    if (!response.ok) return;
    const result = (await response.json()) as {
      ok?: boolean;
      value?: { displayName?: unknown };
    };
    let nickname =
      typeof result.value?.displayName === "string"
        ? result.value.displayName.trim()
        : "";
    if (!nickname) {
      try {
        nickname =
          localStorage
            .getItem(`${PLAYER_PROFILE_KEY_PREFIX}${user.subject}`)
            ?.trim() ?? "";
      } catch {
        nickname = "";
      }
      if (nickname) {
        const saved = await fetch("/api/player/account/profile", {
          method: "PUT",
          headers,
          credentials: "omit",
          cache: "no-store",
          body: JSON.stringify({ displayName: nickname }),
        });
        if (!saved.ok) return;
      }
    }
    if (!nickname || !accountDisplayName) return;
    try {
      localStorage.setItem(
        `${PLAYER_PROFILE_KEY_PREFIX}${user.subject}`,
        nickname,
      );
    } catch {
      // The account profile is authoritative; browser storage is only a cache.
    }
    adminAccountNickname = nickname;
    if (accountNameInput) accountNameInput.value = nickname;
    accountDisplayName.textContent = `${nickname} (${adminAccountRoleLabel})`;
  } catch {
    // Keep the cached nickname visible when the profile endpoint is unavailable.
  }
}
function setAccountMenu(user: {
  subject?: unknown;
  email?: unknown;
  role?: unknown;
}): void {
  if (!accountMenu) return;
  const subject = typeof user.subject === "string" ? user.subject : "";
  const email = typeof user.email === "string" ? user.email : "";
  adminAccountRoleLabel = user.role === "administrator" ? "Admin" : "Player";
  let nickname = email.split("@")[0] || "Google account";
  try {
    const savedName = localStorage
      .getItem(`${PLAYER_PROFILE_KEY_PREFIX}${subject}`)
      ?.trim();
    if (savedName) nickname = savedName;
  } catch {
    // Use the Google account name if browser storage is unavailable.
  }
  adminAccountNickname = nickname;
  if (accountDisplayName) {
    accountDisplayName.textContent = `${nickname} (${adminAccountRoleLabel})`;
  }
  if (accountNameInput) accountNameInput.value = nickname;
  accountMenu.hidden = false;
  accountMenu.open = false;
  if (accountNameEditToggle)
    accountNameEditToggle.setAttribute("aria-expanded", "false");
  if (accountNameForm) accountNameForm.hidden = true;
  if (accountStatus) {
    accountStatus.hidden = true;
    accountStatus.textContent = "";
  }
}
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
  if (accountNameForm) accountNameForm.hidden = true;
  if (accountNameEditToggle)
    accountNameEditToggle.setAttribute("aria-expanded", "false");
  if (accountStatus) {
    accountStatus.hidden = true;
    accountStatus.textContent = "";
  }
  if (homeSignInLink) homeSignInLink.hidden = false;
  statusText.textContent = message;
}
accountNameEditToggle?.addEventListener("click", () => {
  if (!accountNameForm || !accountNameInput) return;
  const opening = accountNameForm.hidden;
  accountNameForm.hidden = !opening;
  accountNameEditToggle.setAttribute("aria-expanded", String(opening));
  if (accountStatus) accountStatus.hidden = true;
  if (opening) {
    accountNameInput.value = adminAccountNickname;
    accountNameInput.focus();
  }
});
accountNameForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = accountNameInput?.value.trim() ?? "";
  if (!name || !accountNameInput) return;
  let identity: { accountId?: unknown; idToken?: unknown } | null = null;
  try {
    identity = JSON.parse(
      sessionStorage.getItem(PLAYER_SESSION_KEY) ?? "null",
    ) as { accountId?: unknown; idToken?: unknown } | null;
  } catch {
    if (accountStatus) {
      accountStatus.textContent = "Sign in again to change your display name.";
      accountStatus.hidden = false;
    }
    return;
  }
  if (
    !identity ||
    typeof identity.accountId !== "string" ||
    typeof identity.idToken !== "string" ||
    identity.idToken === "verified-server-session"
  ) {
    if (accountStatus) {
      accountStatus.textContent = "Sign in again to change your display name.";
      accountStatus.hidden = false;
    }
    return;
  }
  const verifiedIdentity = identity as { accountId: string; idToken: string };
  const submitButton = accountNameForm.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  );
  if (submitButton) submitButton.disabled = true;
  if (accountStatus) accountStatus.hidden = true;
  void fetch("/api/player/account/profile", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${verifiedIdentity.idToken}`,
      "Content-Type": "application/json",
    },
    credentials: "omit",
    cache: "no-store",
    body: JSON.stringify({ displayName: name }),
  })
    .then(async (response) => {
      const result = (await response.json()) as {
        ok?: boolean;
        message?: string;
        value?: { displayName?: unknown };
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.message ?? "Could not save your display name.");
      }
      adminAccountNickname =
        typeof result.value?.displayName === "string"
          ? result.value.displayName.trim()
          : name;
      accountNameInput.value = adminAccountNickname;
      if (accountDisplayName) {
        accountDisplayName.textContent = `${adminAccountNickname} (${adminAccountRoleLabel})`;
      }
      try {
        localStorage.setItem(
          `${PLAYER_PROFILE_KEY_PREFIX}${verifiedIdentity.accountId}`,
          adminAccountNickname,
        );
      } catch {
        // The account profile is authoritative; browser storage is only a cache.
      }
      if (accountStatus) {
        accountStatus.textContent = "Display name updated.";
        accountStatus.hidden = false;
      }
    })
    .catch((error: unknown) => {
      if (accountStatus) {
        accountStatus.textContent =
          error instanceof Error
            ? error.message
            : "Could not save your display name. Try again.";
        accountStatus.hidden = false;
      }
    })
    .finally(() => {
      if (submitButton) submitButton.disabled = false;
    });
});
class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
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
    throw new ApiError(data.error ?? "Request failed.", response.status);
  }
  return data;
}
async function showSession(): Promise<void> {
  const data = await request("/api/auth/session");
  const user = data.user as {
    subject?: unknown;
    email?: unknown;
    role?: unknown;
    expiresAt?: unknown;
  };
  let isAdministrator = user.role === "administrator";
  if (isAdminPage) {
    try {
      await request("/api/admin/capabilities");
      isAdministrator = true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        isAdministrator = false;
      } else {
        throw error;
      }
    }
  }
  rememberPlayerSession(user, verifiedCredential);
  verifiedCredential = undefined;
  if (isHomePage) {
    window.location.replace("./player.html");
    return;
  }
  if (loginPanel) loginPanel.hidden = true;
  if (googleButton) googleButton.hidden = true;
  if (adminAccessPanel) adminAccessPanel.hidden = isAdministrator;
  if (accountMenu)
    setAccountMenu({
      ...user,
      role: isAdministrator ? "administrator" : "user",
    });
  if (accountMenu) {
    void loadAccountNickname({
      ...user,
      role: isAdministrator ? "administrator" : "user",
    });
  }
  if (isAdminPage && isAdministrator) await foundationFeaturesReady;
  if (adminWorkspace) adminWorkspace.hidden = !isAdministrator;
  if (adminDenied) adminDenied.hidden = isAdministrator;
  if (homeSignInLink) homeSignInLink.hidden = true;
  statusText.textContent = isAdministrator
    ? "Administrator access verified."
    : "";
  clearTimeout(expiryTimer);
  if (typeof user.expiresAt === "number") {
    expiryTimer = setTimeout(
      () => {
        signedOut("Session expired. Sign in again.");
        if (isHomePage) void prepareGoogle().catch(showError);
      },
      Math.max(0, user.expiresAt * 1000 - Date.now()),
    );
  }
}
function showError(error: unknown): void {
  statusText.textContent =
    error instanceof Error
      ? error.message
      : "Unable to complete Google sign-in. Reload to try again.";
}
async function prepareGoogle(): Promise<void> {
  if (!isHomePage || !googleButton) return;
  const config = await getGoogleConfig();
  google?.accounts.id.initialize({
    client_id: config.clientId,
    nonce: config.nonce,
    auto_select: false,
    callback: (result) => {
      statusText.textContent = "Verifying Google sign-in…";
      void request("/api/auth/login", { credential: result.credential })
        .then(async () => {
          verifiedCredential = result.credential;
          await showSession();
        })
        .catch(async (error) => {
          signedOut(
            error instanceof Error ? error.message : "Google sign-in failed.",
          );
          await prepareGoogle();
        })
        .catch(showError);
    },
  });
  googleButton.replaceChildren();
  google?.accounts.id.renderButton(googleButton, {
    type: "standard",
    theme: "outline",
    size: "large",
    shape: "pill",
    text: "signin_with",
    width: 280,
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
  const existingGoogle = (window as Window & { google?: GoogleIdentity })
    .google;
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
    script.onerror = () =>
      reject(new Error("Google sign-in could not load. Reload to try again."));
    document.head.append(script);
  });
  google = (window as Window & { google?: GoogleIdentity }).google;
}
async function initialize(): Promise<void> {
  try {
    await showSession();
    return;
  } catch {
    signedOut(
      isHomePage ? "" : "Sign in from the BucHunt home page to continue.",
    );
  }
  if (isHomePage) await prepareGoogle();
}
void initialize().catch(showError);
export {};
