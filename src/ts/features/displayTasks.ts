import type { HuntRepository } from "../foundation/contracts.js";
import type { PlayerHunt, PlayerIdentity } from "../foundation/types.js";

const PLAYER_SESSION_KEY = "buchunt.player-session";
const PLAYER_PROFILE_KEY_PREFIX = "buchunt.player-profile.";
function storedDisplayName(accountId: string): string | null {
  try {
    const value = localStorage
      .getItem(`${PLAYER_PROFILE_KEY_PREFIX}${accountId}`)
      ?.trim();
    return value || null;
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

function taskLocationElement(
  location: PlayerHunt["tasks"][number]["location"],
): HTMLParagraphElement | null {
  if (!location) return null;
  const latitude = location.latitude.toFixed(6);
  const longitude = location.longitude.toFixed(6);
  const details = document.createElement("p");
  details.className = "task-location";
  details.append(
    document.createTextNode(`Location: ${latitude}, ${longitude} \u00b7 `),
  );
  const mapLink = document.createElement("a");
  mapLink.href = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=18/${latitude}/${longitude}`;
  mapLink.target = "_blank";
  mapLink.rel = "noopener noreferrer";
  mapLink.textContent = "Open map";
  details.append(mapLink);
  return details;
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
    const open = document.createElement("button");
    open.type = "button";
    open.dataset.huntId = hunt.id;
    open.textContent = "Open Hunt";
    const tasks = document.createElement("ul");
    tasks.setAttribute("aria-label", `${hunt.name} tasks`);
    for (const task of hunt.tasks) {
      const taskItem = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = task.displayLabel;
      const completion = document.createElement("span");
      completion.className = "task-completion";
      completion.textContent = task.completed ? "Completed" : "Not completed";
      taskItem.append(label);
      const location = taskLocationElement(task.location);
      if (location) taskItem.append(location);
      taskItem.append(completion);
      tasks.append(taskItem);
    }
    item.append(heading, description, open, tasks);
    list.append(item);
  }
}

export function mountDisplayTasks(
  root: HTMLElement,
  repository: HuntRepository,
): void {
  root.dataset.feature = "displayTasks";
  const heading = root.querySelector<HTMLElement>(
    '[data-testid="player-heading"]',
  );
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
  const findAccountElement = <T extends Element>(selector: string): T | null =>
    document.querySelector<T>(selector) ?? root.querySelector<T>(selector);
  const account = findAccountElement<HTMLDetailsElement>(
    '[data-testid="player-account-menu"]',
  );
  const displayName = findAccountElement<HTMLElement>(
    '[data-testid="player-display-name"]',
  );
  const emailDetails = findAccountElement<HTMLElement>(
    '[data-testid="player-google-email"]',
  );
  const email = findAccountElement<HTMLOutputElement>(
    '[data-testid="player-email"]',
  );
  const emailToggle = findAccountElement<HTMLButtonElement>(
    '[data-testid="email-toggle"]',
  );
  const copyEmail = findAccountElement<HTMLButtonElement>(
    '[data-testid="copy-email"]',
  );
  const accountIdDetails = findAccountElement<HTMLElement>(
    '[data-testid="player-google-account-id"]',
  );
  const accountIdToggle = findAccountElement<HTMLButtonElement>(
    '[data-testid="account-id-toggle"]',
  );
  const accountIdValue = findAccountElement<HTMLOutputElement>(
    '[data-testid="account-id-value"]',
  );
  const copyAccountId = findAccountElement<HTMLButtonElement>(
    '[data-testid="copy-account-id"]',
  );
  const nameForm = root.querySelector<HTMLFormElement>(
    '[data-testid="player-name-form"]',
  );
  const nameInput = root.querySelector<HTMLInputElement>(
    '[data-testid="player-display-name-input"]',
  );
  const huntLookup = root.querySelector<HTMLElement>(
    '[data-testid="player-hunt-lookup"]',
  );
  if (
    !heading ||
    !status ||
    !providerStatus ||
    !list ||
    !googleSignIn ||
    !signOut ||
    !account ||
    !displayName ||
    !emailDetails ||
    !email ||
    !emailToggle ||
    !copyEmail ||
    !accountIdDetails ||
    !accountIdToggle ||
    !accountIdValue ||
    !copyAccountId ||
    !nameForm ||
    !nameInput ||
    !huntLookup
  )
    return;

  const googleButtonHost = root.querySelector<HTMLElement>(
    '[data-testid="google-sign-in-host"]',
  );

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
    account.open = false;
    emailDetails.hidden = true;
    email.hidden = true;
    emailToggle.hidden = false;
    emailToggle.textContent = "Show Google account email";
    emailToggle.setAttribute("aria-expanded", "false");
    copyEmail.hidden = true;
    accountIdDetails.hidden = true;
    accountIdValue.hidden = true;
    accountIdToggle.hidden = false;
    accountIdToggle.textContent = "Show Google account ID";
    accountIdToggle.setAttribute("aria-expanded", "false");
    copyAccountId.hidden = true;
    accountIdToggle.setAttribute("aria-expanded", "false");
    nameForm.hidden = true;
    huntLookup.hidden = true;
    heading.textContent = "Sign in to see active Hunts";
    list.replaceChildren();
    status.textContent = message;
  };

  const loadHunts = async (
    signedIn: PlayerIdentity,
    name: string,
  ): Promise<void> => {
    setGoogleSignInEnabled(false);
    providerStatus.hidden = true;
    nameForm.hidden = true;
    heading.textContent = "Your Hunts";
    signOut.hidden = false;
    account.hidden = false;
    displayName.textContent = name;
    email.textContent = signedIn.email;
    emailDetails.hidden = false;
    email.hidden = true;
    emailToggle.hidden = false;
    emailToggle.textContent = "Show Google account email";
    emailToggle.setAttribute("aria-expanded", "false");
    copyEmail.hidden = true;
    accountIdValue.textContent = signedIn.accountId;
    accountIdDetails.hidden = false;
    accountIdValue.hidden = true;
    accountIdToggle.hidden = false;
    accountIdToggle.textContent = "Show Google account ID";
    accountIdToggle.setAttribute("aria-expanded", "false");
    copyAccountId.hidden = true;
    list.replaceChildren();
    huntLookup.hidden = false;
    status.textContent = "Loading your hunts...";
    const result = await repository.listActiveHunts(signedIn);
    if (!result.ok) {
      status.textContent = result.message;
      if (result.code === "unauthorized") void preparePlayerSignIn();
      return;
    }
    renderHunts(list, result.value);
    status.textContent = result.value.length
      ? `${result.value.length} saved Hunt${result.value.length === 1 ? "" : "s"}.`
      : "You have no saved hunts yet. Join one with its access code below.";
  };

  const preparePlayerSignIn = async (): Promise<void> => {
    setGoogleSignInEnabled(false);
    providerStatus.hidden = false;
    providerStatus.textContent = "Returning to BucHunt sign-in...";
    try {
      // Clear any cookie-backed login so the shared home page presents its
      // single Google sign-in flow instead of redirecting back to this page.
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok && response.status !== 401)
        throw new Error("The current sign-in could not be refreshed.");
      sessionStorage.removeItem(PLAYER_SESSION_KEY);
      window.location.assign("./index.html");
    } catch {
      providerStatus.textContent =
        "Could not return to sign-in. Check your connection and try again.";
      setGoogleSignInEnabled(true);
    }
  };
  let pendingIdentity: PlayerIdentity | null = null;

  const requestDisplayName = (signedIn: PlayerIdentity): void => {
    pendingIdentity = signedIn;
    setGoogleSignInEnabled(false);
    account.hidden = true;
    emailDetails.hidden = true;
    accountIdDetails.hidden = true;
    heading.textContent = "Set up your player profile";
    nameForm.hidden = false;
    huntLookup.hidden = true;
    signOut.hidden = false;
    nameInput.value = "";
    nameInput.focus();
    status.textContent = "Choose a display name for your player profile.";
  };

  nameForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const signedIn = pendingIdentity;
    const name = nameInput.value.trim();
    if (!signedIn || !name) return;
    try {
      localStorage.setItem(
        `${PLAYER_PROFILE_KEY_PREFIX}${signedIn.accountId}`,
        name,
      );
    } catch {
      providerStatus.hidden = false;
      providerStatus.textContent =
        "This browser could not save your display name. Enable browser storage and try again.";
      return;
    }
    pendingIdentity = null;
    providerStatus.hidden = true;
    void loadHunts(signedIn, name);
  });

  const toggleSensitiveValue = (
    value: HTMLOutputElement,
    toggle: HTMLButtonElement,
    copyButton: HTMLButtonElement,
    label: string,
  ): void => {
    const reveal = value.hidden;
    value.hidden = !reveal;
    copyButton.hidden = !reveal;
    toggle.textContent = reveal
      ? `Hide Google account ${label}`
      : `Show Google account ${label}`;
    toggle.setAttribute("aria-expanded", String(reveal));
  };

  const copySensitiveValue = async (
    value: HTMLOutputElement,
    label: string,
  ): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value.textContent ?? "");
      providerStatus.hidden = false;
      providerStatus.textContent = `Google account ${label} copied.`;
    } catch {
      providerStatus.hidden = false;
      providerStatus.textContent = `Could not copy the Google account ${label}. Check clipboard permissions and try again.`;
    }
  };

  emailToggle.addEventListener("click", () => {
    toggleSensitiveValue(email, emailToggle, copyEmail, "email");
  });
  accountIdToggle.addEventListener("click", () => {
    toggleSensitiveValue(accountIdValue, accountIdToggle, copyAccountId, "ID");
  });
  copyEmail.addEventListener("click", () => {
    void copySensitiveValue(email, "email");
  });
  copyAccountId.addEventListener("click", () => {
    void copySensitiveValue(accountIdValue, "ID");
  });

  googleSignIn.addEventListener("click", () => {
    void preparePlayerSignIn();
  });

  providerStatus.hidden = true;
  const previousIdentity = storedIdentity();
  if (previousIdentity) {
    const savedName = storedDisplayName(previousIdentity.accountId);
    if (savedName) void loadHunts(previousIdentity, savedName);
    else requestDisplayName(previousIdentity);
  } else showSignedOut("No tasks loaded.");

  const huntForm = root.querySelector<HTMLFormElement>(
    '[data-testid="player-hunt-form"]',
  );
  const huntInput = root.querySelector<HTMLInputElement>('[name="accessCode"]');
  const huntName = root.querySelector<HTMLElement>(
    '[data-testid="player-hunt-name"]',
  );
  const huntTasks = root.querySelector<HTMLUListElement>(
    '[data-testid="player-task-list"]',
  );
  const huntStatus = root.querySelector<HTMLElement>(
    '[data-testid="player-hunt-lookup-status"]',
  );
  if (huntForm && huntInput && huntName && huntTasks && huntStatus) {
    let huntRequest = 0;
    const loadHunt = async (huntId: string): Promise<void> => {
      const requestId = ++huntRequest;
      huntTasks.replaceChildren();
      huntStatus.textContent = "Loading hunt...";
      const identity = storedIdentity();
      if (!identity) {
        huntStatus.textContent = "Sign in with Google first.";
        return;
      }
      const result = await repository.getAccountHunt(huntId, identity);
      if (requestId !== huntRequest) return;
      if (!result.ok) {
        huntStatus.textContent = result.message;
        if (result.code === "unauthorized") void preparePlayerSignIn();
        return;
      }
      huntId = result.value.id;
      await loadHunts(
        identity,
        storedDisplayName(identity.accountId) ?? identity.email,
      );
      if (requestId !== huntRequest) return;
      huntName.textContent = result.value.name;
      huntStatus.textContent = result.value.tasks.length
        ? `${result.value.tasks.length} tasks loaded.`
        : "This Hunt has no tasks yet.";
      for (const task of result.value.tasks) {
        const item = document.createElement("li");
        item.dataset.testid = "player-task";
        const label = document.createElement("strong");
        label.textContent = task.displayLabel;
        const state = document.createElement("p");
        state.textContent = task.completed ? "Completed" : "Incomplete";
        item.append(label, state);
        if (task.description) {
          const description = document.createElement("p");
          description.textContent = task.description;
          item.append(description);
        }
        const location = taskLocationElement(task.location);
        if (location) item.append(location);
        if (!task.completed) {
          const answerForm = document.createElement("form");
          const answerLabel = document.createElement("label");
          answerLabel.textContent = `Answer for ${task.displayLabel}`;
          const answer = document.createElement("input");
          answer.required = true;
          answerLabel.append(answer);
          const submit = document.createElement("button");
          submit.type = "submit";
          submit.textContent = "Submit answer";
          const message = document.createElement("p");
          message.setAttribute("role", "status");
          answerForm.append(answerLabel, submit, message);
          answerForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            submit.disabled = true;
            try {
              const result = await repository.answerAccountTask(
                huntId,
                task.id,
                answer.value,
                identity,
              );
              if (!result.ok) {
                message.textContent = result.message;
                if (result.code === "unauthorized") void preparePlayerSignIn();
                return;
              }
              await loadHunt(huntId);
            } catch {
              message.textContent = "The answer service could not be reached.";
            } finally {
              submit.disabled = false;
            }
          });
          item.append(answerForm);
        }
        huntTasks.append(item);
      }
    };
    huntForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const identity = storedIdentity();
      if (!identity) {
        huntStatus.textContent = "Sign in with Google first.";
        return;
      }
      const button = huntForm.querySelector<HTMLButtonElement>(
        'button[type="submit"], button',
      );
      if (button) button.disabled = true;
      const requestId = ++huntRequest;
      huntStatus.textContent = "Joining hunt...";
      try {
        const result = await repository.joinHunt(
          huntInput.value.trim(),
          identity,
        );
        if (requestId !== huntRequest) return;
        if (!result.ok) {
          huntStatus.textContent = result.message;
          if (result.code === "unauthorized") void preparePlayerSignIn();
          return;
        }
        await loadHunt(result.value.huntId);
      } finally {
        if (button) button.disabled = false;
      }
    });
    list.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "button[data-hunt-id]",
      );
      if (button) void loadHunt(button.dataset.huntId ?? "");
    });
    const sharedCode = new URLSearchParams(location.search).get("accessCode");
    if (sharedCode) huntInput.value = sharedCode;
    const selectedHunt = new URLSearchParams(location.search).get("huntId");
    if (selectedHunt && previousIdentity) void loadHunt(selectedHunt);
  }

  signOut.addEventListener("click", () => {
    try {
      sessionStorage.removeItem(PLAYER_SESSION_KEY);
    } catch {
      // The visible state still signs out for this page view.
    }
    pendingIdentity = null;
    void fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    })
      .catch(() => undefined)
      .finally(() => window.location.assign("./index.html"));
  });
}

