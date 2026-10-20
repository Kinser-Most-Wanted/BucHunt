import type { HuntRepository } from "../foundation/contracts.js";
import type { PlayerHunt, PlayerIdentity } from "../foundation/types.js";

const PLAYER_SESSION_KEY = "buchunt.player-session";
const PLAYER_PROFILE_KEY_PREFIX = "buchunt.player-profile.";
const PLAYER_HUNTS_KEY_PREFIX = "buchunt.player-hunts.";
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

function storedHuntIds(accountId: string): string[] {
  try {
    const value = JSON.parse(
      localStorage.getItem(`${PLAYER_HUNTS_KEY_PREFIX}${accountId}`) ?? "[]",
    ) as unknown;
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function saveHuntId(accountId: string, huntId: string): void {
  const ids = storedHuntIds(accountId);
  if (!ids.includes(huntId)) ids.push(huntId);
  localStorage.setItem(
    `${PLAYER_HUNTS_KEY_PREFIX}${accountId}`,
    JSON.stringify(ids),
  );
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
    document.createTextNode(`Location: ${latitude}, ${longitude} � `),
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
  const account = root.querySelector<HTMLElement>(
    '[data-testid="player-account"]',
  );
  const displayName = root.querySelector<HTMLElement>(
    '[data-testid="player-display-name"]',
  );
  const emailDetails = root.querySelector<HTMLElement>(
    '[data-testid="player-google-email"]',
  );
  const email = root.querySelector<HTMLOutputElement>(
    '[data-testid="player-email"]',
  );
  const emailToggle = root.querySelector<HTMLButtonElement>(
    '[data-testid="email-toggle"]',
  );
  const copyEmail = root.querySelector<HTMLButtonElement>(
    '[data-testid="copy-email"]',
  );
  const accountIdDetails = root.querySelector<HTMLElement>(
    '[data-testid="player-google-account-id"]',
  );
  const accountIdToggle = root.querySelector<HTMLButtonElement>(
    '[data-testid="account-id-toggle"]',
  );
  const accountIdValue = root.querySelector<HTMLOutputElement>(
    '[data-testid="account-id-value"]',
  );
  const copyAccountId = root.querySelector<HTMLButtonElement>(
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
    status.textContent = "Loading your Hunts�w^~)�v";
    const ids = storedHuntIds(signedIn.accountId);
    const hunts = await Promise.all(
      ids.map(async (id) => {
        try {
          const result = await repository.getPlayerHunt(id);
          return result.ok ? result.value : null;
        } catch {
          return null;
        }
      }),
    );
    const available = hunts.filter((hunt): hunt is PlayerHunt => hunt !== null);
    renderHunts(list, available);
    status.textContent = available.length
      ? `${available.length} saved Hunt${available.length === 1 ? "" : "s"}.`
      : "You have no saved Hunts yet. Join one with its ID below.";
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
    window.location.assign("./index.html");
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
  const huntInput = root.querySelector<HTMLInputElement>('[name="huntId"]');
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
      huntStatus.textContent = "Loading Hunt�w^~)�v";
      const result = await repository.getPlayerHunt(huntId);
      if (requestId !== huntRequest) return;
      if (!result.ok) {
        huntStatus.textContent = result.message;
        return;
      }
      const identity = storedIdentity();
      if (identity) {
        try {
          saveHuntId(identity.accountId, huntId);
          const saved = await Promise.all(
            storedHuntIds(identity.accountId).map(async (id) => {
              const savedResult = await repository.getPlayerHunt(id);
              return savedResult.ok ? savedResult.value : null;
            }),
          );
          renderHunts(
            list,
            saved.filter((hunt): hunt is PlayerHunt => hunt !== null),
          );
          const savedCount = storedHuntIds(identity.accountId).length;
          status.textContent = `${savedCount} saved Hunt${savedCount === 1 ? "" : "s"}.`;
        } catch {
          huntStatus.textContent =
            "Hunt opened, but this browser could not save it to your profile.";
        }
      }
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
              const response = await fetch(
                `/api/player/hunts/${encodeURIComponent(huntId)}/tasks/${encodeURIComponent(task.id)}/answer`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ answer: answer.value }),
                },
              );
              const payload = await response.json();
              if (!response.ok || !payload.ok) {
                message.textContent =
                  payload.message ?? "Answer could not be submitted.";
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
    huntForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void loadHunt(huntInput.value.trim());
    });
    list.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "button[data-hunt-id]",
      );
      if (button) void loadHunt(button.dataset.huntId ?? "");
    });
    const selectedHunt = new URLSearchParams(location.search).get("huntId");
    if (selectedHunt) huntInput.value = selectedHunt;
  }

  signOut.addEventListener("click", () => {
    try {
      sessionStorage.removeItem(PLAYER_SESSION_KEY);
    } catch {
      // The visible state still signs out for this page view.
    }
    pendingIdentity = null;
    void fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" })
      .catch(() => undefined)
      .finally(() => window.location.assign("./index.html"));
  });
}
