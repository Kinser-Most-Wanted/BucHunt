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

async function currentAccountRole(): Promise<"administrator" | "user" | null> {
  try {
    const response = await fetch("/api/admin/capabilities", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (response.ok) return "administrator";
    if (response.status === 403) return "user";
  } catch {
    // Do not mislabel an account when its administrator status is unavailable.
  }
  return null;
}

function taskLocationElement(
  location: PlayerHunt["tasks"][number]["location"],
  label: string,
): HTMLDivElement | null {
  if (!location) return null;
  const latitude = location.latitude;
  const longitude = location.longitude;
  const details = document.createElement("div");
  details.className = "task-location";
  const mapToggle = document.createElement("button");
  mapToggle.type = "button";
  mapToggle.textContent = `Show map for ${label}`;
  mapToggle.setAttribute("aria-expanded", "false");
  const map = document.createElement("iframe");
  map.className = "task-location-map";
  map.title = `Map for ${label}`;
  map.loading = "lazy";
  map.referrerPolicy = "no-referrer";
  map.hidden = true;
  mapToggle.addEventListener("click", () => {
    const showing = map.hidden;
    map.hidden = !showing;
    mapToggle.setAttribute("aria-expanded", String(showing));
    mapToggle.textContent = `${showing ? "Hide" : "Show"} map for ${label}`;
    if (showing && !map.src) {
      const padding = 0.005;
      const bounds = [
        longitude - padding,
        latitude - padding,
        longitude + padding,
        latitude + padding,
      ]
        .map((value) => value.toFixed(6))
        .join("%2C");
      map.src = `https://www.openstreetmap.org/export/embed.html?bbox=${bounds}&layer=mapnik&marker=${latitude}%2C${longitude}`;
    }
  });
  details.append(mapToggle, map);
  return details;
}

type HuntPhase = "active" | "future" | "past";

function huntPhase(hunt: PlayerHunt, now: number): HuntPhase {
  if (
    hunt.status === "archived" ||
    (hunt.endsAt !== null && Date.parse(hunt.endsAt) <= now)
  )
    return "past";
  return Date.parse(hunt.beginsAt) > now ? "future" : "active";
}

function durationText(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
  return days ? `${days}d ${clock}` : clock;
}

function countdownText(hunt: PlayerHunt, now: number): string {
  const phase = huntPhase(hunt, now);
  if (phase === "past") return "Hunt Ended";
  if (phase === "future")
    return `Starts in ${durationText(Date.parse(hunt.beginsAt) - now)}`;
  if (hunt.endsAt === null) return "No end time set";
  return `Time remaining ${durationText(Date.parse(hunt.endsAt) - now)}`;
}

function formattedTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function renderHunts(
  list: HTMLUListElement,
  hunts: PlayerHunt[],
  now: number,
): void {
  list.replaceChildren();
  for (const hunt of [...hunts].sort(
    (left, right) => Date.parse(left.beginsAt) - Date.parse(right.beginsAt),
  )) {
    const item = document.createElement("li");
    item.className = "player-hunt";
    const header = document.createElement("div");
    header.className = "player-hunt-card-heading";
    const heading = document.createElement("h3");
    heading.textContent = hunt.name;
    const phase = huntPhase(hunt, now);
    const badge = document.createElement("span");
    badge.className = `hunt-state-badge hunt-state-${phase}`;
    badge.textContent =
      phase === "past"
        ? "Hunt Ended"
        : phase === "future"
          ? "Future Hunt"
          : "Active";
    header.append(heading, badge);
    const description = document.createElement("p");
    description.textContent = hunt.description;
    const countdown = document.createElement("p");
    countdown.className = "player-hunt-countdown";
    countdown.dataset.huntCountdown = hunt.id;
    countdown.textContent = countdownText(hunt, now);
    const completed = hunt.tasks.filter((task) => task.completed).length;
    const progress = document.createElement("p");
    progress.className = "player-hunt-progress";
    progress.textContent = hunt.tasks.length
      ? `${completed} of ${hunt.tasks.length} tasks completed`
      : "No tasks added yet";
    item.dataset.huntId = hunt.id;
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.setAttribute("aria-label", `Open ${hunt.name}`);
    item.append(header, description, countdown, progress);
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
  const categories = root.querySelector<HTMLElement>(
    '[data-testid="player-hunt-categories"]',
  );
  const list = root.querySelector<HTMLUListElement>(
    '[data-testid="player-hunt-list"]',
  );
  const futureList = root.querySelector<HTMLUListElement>(
    '[data-testid="player-future-hunt-list"]',
  );
  const pastList = root.querySelector<HTMLUListElement>(
    '[data-testid="player-past-hunt-list"]',
  );
  const activeEmpty = root.querySelector<HTMLElement>(
    '[data-testid="active-hunts-empty"]',
  );
  const futureEmpty = root.querySelector<HTMLElement>(
    '[data-testid="future-hunts-empty"]',
  );
  const pastEmpty = root.querySelector<HTMLElement>(
    '[data-testid="past-hunts-empty"]',
  );
  const huntDetails = root.querySelector<HTMLDialogElement>(
    '[data-testid="player-hunt-details"]',
  );
  const googleSignIn = root.querySelector<HTMLButtonElement>(
    '[data-testid="google-sign-in"]',
  );
  const signOut =
    document.querySelector<HTMLButtonElement>(
      '[data-testid="player-sign-out"]',
    ) ??
    root.querySelector<HTMLButtonElement>('[data-testid="player-sign-out"]');
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
    !categories ||
    !list ||
    !futureList ||
    !pastList ||
    !activeEmpty ||
    !futureEmpty ||
    !pastEmpty ||
    !huntDetails ||
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
    categories.hidden = true;
    huntLookup.hidden = true;
    if (huntDetails.open) huntDetails.close();
    heading.textContent = "Sign in to see active Hunts";
    list.replaceChildren();
    futureList.replaceChildren();
    pastList.replaceChildren();
    status.textContent = message;
  };

  let displayedHunts: PlayerHunt[] = [];
  let categorySignature = "";
  let selectedHuntId: string | null = null;
  let reloadSelectedHunt: (() => void) | undefined;
  const renderCategories = (force = false): void => {
    const now = Date.now();
    const groups: Record<HuntPhase, PlayerHunt[]> = {
      active: [],
      future: [],
      past: [],
    };
    for (const hunt of displayedHunts) groups[huntPhase(hunt, now)].push(hunt);
    const signature = (Object.keys(groups) as HuntPhase[])
      .map(
        (phase) => `${phase}:${groups[phase].map((hunt) => hunt.id).join(",")}`,
      )
      .join("|");
    if (force || signature !== categorySignature) {
      const changed = Boolean(
        categorySignature && signature !== categorySignature,
      );
      categorySignature = signature;
      renderHunts(list, groups.active, now);
      renderHunts(futureList, groups.future, now);
      renderHunts(pastList, groups.past, now);
      activeEmpty.hidden = groups.active.length > 0;
      futureEmpty.hidden = groups.future.length > 0;
      pastEmpty.hidden = groups.past.length > 0;
      if (!force && changed && selectedHuntId)
        window.setTimeout(() => reloadSelectedHunt?.(), 0);
    }
    const byId = new Map(displayedHunts.map((hunt) => [hunt.id, hunt]));
    root
      .querySelectorAll<HTMLElement>("[data-hunt-countdown]")
      .forEach((element) => {
        const hunt = byId.get(element.dataset.huntCountdown ?? "");
        if (hunt) element.textContent = countdownText(hunt, now);
      });
  };

  const loadHunts = async (
    signedIn: PlayerIdentity,
    name: string,
  ): Promise<void> => {
    setGoogleSignInEnabled(false);
    providerStatus.hidden = true;
    nameForm.hidden = true;
    heading.textContent = "Your Hunts";
    categories.hidden = false;
    huntLookup.hidden = false;
    signOut.hidden = false;
    account.hidden = false;
    displayName.textContent = `${name} (Checking access…)`;
    void currentAccountRole().then((role) => {
      if (account.hidden || storedIdentity()?.accountId !== signedIn.accountId)
        return;
      displayName.textContent = role
        ? `${name} (${role === "administrator" ? "Admin" : "Player"})`
        : name;
    });
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
    futureList.replaceChildren();
    pastList.replaceChildren();
    status.textContent = "Loading your hunts...";
    const result = await repository.listActiveHunts(signedIn);
    if (!result.ok) {
      status.textContent = result.message;
      if (result.code === "unauthorized") void preparePlayerSignIn();
      return;
    }
    displayedHunts = result.value;
    renderCategories(true);
    status.textContent = result.value.length
      ? `${result.value.length} saved Hunt${result.value.length === 1 ? "" : "s"}.`
      : "Your dashboard is ready. Join a hunt above to get started.";
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
    categories.hidden = true;
    huntLookup.hidden = true;
    if (huntDetails.open) huntDetails.close();
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
  const huntDescription = root.querySelector<HTMLElement>(
    '[data-testid="player-hunt-description"]',
  );
  const huntFacts = root.querySelector<HTMLDListElement>(
    '[data-testid="player-hunt-facts"]',
  );
  const huntTasks = root.querySelector<HTMLOListElement>(
    '[data-testid="player-task-list"]',
  );
  const huntNoTasks = root.querySelector<HTMLElement>(
    '[data-testid="player-hunt-no-tasks"]',
  );
  const huntStatus = root.querySelector<HTMLElement>(
    '[data-testid="player-hunt-lookup-status"]',
  );
  const closeHuntDetails = root.querySelectorAll<HTMLButtonElement>(
    '[data-testid="close-player-hunt-details"], [data-testid="back-to-hunts"]',
  );
  if (
    huntForm &&
    huntInput &&
    huntName &&
    huntDescription &&
    huntFacts &&
    huntTasks &&
    huntNoTasks &&
    huntStatus
  ) {
    let huntRequest = 0;
    const addFact = (labelText: string, valueText: string): void => {
      const fact = document.createElement("div");
      fact.className = "hunt-fact";
      const label = document.createElement("dt");
      label.textContent = labelText;
      const value = document.createElement("dd");
      value.textContent = valueText;
      fact.append(label, value);
      huntFacts.append(fact);
    };
    const loadHunt = async (huntId: string): Promise<void> => {
      const requestId = ++huntRequest;
      selectedHuntId = huntId;
      if (!huntDetails.open) huntDetails.showModal();
      huntTasks.replaceChildren();
      huntFacts.replaceChildren();
      huntNoTasks.hidden = true;
      huntStatus.textContent = "Loading Hunt details...";
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
      const hunt = result.value;
      huntId = hunt.id;
      await loadHunts(
        identity,
        storedDisplayName(identity.accountId) ?? identity.email,
      );
      if (requestId !== huntRequest) return;
      const now = Date.now();
      const phase = huntPhase(hunt, now);
      const completed = hunt.tasks.filter((task) => task.completed).length;
      huntName.textContent = hunt.name;
      huntDescription.textContent = hunt.description;
      huntStatus.textContent =
        phase === "past"
          ? "Hunt Ended. Your progress is still available to review."
          : phase === "future"
            ? "This Hunt has not started yet. You can review its details here."
            : hunt.tasks.length
              ? "Hunt in progress."
              : "This Hunt has no tasks yet.";
      addFact(
        "Status",
        phase === "past"
          ? "Hunt Ended"
          : phase === "future"
            ? "Future Hunt"
            : "Active",
      );
      addFact("Starts", formattedTime(hunt.beginsAt));
      addFact(
        "Ends",
        hunt.endsAt ? formattedTime(hunt.endsAt) : "No end time set",
      );
      const timeFact = document.createElement("div");
      timeFact.className = "hunt-fact";
      const timeLabel = document.createElement("dt");
      timeLabel.textContent =
        phase === "future" ? "Starts in" : "Time remaining";
      const timeValue = document.createElement("dd");
      timeValue.dataset.huntCountdown = hunt.id;
      timeValue.textContent = countdownText(hunt, now);
      timeFact.append(timeLabel, timeValue);
      huntFacts.append(timeFact);
      addFact(
        "Progress",
        hunt.tasks.length
          ? `${completed} of ${hunt.tasks.length} tasks completed`
          : "No tasks added yet",
      );
      huntNoTasks.hidden = hunt.tasks.length > 0;
      const canAnswer = phase === "active";
      for (const task of hunt.tasks) {
        const item = document.createElement("li");
        item.className = "hunt-detail-task";
        item.dataset.testid = "player-task";
        const label = document.createElement("h4");
        label.textContent = task.displayLabel;
        const state = document.createElement("p");
        state.className = task.completed
          ? "task-completion completed"
          : "task-completion";
        state.textContent = task.completed ? "Completed" : "Incomplete";
        item.append(label, state);
        if (task.description) {
          const description = document.createElement("p");
          description.textContent = task.description;
          item.append(description);
        }
        const location = taskLocationElement(task.location, task.displayLabel);
        if (location) item.append(location);
        if (!task.completed && canAnswer) {
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
              const answerResult = await repository.answerAccountTask(
                huntId,
                task.id,
                answer.value,
                identity,
              );
              if (!answerResult.ok) {
                if (answerResult.message.includes("Hunt Ended")) {
                  await loadHunt(huntId);
                  return;
                }
                message.textContent = answerResult.message;
                if (answerResult.code === "unauthorized")
                  void preparePlayerSignIn();
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
    reloadSelectedHunt = () => {
      if (selectedHuntId) void loadHunt(selectedHuntId);
    };
    const closeDetails = (): void => {
      selectedHuntId = null;
      if (huntDetails.open) huntDetails.close();
    };
    closeHuntDetails.forEach((button) =>
      button.addEventListener("click", closeDetails),
    );
    huntInput.addEventListener("input", () => {
      const start = huntInput.selectionStart;
      const end = huntInput.selectionEnd;
      huntInput.value = huntInput.value.toUpperCase();
      if (start !== null && end !== null)
        huntInput.setSelectionRange(start, end);
    });
    huntForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const identity = storedIdentity();
      if (!identity) {
        huntStatus.textContent = "Sign in with Google first.";
        return;
      }
      const accessCode = huntInput.value.trim().toUpperCase();
      huntInput.value = accessCode;
      const button = huntForm.querySelector<HTMLButtonElement>(
        'button[type="submit"], button',
      );
      if (button) button.disabled = true;
      const requestId = ++huntRequest;
      huntStatus.textContent = "Joining Hunt...";
      try {
        const result = await repository.joinHunt(accessCode, identity);
        if (requestId !== huntRequest) return;
        if (!result.ok) {
          huntStatus.textContent = result.message;
          if (result.code === "unauthorized") void preparePlayerSignIn();
          return;
        }
        await loadHunt(result.value.huntId);
      } catch {
        huntStatus.textContent = "The Hunt service could not be reached.";
      } finally {
        if (button) button.disabled = false;
      }
    });
    const openHuntFromCard = (target: EventTarget | null): void => {
      const card = (target as HTMLElement | null)?.closest<HTMLElement>(
        ".player-hunt[data-hunt-id]",
      );
      if (card) void loadHunt(card.dataset.huntId ?? "");
    };
    categories.addEventListener("click", (event) => {
      openHuntFromCard(event.target);
    });
    categories.addEventListener("keydown", (event) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(".player-hunt[data-hunt-id]") &&
        (event.key === "Enter" || event.key === " ")
      ) {
        event.preventDefault();
        openHuntFromCard(event.target);
      }
    });
    huntDetails.addEventListener("close", () => {
      selectedHuntId = null;
    });
    const timer = window.setInterval(() => renderCategories(), 1000);
    window.addEventListener("pagehide", () => window.clearInterval(timer), {
      once: true,
    });
    const sharedCode = new URLSearchParams(location.search).get("accessCode");
    if (sharedCode) huntInput.value = sharedCode.toUpperCase();
    const requestedHunt = new URLSearchParams(location.search).get("huntId");
    if (requestedHunt && previousIdentity) void loadHunt(requestedHunt);
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
