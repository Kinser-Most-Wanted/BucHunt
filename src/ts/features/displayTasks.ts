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
): HTMLDivElement | null {
  if (!location) return null;
  const latitude = location.latitude;
  const longitude = location.longitude;
  const details = document.createElement("div");
  details.className = "task-location";
  const mapToggle = document.createElement("button");
  mapToggle.type = "button";
  mapToggle.className = "task-location-toggle";
  mapToggle.textContent = "Show Task Location";
  mapToggle.setAttribute("aria-expanded", "false");
  const map = document.createElement("iframe");
  map.className = "task-location-map";
  map.title = "Task location map";
  map.loading = "lazy";
  map.referrerPolicy = "no-referrer";
  map.hidden = true;
  mapToggle.addEventListener("click", () => {
    const showing = map.hidden;
    map.hidden = !showing;
    mapToggle.setAttribute("aria-expanded", String(showing));
    mapToggle.textContent = showing
      ? "Hide Task Location"
      : "Show Task Location";
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
type PastHuntFilter =
  | "recent-3"
  | "all"
  | "completed"
  | "incomplete"
  | "no-tasks"
  | "last-7-days"
  | "last-30-days"
  | "over-30-days";

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

type HuntStatusTone = "active" | "soon" | "upcoming" | "needs-tasks" | "ended";

interface HuntStatusPresentation {
  tone: HuntStatusTone;
  label: string;
  message: string;
}

function huntStatusPresentation(
  hunt: PlayerHunt,
  now: number,
): HuntStatusPresentation {
  const phase = huntPhase(hunt, now);
  if (phase === "past") {
    return {
      tone: "ended",
      label: "Hunt Ended",
      message: "Hunt Ended. Your progress is still available to review.",
    };
  }
  if (phase === "future") {
    return {
      tone: "upcoming",
      label: "Future Hunt",
      message:
        "This Hunt has not started yet. You can review its details here.",
    };
  }
  if (!hunt.tasks.length) {
    return {
      tone: "needs-tasks",
      label: "Needs tasks",
      message: "This Hunt has no tasks yet.",
    };
  }
  if (
    hunt.endsAt !== null &&
    Date.parse(hunt.endsAt) - now <= 24 * 60 * 60 * 1000
  ) {
    return {
      tone: "soon",
      label: "Ending soon",
      message: "Hunt in progress. This Hunt ends within 24 hours.",
    };
  }
  return {
    tone: "active",
    label: "Active",
    message: "Hunt in progress.",
  };
}

function isHuntCompleted(hunt: PlayerHunt): boolean {
  return hunt.tasks.length > 0 && hunt.tasks.every((task) => task.completed);
}

function pastHuntTimestamp(hunt: PlayerHunt): number {
  return Date.parse(hunt.endsAt ?? hunt.beginsAt);
}

function matchesPastHuntFilter(
  hunt: PlayerHunt,
  filter: PastHuntFilter,
  now: number,
): boolean {
  if (filter === "recent-3" || filter === "all") return true;
  if (filter === "completed") return isHuntCompleted(hunt);
  if (filter === "incomplete")
    return hunt.tasks.length > 0 && !isHuntCompleted(hunt);
  if (filter === "no-tasks") return hunt.tasks.length === 0;

  const pastDate = pastHuntTimestamp(hunt);
  const daysSinceEnd = (now - pastDate) / (24 * 60 * 60 * 1000);
  if (!Number.isFinite(daysSinceEnd) || daysSinceEnd < 0) return false;
  if (filter === "last-7-days") return daysSinceEnd <= 7;
  if (filter === "last-30-days") return daysSinceEnd <= 30;
  return daysSinceEnd > 30;
}

function updateHuntCardStatus(
  card: HTMLElement,
  hunt: PlayerHunt,
  now: number,
): void {
  const completed = isHuntCompleted(hunt);
  const presentation = completed
    ? { tone: "completed", label: "Hunt complete" }
    : huntStatusPresentation(hunt, now);
  card.dataset.huntStatus = presentation.tone;
  const badge = card.querySelector<HTMLElement>(".hunt-state-badge");
  if (badge) {
    badge.className = `hunt-state-badge hunt-state-${presentation.tone}`;
    badge.dataset.status = presentation.tone;
    badge.textContent = presentation.label;
  }
  const countdown = card.querySelector<HTMLElement>("[data-hunt-countdown]");
  if (countdown) countdown.dataset.status = presentation.tone;
}

function formattedTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function contentLength(
  value: string,
  shortLimit: number,
  mediumLimit: number,
): "short" | "medium" | "long" {
  const length = value.trim().length;
  if (length <= shortLimit) return "short";
  if (length <= mediumLimit) return "medium";
  return "long";
}

function renderHunts(
  list: HTMLUListElement,
  hunts: PlayerHunt[],
  now: number,
  newestFirst = false,
): void {
  list.replaceChildren();
  for (const hunt of [...hunts].sort((left, right) =>
    newestFirst
      ? pastHuntTimestamp(right) - pastHuntTimestamp(left)
      : Date.parse(left.beginsAt) - Date.parse(right.beginsAt),
  )) {
    const item = document.createElement("li");
    item.className = "player-hunt";
    const header = document.createElement("div");
    header.className = "player-hunt-card-heading";
    const heading = document.createElement("h3");
    heading.textContent = hunt.name;
    const badge = document.createElement("span");
    badge.className = "hunt-state-badge";
    const presentation = huntStatusPresentation(hunt, now);
    badge.dataset.status = presentation.tone;
    badge.textContent = presentation.label;
    header.append(heading, badge);
    const description = document.createElement("p");
    description.className = "player-hunt-description";
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
    updateHuntCardStatus(item, hunt, now);
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
  const pastFilter = root.querySelector<HTMLSelectElement>(
    '[data-testid="past-hunt-filter"]',
  );
  const pastFilterNote = root.querySelector<HTMLElement>(
    '[data-testid="past-hunt-filter-note"]',
  );
  const activeHuntCount = root.querySelector<HTMLElement>(
    '[data-testid="active-hunt-count"]',
  );
  const futureHuntCount = root.querySelector<HTMLElement>(
    '[data-testid="future-hunt-count"]',
  );
  const pastHuntCount = root.querySelector<HTMLElement>(
    '[data-testid="past-hunt-count"]',
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
    !pastFilter ||
    !pastFilterNote ||
    !activeHuntCount ||
    !futureHuntCount ||
    !pastHuntCount ||
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
    heading.hidden = false;
    heading.textContent = "Sign in to see active Hunts";
    status.hidden = false;
    list.replaceChildren();
    futureList.replaceChildren();
    pastList.replaceChildren();
    status.textContent = message;
  };

  let displayedHunts: PlayerHunt[] = [];
  let pastHuntFilter: PastHuntFilter = "recent-3";
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
      const sortedPastHunts = [...groups.past].sort(
        (left, right) => pastHuntTimestamp(right) - pastHuntTimestamp(left),
      );
      const matchingPastHunts =
        pastHuntFilter === "recent-3"
          ? sortedPastHunts.slice(0, 3)
          : sortedPastHunts.filter((hunt) =>
              matchesPastHuntFilter(hunt, pastHuntFilter, now),
            );
      renderHunts(pastList, matchingPastHunts, now, true);
      pastFilterNote.textContent =
        pastHuntFilter === "recent-3"
          ? "Showing up to 3 recent Past Hunts. Choose a filter to browse older hunts."
          : pastHuntFilter === "all"
            ? "Showing all past Hunts, newest first."
            : "Showing all past Hunts that match this filter, newest first.";
      activeHuntCount.textContent = `(${groups.active.length})`;
      activeHuntCount.setAttribute(
        "aria-label",
        `${groups.active.length} active hunts`,
      );
      futureHuntCount.textContent = `(${groups.future.length})`;
      futureHuntCount.setAttribute(
        "aria-label",
        `${groups.future.length} future hunts`,
      );
      pastHuntCount.textContent = `(${matchingPastHunts.length})`;
      pastHuntCount.setAttribute(
        "aria-label",
        `${matchingPastHunts.length} past hunts shown`,
      );
      activeEmpty.hidden = groups.active.length > 0;
      futureEmpty.hidden = groups.future.length > 0;
      pastEmpty.hidden = matchingPastHunts.length > 0;
      pastEmpty.textContent = groups.past.length
        ? "No past Hunts match this filter."
        : "No past Hunts yet.";
      if (!force && changed && selectedHuntId)
        window.setTimeout(() => reloadSelectedHunt?.(), 0);
    }
    const byId = new Map(displayedHunts.map((hunt) => [hunt.id, hunt]));
    root
      .querySelectorAll<HTMLElement>("[data-hunt-countdown]")
      .forEach((element) => {
        const hunt = byId.get(element.dataset.huntCountdown ?? "");
        if (hunt) {
          const text = countdownText(hunt, now);
          if (element.textContent !== text) element.textContent = text;
          const card = element.closest<HTMLElement>(".player-hunt");
          if (card) updateHuntCardStatus(card, hunt, now);
        }
      });
  };

  pastFilter.addEventListener("change", () => {
    pastHuntFilter = pastFilter.value as PastHuntFilter;
    renderCategories(true);
  });

  const updateDisplayedHunt = (hunt: PlayerHunt): void => {
    const index = displayedHunts.findIndex((item) => item.id === hunt.id);
    if (index < 0) return;
    const previousHunt = displayedHunts[index];
    displayedHunts[index] = hunt;
    const now = Date.now();
    if (huntPhase(previousHunt, now) !== huntPhase(hunt, now)) {
      renderCategories(true);
      return;
    }
    const card = Array.from(
      root.querySelectorAll<HTMLElement>(".player-hunt[data-hunt-id]"),
    ).find((item) => item.dataset.huntId === hunt.id);
    if (!card) return;
    updateHuntCardStatus(card, hunt, now);
    card.setAttribute("aria-label", `Open ${hunt.name}`);
    const name = card.querySelector<HTMLElement>(
      ".player-hunt-card-heading h3",
    );
    if (name) name.textContent = hunt.name;
    const description = card.querySelector<HTMLElement>(
      ".player-hunt-description",
    );
    if (description) description.textContent = hunt.description;
    const countdown = card.querySelector<HTMLElement>("[data-hunt-countdown]");
    if (countdown) countdown.textContent = countdownText(hunt, now);
    const completed = hunt.tasks.filter((task) => task.completed).length;
    const progress = card.querySelector<HTMLElement>(".player-hunt-progress");
    if (progress) {
      progress.textContent = hunt.tasks.length
        ? `${completed} of ${hunt.tasks.length} tasks completed`
        : "No tasks added yet";
    }
  };

  const loadHunts = async (
    signedIn: PlayerIdentity,
    name: string,
  ): Promise<void> => {
    setGoogleSignInEnabled(false);
    providerStatus.hidden = true;
    nameForm.hidden = true;
    heading.textContent = "Your Hunts";
    heading.hidden = true;
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
    status.hidden = false;
    status.textContent = "Loading your hunts...";
    const result = await repository.listActiveHunts(signedIn);
    if (!result.ok) {
      status.hidden = false;
      status.textContent = result.message;
      if (result.code === "unauthorized") void preparePlayerSignIn();
      return;
    }
    displayedHunts = result.value;
    renderCategories(true);
    status.hidden = result.value.length > 0;
    status.textContent = result.value.length
      ? ""
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
  const pageParams = new URLSearchParams(location.search);
  const sharedCode = pageParams.get("accessCode")?.trim().toUpperCase() ?? "";
  const autoJoin = pageParams.get("autoJoin") === "1";
  let sharedLinkJoinPending = false;

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
    if (sharedCode) {
      window.setTimeout(submitSharedLinkJoin, 0);
    } else {
      void loadHunts(signedIn, name);
    }
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
  const submitSharedLinkJoin = (): void => {
    sharedLinkJoinPending = true;
    if (autoJoin) {
      huntForm?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    } else {
      huntForm?.requestSubmit();
    }
  };
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
  const huntTasksSection = huntTasks?.closest<HTMLElement>(".details-tasks");
  const huntOverviewSection =
    huntFacts?.closest<HTMLElement>(".details-overview");
  if (huntTasksSection && huntOverviewSection) {
    huntTasksSection.after(huntOverviewSection);
  }
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
    const intro = document.createElement("div");
    intro.className = "player-hunt-intro";
    huntName.before(intro);
    intro.append(huntName, huntDescription, huntStatus);

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
      const scrollPosition = huntDetails.open ? huntDetails.scrollTop : 0;
      if (!huntDetails.open) {
        huntDetails.scrollTop = 0;
        huntDetails.showModal();
        document.body.classList.add("player-hunt-modal-open");
      }
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
      if (requestId !== huntRequest) return;
      const hunt = result.value;
      updateDisplayedHunt(hunt);
      huntId = hunt.id;
      const now = Date.now();
      const phase = huntPhase(hunt, now);
      const completed = hunt.tasks.filter((task) => task.completed).length;
      huntName.textContent = hunt.name;
      huntName.dataset.contentLength = contentLength(hunt.name, 28, 56);
      huntDescription.textContent = hunt.description;
      huntDescription.dataset.contentLength = contentLength(
        hunt.description,
        120,
        280,
      );
      const completedHunt = isHuntCompleted(hunt);
      const presentation = huntStatusPresentation(hunt, now);
      huntStatus.textContent = completedHunt
        ? "Hunt complete! Every task is finished."
        : presentation.message;
      huntStatus.dataset.status = completedHunt
        ? "completed"
        : presentation.tone;
      addFact("Status", completedHunt ? "Hunt completed" : presentation.label);
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
      timeValue.dataset.status = presentation.tone;
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
        const heading = document.createElement("div");
        heading.className = "hunt-detail-task-heading";
        const label = document.createElement("h4");
        label.textContent = task.displayLabel;
        const state = document.createElement("p");
        state.className = task.completed
          ? "task-completion completed"
          : "task-completion";
        state.textContent = task.completed ? "Completed" : "Incomplete";
        heading.append(label, state);
        const location = taskLocationElement(task.location);
        if (location) heading.append(location);
        item.append(heading);
        if (task.description) {
          const description = document.createElement("p");
          description.textContent = task.description;
          item.append(description);
        }
        if (task.hint?.trim()) {
          const hint = document.createElement("p");
          hint.className = "task-hint";
          const hintLabel = document.createElement("strong");
          hintLabel.textContent = "Hint: ";
          hint.append(hintLabel, document.createTextNode(task.hint));
          item.append(hint);
        }
        if (
          !task.completed &&
          canAnswer &&
          task.taskType === "multiple-choice"
        ) {
          const choices = document.createElement("div");
          choices.className = "task-answer-choices";
          choices.setAttribute("role", "group");
          choices.setAttribute("aria-label", `Answer for ${task.displayLabel}`);
          const message = document.createElement("p");
          message.className = "task-answer-choice-message";
          message.setAttribute("role", "status");
          const incorrect = new Set(task.incorrectChoices ?? []);
          const buttons: HTMLButtonElement[] = [];
          const refresh = (): void => {
            for (const button of buttons) {
              button.disabled = incorrect.has(button.value);
              button.textContent =
                button.value +
                (incorrect.has(button.value) ? " — Incorrect" : "");
            }
          };
          for (const choice of task.choices ?? []) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "task-answer-choice";
            button.value = choice;
            buttons.push(button);
            button.addEventListener("click", async () => {
              for (const option of buttons) option.disabled = true;
              message.textContent = "Checking answer…";
              try {
                const result = await repository.answerAccountTask(
                  huntId,
                  task.id,
                  choice,
                  identity,
                );
                if (requestId !== huntRequest) return;
                if (!result.ok) {
                  message.textContent = result.message;
                  if (result.message.includes("Hunt Ended")) {
                    await loadHunt(huntId);
                    return;
                  }
                  if (result.code === "unauthorized")
                    void preparePlayerSignIn();
                } else if (result.value.completed) {
                  state.textContent = "Completed";
                  choices.remove();
                  await loadHunt(huntId);
                  return;
                } else {
                  incorrect.add(choice);
                  message.textContent =
                    "Incorrect answer. Choose another option.";
                }
              } catch {
                message.textContent =
                  "The answer service could not be reached. Try again.";
              } finally {
                refresh();
              }
            });
            choices.append(button);
          }
          refresh();
          choices.append(message);
          item.append(choices);
        } else if (!task.completed && canAnswer) {
          const answerForm = document.createElement("form");
          answerForm.className = "task-answer-form";
          const answerLabel = document.createElement("label");
          answerLabel.className = "task-answer-label";
          answerLabel.textContent = `Answer for ${task.displayLabel}`;
          const answer = document.createElement("input");
          answer.type = "text";
          answer.className = "task-answer-input";
          answer.required = true;
          answerLabel.append(answer);
          const actions = document.createElement("div");
          actions.className = "task-answer-actions";
          const submit = document.createElement("button");
          submit.type = "submit";
          submit.className = "task-answer-submit";
          submit.textContent = "Submit answer";
          const message = document.createElement("p");
          message.className = "task-answer-message";
          message.setAttribute("role", "status");
          actions.append(submit, message);
          answerForm.append(answerLabel, actions);
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
      window.requestAnimationFrame(() => {
        if (requestId === huntRequest && huntDetails.open) {
          huntDetails.scrollTop = scrollPosition;
        }
      });
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
      const isSharedLinkJoin = sharedLinkJoinPending;
      sharedLinkJoinPending = false;
      const identity = storedIdentity();
      if (!identity) {
        huntStatus.textContent = "Sign in with Google first.";
        return;
      }
      const accessCode = (
        isSharedLinkJoin && autoJoin ? sharedCode : huntInput.value
      )
        .trim()
        .toUpperCase();
      huntInput.value = isSharedLinkJoin && autoJoin ? "" : accessCode;
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
        if (isSharedLinkJoin) {
          await loadHunts(
            identity,
            storedDisplayName(identity.accountId) ?? identity.email,
          );
          huntStatus.textContent =
            "You joined the Hunt. It is now in your list.";
        } else {
          await loadHunt(result.value.huntId);
        }
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
      document.body.classList.remove("player-hunt-modal-open");
      renderCategories();
    });
    const timer = window.setInterval(() => {
      if (!huntDetails.open) renderCategories();
    }, 1000);
    window.addEventListener("pagehide", () => window.clearInterval(timer), {
      once: true,
    });
    if (sharedCode && !autoJoin) huntInput.value = sharedCode;
    const requestedHunt = new URLSearchParams(location.search).get("huntId");
    if (
      sharedCode &&
      previousIdentity &&
      storedDisplayName(previousIdentity.accountId)
    ) {
      window.setTimeout(submitSharedLinkJoin, 0);
    } else if (requestedHunt && previousIdentity) {
      void loadHunt(requestedHunt);
    }
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
