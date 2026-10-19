import type { HuntRepository } from "../foundation/contracts.js";
import type { PlayerHunt, PlayerIdentity } from "../foundation/types.js";

const PLAYER_SESSION_KEY = "buchunt.player-session";
const GOOGLE_CLIENT_ID_PLACEHOLDER = "YOUR_GOOGLE_CLIENT_ID";

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
      renderButton(parent: HTMLElement, options: { theme: "outline"; size: "large"; shape: "pill"; text: "signin_with"; width: number }): void;
      disableAutoSelect(): void;
    };
  };
}


declare global {
  interface Window {
    google?: GoogleIdentityApi;
    BUCHUNT_GOOGLE_CLIENT_ID?: string;
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


function storedIdentity(): PlayerIdentity | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(PLAYER_SESSION_KEY) ?? "null",
    ) as Partial<PlayerIdentity> | null;
    if (
      value?.provider === "google" &&
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





export function mountDisplayTasks(
  root: HTMLElement,
  repository: HuntRepository,
): void {
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
    !signOut ||
    !account
  ) return;

  const googleClientId =
    window.BUCHUNT_GOOGLE_CLIENT_ID ?? root.dataset.googleClientId ?? "";
  let googleInitialized = false;
  let googleButtonRendered = false;
  const googleButtonHost = root.querySelector<HTMLElement>(`[data-testid="google-sign-in-host"]`);

  const setGoogleSignInEnabled = (enabled: boolean): void => {
    if (googleButtonHost) {
      googleButtonHost.hidden = !enabled;
      googleButtonHost.inert = !enabled;
    }
    googleSignIn.disabled = !enabled;
  };

  const showSignedOut = (message: string): void => {
    setGoogleSignInEnabled(true);
    signOut.hidden = true;
    account.hidden = true;
    list.replaceChildren();
    status.textContent = message;
  };

  const loadHunts = async (signedIn: PlayerIdentity): Promise<void> => {
    setGoogleSignInEnabled(false);
    signOut.hidden = false;
    account.hidden = false;
    account.textContent = `Signed in as ${signedIn.email} with Google. Account ID: ${signedIn.accountId}.`;
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
    if (googleButtonHost && !googleButtonRendered) {
      googleButtonHost.replaceChildren();
      window.google.accounts.id.renderButton(googleButtonHost, {
        theme: "outline", size: "large", shape: "pill", text: "signin_with", width: 280,
      });
      googleButtonRendered = true;
    }
  };

  configureGoogle();
  document
    .getElementById("google-identity-script")
    ?.addEventListener("load", configureGoogle, { once: true });

  googleSignIn.addEventListener("click", () => {
    providerStatus.hidden = false;
    providerStatus.textContent = googleClientId && googleClientId !== GOOGLE_CLIENT_ID_PLACEHOLDER
      ? "Google sign-in is still loading. Try again in a moment."
      : "Google sign-in needs a Google OAuth client ID.";
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
    showSignedOut("Choose Google to sign in and see your active Hunts.");
  });
}

