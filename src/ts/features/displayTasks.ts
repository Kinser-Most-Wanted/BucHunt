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
      renderButton(
        element: HTMLElement,
        options: { theme: string; size: string; text: string },
      ): void;
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

function decodeGoogleCredential(token: string): PlayerIdentity | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(base64), (character) =>
      character.charCodeAt(0),
    );
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as {
      email?: unknown;
      email_verified?: unknown;
    };
    if (typeof claims.email !== "string" || claims.email_verified !== true) {
      return null;
    }
    return { email: claims.email, provider: "google", idToken: token };
  } catch {
    return null;
  }
}

function storedIdentity(): PlayerIdentity | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(PLAYER_SESSION_KEY) ?? "null",
    ) as Partial<PlayerIdentity> | null;
    if (
      value?.provider === "google" &&
      typeof value.email === "string" &&
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
  const signIn = root.querySelector<HTMLElement>(
    '[data-testid="google-sign-in"]',
  );
  const signOut = root.querySelector<HTMLButtonElement>(
    '[data-testid="player-sign-out"]',
  );
  const account = root.querySelector<HTMLElement>(
    '[data-testid="player-account"]',
  );
  if (!status || !providerStatus || !list || !signIn || !signOut || !account) return;

  const clientId =
    window.BUCHUNT_GOOGLE_CLIENT_ID ?? root.dataset.googleClientId ?? "";
  let identity: PlayerIdentity | null = null;

  const showSignedOut = (message: string): void => {
    identity = null;
    signIn.hidden = false;
    signOut.hidden = true;
    account.hidden = true;
    list.replaceChildren();
    status.textContent = message;
  };

  const loadHunts = async (signedIn: PlayerIdentity): Promise<void> => {
    identity = signedIn;
    signIn.hidden = true;
    signOut.hidden = false;
    account.hidden = false;
    account.textContent = `Signed in as ${signedIn.email} with Google.`;
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

  if (!clientId || clientId === GOOGLE_CLIENT_ID_PLACEHOLDER) {
    showSignedOut("No tasks loaded.");
    providerStatus.hidden = false;
    providerStatus.textContent =
      "Google Sign-In needs an OAuth client ID before players can sign in.";
  } else {
    providerStatus.hidden = true;
    const configureGoogle = (): void => {
      if (!window.google || !signIn.isConnected) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          const player = decodeGoogleCredential(response.credential);
          if (!player) {
            showSignedOut("Google did not return a verified email address.");
            return;
          }
          try {
            sessionStorage.setItem(PLAYER_SESSION_KEY, JSON.stringify(player));
          } catch {
            showSignedOut("This browser could not keep the player session.");
            return;
          }
          void loadHunts(player);
        },
      });
      window.google.accounts.id.renderButton(signIn, {
        theme: "outline",
        size: "large",
        text: "signin_with",
      });
      if (!identity) status.textContent = "Sign in with Google to see your active Hunts.";
    };

    configureGoogle();
    if (!window.google) {
      document
        .getElementById("google-identity-script")
        ?.addEventListener("load", configureGoogle, { once: true });
      status.textContent = "Loading Google Sign-In…";
    }
  }

  const previousIdentity = storedIdentity();
  if (previousIdentity && clientId && clientId !== GOOGLE_CLIENT_ID_PLACEHOLDER) {
    void loadHunts(previousIdentity);
  }

  signOut.addEventListener("click", () => {
    try {
      sessionStorage.removeItem(PLAYER_SESSION_KEY);
    } catch {
      // The visible state still signs out for this page view.
    }
    window.google?.accounts.id.disableAutoSelect();
    showSignedOut("Sign in with Google to see your active Hunts.");
  });
}

