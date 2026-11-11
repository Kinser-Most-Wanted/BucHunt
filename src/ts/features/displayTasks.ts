import { mountKahootPlayer } from "./kahootHunt.js";
import { mountPlayerIssues } from "./huntIssues.js";
import type { HuntRepository } from "../foundation/contracts.js";
import type {
  OrganizationDefinition,
  OrganizationHuntSummary,
  OrganizationInvitationDefinition,
  OrganizationInvitationResponse,
  OperationResult,
  PlayerHunt,
  PlayerIdentity,
} from "../foundation/types.js";

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

async function organizationRequest<T>(
  identity: PlayerIdentity,
  path: string,
  input?: unknown,
  method?: string,
): Promise<OperationResult<T>> {
  try {
    const response = await fetch(path, {
      method: method ?? (input === undefined ? "GET" : "POST"),
      credentials: "omit",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${identity.idToken}`,
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    const result = (await response.json()) as OperationResult<T>;
    if (typeof result.ok !== "boolean" || response.ok !== result.ok)
      throw new Error("Invalid organization response");
    return result;
  } catch {
    return {
      ok: false,
      code: "network",
      message: "Organizations could not be reached. Try again.",
    };
  }
}

function storedIdentity(): PlayerIdentity | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(PLAYER_SESSION_KEY) ??
        sessionStorage.getItem(PLAYER_SESSION_KEY) ??
        "null",
    ) as (Partial<PlayerIdentity> & { expiresAt?: number }) | null;
    if (
      value?.provider === "google" &&
      (typeof value.expiresAt !== "number" ||
        value.expiresAt * 1000 > Date.now()) &&
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

const pastHuntFilterNotes: Record<PastHuntFilter, string> = {
  "recent-3":
    "Showing up to 3 recent Past Hunts. Choose a filter to browse older hunts.",
  all: "Showing all past Hunts, newest first.",
  completed: "Showing all past Hunts that were completed, newest first.",
  incomplete: "Showing all past Hunts that were not completed, newest first.",
  "no-tasks": "Showing all past Hunts that have no Tasks",
  "last-7-days":
    "Showing all past Hunts that ended in the last 7 days, newest first.",
  "last-30-days":
    "Showing all past Hunts that ended in the last 30 days, newest first.",
  "over-30-days":
    "Showing all past Hunts that ended over 30 days ago, newest first.",
};

function huntPhase(hunt: PlayerHunt, now: number): HuntPhase {
  if (
    hunt.status === "archived" ||
    (hunt.endsAt !== null && Date.parse(hunt.endsAt) <= now)
  )
    return "past";
  if (hunt.huntType === "kahoot")
    return hunt.kahoot?.phase === "finished"
      ? "past"
      : hunt.kahoot?.phase === "lobby"
        ? "future"
        : "active";
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
  if (hunt.huntType === "kahoot")
    return hunt.kahoot?.phase === "finished"
      ? "Hunt complete"
      : hunt.kahoot?.phase === "lobby"
        ? "Waiting for host"
        : "Live Kahoot Hunt";
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
  if (hunt.huntType === "kahoot")
    return {
      tone:
        phase === "past" ? "ended" : phase === "future" ? "upcoming" : "active",
      label:
        phase === "past"
          ? "Hunt complete"
          : phase === "future"
            ? "Lobby"
            : "Live",
      message: "Kahoot Hunt",
    };
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
  if (hunt.huntType === "kahoot") return hunt.kahoot?.phase === "finished";
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
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "player-hunt-open";
    openButton.textContent = hunt.name;
    openButton.setAttribute("aria-label", `Open ${hunt.name}`);
    heading.append(openButton);
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
    progress.textContent =
      hunt.huntType === "kahoot"
        ? "Synchronized questions · Host controlled"
        : hunt.tasks.length
          ? `${completed} of ${hunt.tasks.length} tasks completed`
          : "No tasks added yet";
    const leaveButton = document.createElement("button");
    leaveButton.type = "button";
    leaveButton.className = "player-leave-card";
    leaveButton.dataset.testid = "leave-hunt-card";
    leaveButton.setAttribute("aria-label", `Leave ${hunt.name}`);
    leaveButton.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10 17l5-5-5-5M15 12H3M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/></svg><span>Leave Hunt</span>';
    const statusActions = document.createElement("div");
    statusActions.className = "player-hunt-card-status";
    statusActions.append(badge, leaveButton);
    header.append(heading, statusActions);
    item.dataset.huntId = hunt.id;
    updateHuntCardStatus(item, hunt, now);
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
  const leaveDialog = root.querySelector<HTMLDialogElement>(
    '[data-testid="leave-hunt-dialog"]',
  );
  const leaveHuntName = leaveDialog?.querySelector<HTMLElement>(
    '[data-testid="leave-hunt-name"]',
  );
  const leaveHuntStatus = leaveDialog?.querySelector<HTMLElement>(
    '[data-testid="leave-hunt-status"]',
  );
  const confirmLeaveHunt = leaveDialog?.querySelector<HTMLButtonElement>(
    '[data-testid="confirm-leave-hunt"]',
  );
  const cancelLeaveHunt = leaveDialog?.querySelector<HTMLButtonElement>(
    '[data-testid="cancel-leave-hunt"]',
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
  const accountNameEditToggle = findAccountElement<HTMLButtonElement>(
    '[data-testid="player-change-display-name"]',
  );
  const accountNameForm = findAccountElement<HTMLFormElement>(
    '[data-testid="player-account-name-form"]',
  );
  const accountNameInput = findAccountElement<HTMLInputElement>(
    '[data-testid="player-account-name-input"]',
  );
  const accountNameStatus = findAccountElement<HTMLElement>(
    '[data-testid="player-account-name-status"]',
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
  const organizationWorkspace = root.querySelector<HTMLElement>(
    '[data-testid="organization-workspace"]',
  );
  const organizationDiscovery = root.querySelector<HTMLElement>(
    '[data-testid="organization-hunt-discovery"]',
  );
  const organizationHuntsList = root.querySelector<HTMLUListElement>(
    '[data-testid="organization-hunts-list"]',
  );
  const organizationHuntsStatus = root.querySelector<HTMLElement>(
    '[data-testid="organization-hunts-status"]',
  );
  const organizationDialog = root.querySelector<HTMLDialogElement>(
    '[data-testid="organization-dialog"]',
  );
  const openOrganizations = root.querySelector<HTMLButtonElement>(
    '[data-testid="open-organizations"]',
  );
  const openOrganizationInvitations = root.querySelector<HTMLButtonElement>(
    '[data-testid="open-organization-invitations"]',
  );
  const organizationInvitationsPanel = root.querySelector<HTMLElement>(
    '[data-testid="organization-invitations-panel"]',
  );
  const organizationInvitations = root.querySelector<HTMLUListElement>(
    '[data-testid="organization-invitations"]',
  );
  const organizationInvitationsStatus = root.querySelector<HTMLElement>(
    '[data-testid="organization-invitations-status"]',
  );
  const closeOrganizations = root.querySelector<HTMLButtonElement>(
    '[data-testid="close-organizations"]',
  );
  const organizationCreateForm = root.querySelector<HTMLFormElement>(
    '[data-testid="organization-create-form"]',
  );
  const organizationCreateStatus = root.querySelector<HTMLElement>(
    '[data-testid="organization-create-status"]',
  );
  const organizationList = root.querySelector<HTMLUListElement>(
    '[data-testid="organization-list"]',
  );
  const organizationEditor = root.querySelector<HTMLElement>(
    '[data-testid="organization-editor"]',
  );
  const organizationDetailsForm = root.querySelector<HTMLFormElement>(
    '[data-testid="organization-details-form"]',
  );
  const organizationDetailsStatus = root.querySelector<HTMLElement>(
    '[data-testid="organization-details-status"]',
  );
  const organizationInviteForm = root.querySelector<HTMLFormElement>(
    '[data-testid="organization-invite-form"]',
  );
  const organizationInviteStatus = root.querySelector<HTMLElement>(
    '[data-testid="organization-invite-status"]',
  );
  const organizationMembers = root.querySelector<HTMLUListElement>(
    '[data-testid="organization-members"]',
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
    !accountNameEditToggle ||
    !accountNameForm ||
    !accountNameInput ||
    !accountNameStatus ||
    !nameForm ||
    !nameInput ||
    !huntLookup ||
    !organizationWorkspace ||
    !organizationDiscovery ||
    !organizationHuntsList ||
    !organizationHuntsStatus ||
    !organizationDialog ||
    !openOrganizations ||
    !openOrganizationInvitations ||
    !organizationInvitationsPanel ||
    !organizationInvitations ||
    !organizationInvitationsStatus ||
    !closeOrganizations ||
    !organizationCreateForm ||
    !organizationCreateStatus ||
    !organizationList ||
    !organizationEditor ||
    !organizationDetailsForm ||
    !organizationDetailsStatus ||
    !organizationInviteForm ||
    !organizationInviteStatus ||
    !organizationMembers
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
    accountNameEditToggle.hidden = false;
    accountNameEditToggle.setAttribute("aria-expanded", "false");
    accountNameForm.hidden = true;
    accountNameStatus.hidden = true;
    nameForm.hidden = true;
    categories.hidden = true;
    huntLookup.hidden = true;
    organizationWorkspace.hidden = true;
    if (organizationDialog.open) organizationDialog.close();
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
  let activeIdentity: PlayerIdentity | null = null;
  let currentNickname = "";
  let currentRoleLabel = "Player";
  let pastHuntFilter: PastHuntFilter = "recent-3";
  let categorySignature = "";
  let organizations: OrganizationDefinition[] = [];
  let pendingOrganizationInvitations: OrganizationInvitationDefinition[] = [];
  let promptedInvitationsForAccount: string | null = null;
  let selectedOrganizationId: string | null = null;
  let selectedHuntId: string | null = null;
  let reloadSelectedHunt: (() => void) | undefined;
  const selectedOrganization = (): OrganizationDefinition | undefined =>
    organizations.find(
      (organization) => organization.id === selectedOrganizationId,
    );

  const renderOrganizationEditor = (): void => {
    const organization = selectedOrganization();
    organizationEditor.hidden = !organization;
    if (!organization) return;
    const nameInput = organizationDetailsForm.elements.namedItem(
      "name",
    ) as HTMLInputElement;
    nameInput.value = organization.name;
    const canEdit =
      organization.role === "owner" || organization.role === "officer";
    nameInput.disabled = !canEdit;
    organizationDetailsForm.querySelector<HTMLButtonElement>(
      "button",
    )!.disabled = !canEdit;
    organizationInviteForm.hidden = organization.role !== "owner";
    organizationMembers.replaceChildren();
    for (const member of organization.members) {
      const item = document.createElement("li");
      item.className = "organization-member";
      const label = document.createElement("span");
      label.className = "organization-member-label";
      label.textContent = `${member.email} · ${member.role}${member.originalOwner ? " · Original Owner" : ""}${member.pending ? " · Invitation pending" : ""}`;
      item.append(label);
      const key = member.accountId ?? `invite:${member.email}`;
      const isSelf =
        member.isSelf ?? member.accountId === activeIdentity?.accountId;
      if (organization.role === "owner" && !member.originalOwner && !isSelf) {
        const role = document.createElement("select");
        role.setAttribute("aria-label", `Role for ${member.email}`);
        role.dataset.organizationMemberKey = key;
        for (const value of ["owner", "officer", "contributor"] as const) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = value.charAt(0).toUpperCase() + value.slice(1);
          role.append(option);
        }
        role.value = member.role;
        item.append(role);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "organization-member-remove";
        remove.dataset.organizationMemberKey = key;
        remove.textContent = "Remove";
        item.append(remove);
      }
      organizationMembers.append(item);
    }
    organizationList
      .querySelectorAll<HTMLButtonElement>("[data-organization-id]")
      .forEach((button) => {
        button.setAttribute(
          "aria-current",
          button.dataset.organizationId === organization.id ? "true" : "false",
        );
      });
  };

  const refreshOrganizations = async (
    identity = activeIdentity,
    selectId = selectedOrganizationId,
  ): Promise<void> => {
    if (!identity) return;
    const result = await organizationRequest<OrganizationDefinition[]>(
      identity,
      "/api/player/account/organizations",
    );
    if (!result.ok) {
      organizationCreateStatus.textContent = result.message;
      return;
    }
    organizations = result.value;
    selectedOrganizationId =
      organizations.find((organization) => organization.id === selectId)?.id ??
      organizations[0]?.id ??
      null;
    organizationList.replaceChildren();
    if (!organizations.length) {
      const empty = document.createElement("li");
      empty.textContent = "You are not in an organization yet.";
      organizationList.append(empty);
    }
    for (const organization of organizations) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.organizationId = organization.id;
      button.textContent = `${organization.name} (${organization.role})`;
      item.append(button);
      organizationList.append(item);
    }
    renderOrganizationEditor();
  };

  const renderOrganizationInvitations = (): void => {
    organizationInvitations.replaceChildren();
    openOrganizationInvitations.hidden =
      pendingOrganizationInvitations.length === 0;
    openOrganizationInvitations.textContent = `Organization invitations (${pendingOrganizationInvitations.length})`;
    organizationInvitationsPanel.hidden =
      pendingOrganizationInvitations.length === 0;
    for (const invitation of pendingOrganizationInvitations) {
      const item = document.createElement("li");
      const copy = document.createElement("span");
      copy.textContent = `${invitation.organizationName} invited you to join as a ${invitation.role}.`;
      const actions = document.createElement("div");
      actions.className = "organization-invitation-actions";
      for (const action of ["accept", "decline"] as const) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.organizationInvitationAction = action;
        button.dataset.organizationId = invitation.organizationId;
        button.textContent = action === "accept" ? "Accept" : "Decline";
        actions.append(button);
      }
      item.append(copy, actions);
      organizationInvitations.append(item);
    }
  };

  const refreshOrganizationInvitations = async (
    identity = activeIdentity,
    showPrompt = false,
  ): Promise<void> => {
    if (!identity) return;
    const result = await organizationRequest<
      OrganizationInvitationDefinition[]
    >(identity, "/api/player/account/organization-invitations");
    if (identity.accountId !== activeIdentity?.accountId) return;
    if (!result.ok) {
      organizationInvitationsStatus.textContent = result.message;
      organizationInvitationsStatus.hidden = false;
      return;
    }
    pendingOrganizationInvitations = result.value;
    renderOrganizationInvitations();
    if (
      showPrompt &&
      pendingOrganizationInvitations.length > 0 &&
      promptedInvitationsForAccount !== identity.accountId
    ) {
      promptedInvitationsForAccount = identity.accountId;
      organizationInvitationsStatus.hidden = true;
      if (!organizationDialog.open) organizationDialog.showModal();
    }
  };

  const openOrganizationManager = (): void => {
    organizationDialog.showModal();
    organizationCreateStatus.textContent = "";
    organizationInvitationsStatus.hidden = true;
    void refreshOrganizations();
    void refreshOrganizationInvitations();
  };

  openOrganizations.addEventListener("click", openOrganizationManager);
  openOrganizationInvitations.addEventListener(
    "click",
    openOrganizationManager,
  );

  organizationInvitations.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-organization-invitation-action]",
    );
    const identity = activeIdentity;
    const organizationId = button?.dataset.organizationId;
    const action = button?.dataset.organizationInvitationAction;
    if (
      !button ||
      !identity ||
      !organizationId ||
      (action !== "accept" && action !== "decline")
    )
      return;
    button.disabled = true;
    organizationInvitationsStatus.hidden = true;
    void organizationRequest<OrganizationInvitationResponse>(
      identity,
      `/api/player/account/organization-invitations/${encodeURIComponent(organizationId)}`,
      { action },
    ).then(async (result) => {
      if (!result.ok) {
        organizationInvitationsStatus.textContent = result.message;
        organizationInvitationsStatus.hidden = false;
        button.disabled = false;
        return;
      }
      organizationInvitationsStatus.textContent = result.value.accepted
        ? "Organization invitation accepted."
        : "Organization invitation declined.";
      organizationInvitationsStatus.hidden = false;
      await Promise.all([
        refreshOrganizationInvitations(identity),
        refreshOrganizations(identity),
      ]);
    });
  });
  closeOrganizations.addEventListener("click", () =>
    organizationDialog.close(),
  );
  organizationCreateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const identity = activeIdentity;
    const fields = new FormData(organizationCreateForm);
    const name = String(fields.get("name") ?? "").trim();
    if (!identity || !name) return;
    const submit = organizationCreateForm.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    submit.disabled = true;
    organizationCreateStatus.textContent = "Creating organization…";
    void organizationRequest<OrganizationDefinition>(
      identity,
      "/api/player/account/organizations",
      { name },
    ).then(async (result) => {
      submit.disabled = false;
      if (!result.ok) {
        organizationCreateStatus.textContent = result.message;
        return;
      }
      organizationCreateForm.reset();
      organizationCreateStatus.textContent = "Organization created.";
      await refreshOrganizations(identity, result.value.id);
    });
  });
  organizationList.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-organization-id]",
    );
    if (!button) return;
    selectedOrganizationId = button.dataset.organizationId ?? null;
    renderOrganizationEditor();
  });
  organizationDetailsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const identity = activeIdentity;
    const organization = selectedOrganization();
    if (!identity || !organization) return;
    const name = String(
      new FormData(organizationDetailsForm).get("name") ?? "",
    ).trim();
    const button = organizationDetailsForm.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    button.disabled = true;
    void organizationRequest<OrganizationDefinition>(
      identity,
      `/api/player/account/organizations/${encodeURIComponent(organization.id)}`,
      { name },
      "PATCH",
    ).then(async (result) => {
      button.disabled = false;
      organizationDetailsStatus.textContent = result.ok
        ? "Organization name saved."
        : result.message;
      if (result.ok) await refreshOrganizations(identity, organization.id);
    });
  });
  organizationInviteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const identity = activeIdentity;
    const organization = selectedOrganization();
    if (!identity || !organization) return;
    const email = String(
      new FormData(organizationInviteForm).get("email") ?? "",
    )
      .trim()
      .toLowerCase();
    const button = organizationInviteForm.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    button.disabled = true;
    void organizationRequest<OrganizationDefinition>(
      identity,
      `/api/player/account/organizations/${encodeURIComponent(organization.id)}/members`,
      { email },
    ).then(async (result) => {
      button.disabled = false;
      organizationInviteStatus.textContent = result.ok
        ? `Invitation sent to ${email}. They must accept before joining as a Contributor.`
        : result.message;
      if (result.ok) {
        organizationInviteForm.reset();
        await refreshOrganizations(identity, organization.id);
      }
    });
  });
  organizationMembers.addEventListener("change", (event) => {
    const role = event.target;
    const organization = selectedOrganization();
    const identity = activeIdentity;
    if (
      !(role instanceof HTMLSelectElement) ||
      !role.dataset.organizationMemberKey ||
      !organization ||
      !identity
    )
      return;
    const previousRole =
      organization.members.find(
        (member) =>
          (member.accountId ?? `invite:${member.email}`) ===
          role.dataset.organizationMemberKey,
      )?.role ?? "contributor";
    role.disabled = true;
    void organizationRequest<OrganizationDefinition>(
      identity,
      `/api/player/account/organizations/${encodeURIComponent(organization.id)}/members/${encodeURIComponent(role.dataset.organizationMemberKey)}`,
      { role: role.value },
      "PATCH",
    ).then(async (result) => {
      role.disabled = false;
      organizationDetailsStatus.textContent = result.ok
        ? "Member role updated."
        : result.message;
      if (result.ok) await refreshOrganizations(identity, organization.id);
      else role.value = previousRole;
    });
  });
  organizationMembers.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-organization-member-key]",
    );
    const organization = selectedOrganization();
    const identity = activeIdentity;
    if (!button || !organization || !identity) return;
    button.disabled = true;
    void organizationRequest<OrganizationDefinition>(
      identity,
      `/api/player/account/organizations/${encodeURIComponent(organization.id)}/members/${encodeURIComponent(button.dataset.organizationMemberKey!)}`,
      undefined,
      "DELETE",
    ).then(async (result) => {
      organizationDetailsStatus.textContent = result.ok
        ? "Member removed."
        : result.message;
      if (result.ok) await refreshOrganizations(identity, organization.id);
      else button.disabled = false;
    });
  });

  const refreshOrganizationHunts = async (
    identity: PlayerIdentity,
  ): Promise<void> => {
    const result = await organizationRequest<OrganizationHuntSummary[]>(
      identity,
      "/api/player/account/organization-hunts",
    );
    if (identity.accountId !== activeIdentity?.accountId) return;
    if (!result.ok) {
      organizationDiscovery.hidden = false;
      organizationHuntsStatus.textContent = result.message;
      organizationHuntsList.replaceChildren();
      return;
    }
    organizationHuntsList.replaceChildren();
    organizationDiscovery.hidden = result.value.length === 0;
    organizationHuntsStatus.textContent = result.value.length
      ? "Choose a Hunt to add it to your dashboard."
      : "";
    for (const hunt of result.value) {
      const item = document.createElement("li");
      item.className = "organization-hunt-card";
      const copy = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = hunt.name;
      const description = document.createElement("p");
      description.textContent = hunt.description;
      const organization = document.createElement("p");
      organization.className = "field-help";
      organization.textContent = `${hunt.organizationName} · ${hunt.role}`;
      copy.append(title, description, organization);
      const join = document.createElement("button");
      join.type = "button";
      join.textContent = "Join Hunt";
      join.setAttribute("aria-label", `Join ${hunt.name}`);
      join.addEventListener("click", async () => {
        join.disabled = true;
        organizationHuntsStatus.textContent = `Joining ${hunt.name}…`;
        const joined = await organizationRequest<{ huntId: string }>(
          identity,
          "/api/player/account/join",
          { huntId: hunt.id },
        );
        if (!joined.ok) {
          organizationHuntsStatus.textContent = joined.message;
          join.disabled = false;
          return;
        }
        organizationHuntsStatus.textContent = `${hunt.name} added to your Hunts.`;
        await loadHunts(identity, currentNickname);
      });
      item.append(copy, join);
      organizationHuntsList.append(item);
    }
  };

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
      pastFilterNote.textContent = pastHuntFilterNotes[pastHuntFilter];
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
    const name = card.querySelector<HTMLElement>(".player-hunt-open");
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
      progress.textContent =
        hunt.huntType === "kahoot"
          ? "Synchronized questions · Host controlled"
          : hunt.tasks.length
            ? `${completed} of ${hunt.tasks.length} tasks completed`
            : "No tasks added yet";
    }
  };

  const loadHunts = async (
    signedIn: PlayerIdentity,
    name: string,
  ): Promise<void> => {
    activeIdentity = signedIn;
    currentNickname = name;
    organizationWorkspace.hidden = false;
    void refreshOrganizations(signedIn);
    void refreshOrganizationInvitations(signedIn, true);
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
      currentRoleLabel = role === "administrator" ? "Admin" : "Player";
      displayName.textContent = `${currentNickname} (${currentRoleLabel})`;
    });
    accountNameEditToggle.hidden = false;
    accountNameEditToggle.setAttribute("aria-expanded", "false");
    accountNameForm.hidden = true;
    accountNameInput.value = name;
    accountNameStatus.hidden = true;
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
    void refreshOrganizationHunts(signedIn);
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
      localStorage.removeItem(PLAYER_SESSION_KEY);
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
    accountNameForm.hidden = true;
    accountNameStatus.hidden = true;
    heading.textContent = "Set up your player profile";
    nameForm.hidden = false;
    categories.hidden = true;
    huntLookup.hidden = true;
    organizationWorkspace.hidden = true;
    if (organizationDialog.open) organizationDialog.close();
    if (huntDetails.open) huntDetails.close();
    signOut.hidden = false;
    nameInput.value = "";
    nameInput.focus();
    status.hidden = true;
    status.textContent = "";
  };

  nameForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const signedIn = pendingIdentity;
    const name = nameInput.value.trim();
    if (!signedIn || !name) return;
    nameInput.disabled = true;
    void repository
      .saveAccountProfile(name, signedIn)
      .then((saved) => {
        nameInput.disabled = false;
        if (!saved.ok) {
          providerStatus.hidden = false;
          providerStatus.textContent = saved.message;
          return;
        }
        try {
          localStorage.setItem(
            `${PLAYER_PROFILE_KEY_PREFIX}${signedIn.accountId}`,
            saved.value.displayName ?? name,
          );
        } catch {
          // Browser storage is a cache; the account profile is saved remotely.
        }
        pendingIdentity = null;
        providerStatus.hidden = true;
        if (sharedCode) {
          window.setTimeout(submitSharedLinkJoin, 0);
        } else {
          void loadHunts(signedIn, saved.value.displayName ?? name);
        }
      })
      .catch(() => {
        nameInput.disabled = false;
        providerStatus.hidden = false;
        providerStatus.textContent =
          "Could not save your display name. Try again.";
      });
  });

  accountNameEditToggle.addEventListener("click", () => {
    const opening = accountNameForm.hidden;
    accountNameForm.hidden = !opening;
    accountNameEditToggle.setAttribute("aria-expanded", String(opening));
    accountNameStatus.hidden = true;
    if (opening) {
      accountNameInput.value = currentNickname;
      accountNameInput.focus();
    }
  });

  accountNameForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const identity = activeIdentity ?? storedIdentity();
    const name = accountNameInput.value.trim();
    if (!identity || !name) return;
    const submitButton = accountNameForm.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    if (submitButton) submitButton.disabled = true;
    accountNameStatus.hidden = true;
    void repository
      .saveAccountProfile(name, identity)
      .then((saved) => {
        if (!saved.ok) {
          accountNameStatus.textContent = saved.message;
          accountNameStatus.hidden = false;
          return;
        }
        currentNickname = saved.value.displayName?.trim() || name;
        accountNameInput.value = currentNickname;
        displayName.textContent = `${currentNickname} (${currentRoleLabel})`;
        try {
          localStorage.setItem(
            `${PLAYER_PROFILE_KEY_PREFIX}${identity.accountId}`,
            currentNickname,
          );
        } catch {
          // The account profile is authoritative; browser storage is only a cache.
        }
        accountNameEditToggle.setAttribute("aria-expanded", "false");
        accountNameForm.hidden = true;
        accountNameStatus.textContent = "Display name updated.";
        accountNameStatus.hidden = false;
      })
      .catch(() => {
        accountNameStatus.textContent =
          "Could not save your display name. Try again.";
        accountNameStatus.hidden = false;
      })
      .finally(() => {
        if (submitButton) submitButton.disabled = false;
      });
  });

  googleSignIn.addEventListener("click", () => {
    void preparePlayerSignIn();
  });

  providerStatus.hidden = true;
  const previousIdentity = storedIdentity();
  if (previousIdentity) {
    void repository
      .getAccountProfile(previousIdentity)
      .then(async (profile) => {
        const serverName =
          profile.ok && typeof profile.value.displayName === "string"
            ? profile.value.displayName.trim()
            : "";
        if (serverName) {
          try {
            localStorage.setItem(
              `${PLAYER_PROFILE_KEY_PREFIX}${previousIdentity.accountId}`,
              serverName,
            );
          } catch {
            // The account profile is authoritative; browser storage is a cache.
          }
          void loadHunts(previousIdentity, serverName);
          return;
        }
        const legacyName = storedDisplayName(previousIdentity.accountId);
        if (legacyName) {
          const migrated = await repository.saveAccountProfile(
            legacyName,
            previousIdentity,
          );
          if (migrated.ok) {
            const name = migrated.value.displayName ?? legacyName;
            void loadHunts(previousIdentity, name);
            return;
          }
          // Keep signed-in behavior available if persistence is temporarily down.
          void loadHunts(previousIdentity, legacyName);
          return;
        }
        requestDisplayName(previousIdentity);
      })
      .catch(() => {
        const legacyName = storedDisplayName(previousIdentity.accountId);
        if (legacyName) void loadHunts(previousIdentity, legacyName);
        else requestDisplayName(previousIdentity);
      });
  } else showSignedOut("No tasks loaded.");

  const huntForm = root.querySelector<HTMLFormElement>(
    '[data-testid="player-hunt-form"]',
  );
  const huntInput = root.querySelector<HTMLInputElement>('[name="accessCode"]');
  const joinStatus = document.createElement("p");
  joinStatus.className = "player-hunt-join-status";
  joinStatus.dataset.testid = "player-hunt-join-status";
  joinStatus.setAttribute("role", "status");
  joinStatus.setAttribute("aria-live", "polite");
  huntForm?.after(joinStatus);
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
    const leaveHuntButton = document.createElement("button");
    leaveHuntButton.type = "button";
    leaveHuntButton.className = "action player-leave-hunt";
    leaveHuntButton.dataset.testid = "leave-hunt";
    leaveHuntButton.textContent = "Leave Hunt";
    const openLeaveConfirmation = (): void => {
      const identity = activeIdentity ?? storedIdentity();
      if (!selectedHuntId || !identity) return;
      const currentHuntName =
        displayedHunts.find((item) => item.id === selectedHuntId)?.name ??
        huntName.textContent?.trim() ??
        "this hunt";
      showLeaveConfirmation(selectedHuntId, currentHuntName);
    };
    leaveHuntButton.addEventListener("click", openLeaveConfirmation);
    async function leaveHunt(huntId: string, currentHuntName: string) {
      const identity = activeIdentity ?? storedIdentity();
      if (!identity || !leaveDialog || !confirmLeaveHunt) return;
      confirmLeaveHunt.disabled = true;
      leaveHuntStatus!.hidden = true;
      const result = await repository.leaveHunt(huntId, identity);
      if (!result.ok) {
        leaveHuntStatus!.textContent = result.message;
        leaveHuntStatus!.hidden = false;
        confirmLeaveHunt.disabled = false;
        return;
      }
      leaveDialog.close();
      closeDetails();
      await loadHunts(identity, currentNickname);
      status!.textContent = `You left ${currentHuntName}.`;
      confirmLeaveHunt.disabled = false;
    }
    function showLeaveConfirmation(huntId: string, name: string) {
      if (!leaveDialog || !leaveHuntName) return;
      leaveHuntName.textContent = name;
      leaveHuntStatus!.hidden = true;
      leaveHuntStatus!.textContent = "";
      leaveDialog.dataset.huntId = huntId;
      if (!leaveDialog.open) leaveDialog.showModal();
    }
    confirmLeaveHunt?.addEventListener("click", () => {
      const huntId = leaveDialog?.dataset.huntId;
      const huntName = leaveHuntName?.textContent ?? "this Hunt";
      if (huntId) void leaveHunt(huntId, huntName);
    });
    cancelLeaveHunt?.addEventListener("click", () => leaveDialog?.close());
    intro.append(huntName, huntDescription, huntStatus);
    huntDetails.append(leaveHuntButton);

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
    let stopKahoot: (() => void) | undefined;
    huntDetails.addEventListener("close", () => {
      stopKahoot?.();
      stopKahoot = undefined;
    });
    const loadHunt = async (huntId: string): Promise<void> => {
      stopKahoot?.();
      stopKahoot = undefined;
      huntDetails.querySelector('[data-testid="kahoot-player"]')?.remove();
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
        joinStatus.textContent = "Sign in with Google first.";
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
      mountPlayerIssues(huntDetails, hunt.id, identity);
      huntId = hunt.id;
      if (hunt.huntType === "kahoot") {
        huntName.textContent = hunt.name;
        huntDescription.textContent = hunt.description;
        if (hunt.organizationName)
          addFact("Organization", hunt.organizationName);
        huntStatus.textContent = "Kahoot Hunt";
        const panel = document.createElement("section");
        panel.dataset.testid = "kahoot-player";
        panel.className = "kahoot-panel";
        huntTasks.before(panel);
        stopKahoot = mountKahootPlayer(panel, hunt, identity, repository);
        return;
      }
      const now = Date.now();
      const phase = huntPhase(hunt, now);
      const completed = hunt.tasks.filter((task) => task.completed).length;
      huntName.textContent = hunt.name;
      if (hunt.organizationName) addFact("Organization", hunt.organizationName);
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
          hint.hidden = true;
          hint.id = `task-hint-${task.id}`;
          label.tabIndex = 0;
          label.setAttribute("role", "button");
          label.setAttribute("aria-expanded", "false");
          label.setAttribute("aria-controls", hint.id);
          const toggleHint = (): void => {
            hint.hidden = !hint.hidden;
            label.setAttribute("aria-expanded", String(!hint.hidden));
          };
          item.addEventListener("click", (event) => {
            if (
              (event.target as HTMLElement).closest(
                "button, input, select, textarea, a, form, .task-location",
              )
            )
              return;
            toggleHint();
          });
          label.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggleHint();
            }
          });
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
      joinStatus.textContent = "Joining Hunt...";
      try {
        const result = await repository.joinHunt(accessCode, identity);
        if (requestId !== huntRequest) return;
        if (!result.ok) {
          joinStatus.textContent = result.message;
          if (result.code === "unauthorized") void preparePlayerSignIn();
          return;
        }
        huntInput.value = "";
        joinStatus.textContent = "";
        await loadHunts(
          identity,
          storedDisplayName(identity.accountId) ?? identity.email,
        );
        if (isSharedLinkJoin) {
          joinStatus.textContent =
            "You joined the Hunt. It is now in your list.";
        } else {
          await loadHunt(result.value.huntId);
        }
      } catch {
        joinStatus.textContent = "The Hunt service could not be reached.";
      } finally {
        if (button) button.disabled = false;
      }
    });
    const openHuntFromCard = (target: EventTarget | null): void => {
      const element = target as HTMLElement | null;
      if (element?.closest(".player-leave-card")) {
        const card = element.closest<HTMLElement>(".player-hunt[data-hunt-id]");
        const hunt = displayedHunts.find(
          (item) => item.id === card?.dataset.huntId,
        );
        if (hunt) showLeaveConfirmation(hunt.id, hunt.name);
        return;
      }
      const card = element?.closest<HTMLElement>(".player-hunt[data-hunt-id]");
      if (card) void loadHunt(card.dataset.huntId ?? "");
    };
    categories.addEventListener("click", (event) => {
      openHuntFromCard(event.target);
    });
    categories.addEventListener("keydown", (event) => {
      if (
        event.target instanceof HTMLElement &&
        !event.target.closest(".player-leave-card") &&
        event.target.matches(".player-hunt-open") &&
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
    leaveDialog?.addEventListener("close", () => {
      delete leaveDialog.dataset.huntId;
      if (confirmLeaveHunt) confirmLeaveHunt.disabled = false;
    });
    const timer = window.setInterval(() => {
      if (!huntDetails.open) renderCategories();
    }, 1000);
    const organizationInvitationTimer = window.setInterval(() => {
      if (activeIdentity) void refreshOrganizationInvitations();
    }, 30_000);
    window.addEventListener(
      "pagehide",
      () => {
        window.clearInterval(timer);
        window.clearInterval(organizationInvitationTimer);
      },
      { once: true },
    );
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
      localStorage.removeItem(PLAYER_SESSION_KEY);
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

// Implementation for closing the player account menu when clicking outside it.
document.addEventListener("click", (event: MouseEvent) => {
  const target = event.target as Node;
  const playerDetails = document
    .querySelector(
      'details.player-account-menu, [data-testid="player-account-menu"]',
    )
    ?.closest("details");

  if (!playerDetails || !playerDetails.hasAttribute("open")) {
    return;
  }

  if (!playerDetails.contains(target)) {
    playerDetails.removeAttribute("open");
  }
});
}
