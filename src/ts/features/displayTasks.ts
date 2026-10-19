import type { HuntRepository } from "../foundation/contracts.js";
import type { PlayerHunt, PlayerIdentity } from "../foundation/types.js";

const PLAYER_SESSION_KEY = "buchunt.player-session";
const GOOGLE_CLIENT_ID_PLACEHOLDER = "YOUR_GOOGLE_CLIENT_ID";
const MICROSOFT_CLIENT_ID_PLACEHOLDER = "YOUR_MICROSOFT_CLIENT_ID";
const MICROSOFT_CALLBACK_TYPE = "buchunt-microsoft-login";

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdentityApi {
  accounts: {
    id: {
      initialize(options: {
        client_id: string;
        callback(response: GoogleCredentialResponse): void;
      }): void;
      prompt(): void;
      disableAutoSelect(): void;
    };
  };
}

interface MicrosoftCallback {
  type: typeof MICROSOFT_CALLBACK_TYPE;
  state: string;
  authorizationCode?: string;
  error?: string;
}

declare global {
  interface Window {
    google?: GoogleIdentityApi;
    BUCHUNT_GOOGLE_CLIENT_ID?: string;
    BUCHUNT_MICROSOFT_CLIENT_ID?: string;
  }
}

function decodeClaims(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0),
    );
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return typeof claims === "object" && claims !== null
      ? (claims as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function decodeGoogleCredential(
  token: string,
  expectedClientId: string,
): PlayerIdentity | null {
  const claims = decodeClaims(token);
  if (
    !claims ||
    claims.aud !== expectedClientId ||
    typeof claims.email !== "string" ||
    claims.email_verified !== true ||
    typeof claims.sub !== "string"
  ) {
    return null;
  }
  return {
    email: claims.email,
    accountId: claims.sub,
    provider: "google",
    idToken: token,
  };
}

function decodeMicrosoftCredential(
  token: string,
  expectedClientId: string,
  expectedNonce: string,
): PlayerIdentity | null {
  const claims = decodeClaims(token);
  if (
    !claims ||
    claims.aud !== expectedClientId ||
    claims.nonce !== expectedNonce
  ) {
    return null;
  }
  const email =
    typeof claims.email === "string"
      ? claims.email
      : typeof claims.preferred_username === "string"
        ? claims.preferred_username
        : null;
  const accountId =
    typeof claims.oid === "string" && typeof claims.tid === "string"
      ? `${claims.tid}:${claims.oid}`
      : typeof claims.sub === "string"
        ? claims.sub
        : null;
  if (!email || !accountId) return null;
  return { email, accountId, provider: "microsoft", idToken: token };
}

function storedIdentity(): PlayerIdentity | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(PLAYER_SESSION_KEY) ?? "null",
    ) as Partial<PlayerIdentity> | null;
    if (
      (value?.provider === "google" || value?.provider === "microsoft") &&
      typeof value.email === "string" &&
      typeof value.accountId === "string" &&
      typeof value.idToken === "string"
    ) {
      return value as PlayerIdentity;
    }
  } catch {
    // An absent or unreadable browser session is treated as signed out.
  }
  return null;
}

function renderHunts(list: HTMLUListElement, hunts: PlayerHunt[]): void {
  list.replaceChildren();
  for (const hunt of hunts) {
    const item = document.createElement("li");
    item.className = "player-hunt";
    const heading = document.createElement("h3");
    heading.textContent = hunt.name;
    const description = document.createElement("p");
    description.textContent = hunt.description;
    const tasks = document.createElement("ul");
    tasks.setAttribute("aria-label", `${hunt.name} tasks`);
    for (const task of hunt.tasks) {
      const taskItem = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = task.displayLabel;
      const completion = document.createElement("span");
      completion.className = "task-completion";
      completion.textContent = task.completed ? "Completed" : "Not completed";
      taskItem.append(label, completion);
      tasks.append(taskItem);
    }
    item.append(heading, description, tasks);
    list.append(item);
  }
}

function randomValue(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sendMicrosoftPopupResponse(): boolean {
  const response = new URLSearchParams(window.location.search);
  const authorizationCode = response.get("code");
  const state = response.get("state");
  const error = response.get("error_description") ?? response.get("error");
  if (!window.opener || (!authorizationCode && !error) || !state) return false;

  window.opener.postMessage(
    {
      type: MICROSOFT_CALLBACK_TYPE,
      state,
      ...(authorizationCode ? { authorizationCode } : {}),
      ...(error ? { error } : {}),
    } satisfies MicrosoftCallback,
    window.location.origin,
  );
  window.close();
  return true;
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function exchangeMicrosoftCode(
  authorizationCode: string,
  clientId: string,
  redirectUri: string,
  verifier: string,
): Promise<string> {
  const response = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "authorization_code",
        code: authorizationCode,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        scope: "openid profile email",
      }),
    },
  );
  const payload = (await response.json()) as {
    id_token?: unknown;
    error_description?: unknown;
  };
  if (!response.ok || typeof payload.id_token !== "string") {
    throw new Error(
      typeof payload.error_description === "string"
        ? payload.error_description
        : "Microsoft could not complete sign-in.",
    );
  }
  return payload.id_token;
}

export function mountDisplayTasks(
  root: HTMLElement,
  repository: HuntRepository,
): void {
  if (sendMicrosoftPopupResponse()) return;
  root.dataset.feature = "displayTasks";
  const status = root.querySelector<HTMLElement>(
    '[data-testid="player-task-status"]',
  );
  const providerStatus = root.querySelector<HTMLElement>(
    '[data-testid="player-provider-status"]',
  );
  const list = root.querySelector<HTMLUListElement>(
    '[data-testid="player-hunt-list"]',
  );
  const googleSignIn = root.querySelector<HTMLButtonElement>(
    '[data-testid="google-sign-in"]',
  );
  const microsoftSignIn = root.querySelector<HTMLButtonElement>(
    '[data-testid="microsoft-sign-in"]',
  );
  const signOut = root.querySelector<HTMLButtonElement>(
    '[data-testid="player-sign-out"]',
  );
  const account = root.querySelector<HTMLElement>(
    '[data-testid="player-account"]',
  );
  if (
    !status ||
    !providerStatus ||
    !list ||
    !googleSignIn ||
    !microsoftSignIn ||
    !signOut ||
    !account
  ) return;

  const googleClientId =
    window.BUCHUNT_GOOGLE_CLIENT_ID ?? root.dataset.googleClientId ?? "";
  const microsoftClientId =
    window.BUCHUNT_MICROSOFT_CLIENT_ID ?? root.dataset.microsoftClientId ?? "";
  let googleInitialized = false;

  const showSignedOut = (message: string): void => {
    signOut.hidden = true;
    account.hidden = true;
    list.replaceChildren();
    status.textContent = message;
  };

  const loadHunts = async (signedIn: PlayerIdentity): Promise<void> => {
    signOut.hidden = false;
    account.hidden = false;
    account.textContent = `Signed in as ${signedIn.email} with ${signedIn.provider === "google" ? "Google" : "Microsoft"}. Account ID: ${signedIn.accountId}.`;
    list.replaceChildren();
    status.textContent = "Loading your active Hunts…";
    try {
      const result = await repository.listActiveHunts(signedIn);
      if (!result.ok) {
        status.textContent = result.message;
        return;
      }
      renderHunts(list, result.value);
      status.textContent = result.value.length
        ? `${result.value.length} active Hunt${result.value.length === 1 ? "" : "s"} available.`
        : "No active Hunts are available for this account.";
    } catch {
      status.textContent = "Active Hunts could not be loaded. Try again later.";
    }
  };

  const acceptGoogleCredential = (response: GoogleCredentialResponse): void => {
    const player = decodeGoogleCredential(response.credential, googleClientId);
    if (!player) {
      showSignedOut("Google did not return a verified account ID and email.");
      return;
    }
    try {
      sessionStorage.setItem(PLAYER_SESSION_KEY, JSON.stringify(player));
    } catch {
      showSignedOut("This browser could not keep the player session.");
      return;
    }
    providerStatus.hidden = true;
    void loadHunts(player);
  };

  const configureGoogle = (): void => {
    if (googleInitialized || !window.google || !googleClientId ||
        googleClientId === GOOGLE_CLIENT_ID_PLACEHOLDER) return;
    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: acceptGoogleCredential,
    });
    googleInitialized = true;
  };

  configureGoogle();
  document
    .getElementById("google-identity-script")
    ?.addEventListener("load", configureGoogle, { once: true });

  googleSignIn.addEventListener("click", () => {
    if (!googleClientId || googleClientId === GOOGLE_CLIENT_ID_PLACEHOLDER) {
      providerStatus.hidden = false;
      providerStatus.textContent =
        "Google sign-in needs a Google OAuth client ID. Microsoft sign-in is available below when configured.";
      return;
    }
    if (!window.google) {
      providerStatus.hidden = false;
      providerStatus.textContent = "Google sign-in is still loading. Try again in a moment.";
      return;
    }
    configureGoogle();
    configureGoogle();
    if (googleInitialized) {
      window.google.accounts.id.prompt();
      providerStatus.hidden = true;
      status.textContent = "Complete sign-in in the Google prompt.";
    }
  });

  microsoftSignIn.addEventListener("click", async () => {
    if (
      !microsoftClientId ||
      microsoftClientId === MICROSOFT_CLIENT_ID_PLACEHOLDER
    ) {
      providerStatus.hidden = false;
      providerStatus.textContent =
        "Microsoft sign-in needs a Microsoft Entra application client ID.";
      return;
    }

    const popup = window.open(
      "about:blank",
      "buchunt-microsoft-login",
      "popup,width=500,height=650",
    );
    if (!popup) {
      providerStatus.hidden = false;
      providerStatus.textContent = "The Microsoft sign-in popup was blocked. Allow popups and try again.";
      return;
    }

    const state = randomValue();
    const nonce = randomValue();
    const verifier = randomValue();
    const callbackUrl = new URL(window.location.href);
    callbackUrl.hash = "";
    callbackUrl.search = "";
    const authorizeUrl = new URL(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
    authorizeUrl.search = new URLSearchParams({
      client_id: microsoftClientId,
      response_type: "code",
      response_mode: "query",
      scope: "openid profile email",
      redirect_uri: callbackUrl.toString(),
      state,
      nonce,
      code_challenge: await createCodeChallenge(verifier),
      code_challenge_method: "S256",
      prompt: "select_account",
    }).toString();

    providerStatus.hidden = true;
    status.textContent = "Complete sign-in in the Microsoft popup.";
    const onMessage = (event: MessageEvent<MicrosoftCallback>): void => {
      if (
        event.origin !== window.location.origin ||
        event.data?.type !== MICROSOFT_CALLBACK_TYPE ||
        event.data.state !== state
      ) return;
      window.removeEventListener("message", onMessage);
      if (!event.data.authorizationCode) {
        showSignedOut(event.data.error ?? "Microsoft sign-in was cancelled.");
        return;
      }
      void exchangeMicrosoftCode(
        event.data.authorizationCode,
        microsoftClientId,
        callbackUrl.toString(),
        verifier,
      )
        .then((credential) => {
          const player = decodeMicrosoftCredential(
            credential,
            microsoftClientId,
            nonce,
          );
          if (!player) {
            showSignedOut("Microsoft did not return a matching account ID and email.");
            return;
          }
          sessionStorage.setItem(PLAYER_SESSION_KEY, JSON.stringify(player));
          void loadHunts(player);
        })
        .catch((error: unknown) => {
          showSignedOut(
            error instanceof Error
              ? error.message
              : "Microsoft sign-in could not be completed.",
          );
        });
    };
    window.addEventListener("message", onMessage);
    popup.location.href = authorizeUrl.toString();
  });

  providerStatus.hidden = true;
  const previousIdentity = storedIdentity();
  if (previousIdentity) void loadHunts(previousIdentity);
  else showSignedOut("No tasks loaded.");

  signOut.addEventListener("click", () => {
    try {
      sessionStorage.removeItem(PLAYER_SESSION_KEY);
    } catch {
      // The visible state still signs out for this page view.
    }
    window.google?.accounts.id.disableAutoSelect();
    showSignedOut("Choose a provider to sign in and see your active Hunts.");
  });
}

