import type {
  HuntBannedParticipant,
  HuntDefinition,
  HuntParticipationSummary,
  HuntParticipantProgress,
  HuntRole,
  TaskDefinition,
} from "../foundation/types.js";
import {
  createHuntRepository,
  downloadHuntResults,
  getCreatorSession,
  request,
} from "./huntRepository.js";
import { populateOrganizationSelect } from "./organizationManager.js";

import { mountKahootHost } from "./kahootHunt.js";
import { mountAdminIssues } from "./huntIssues.js";

let stopKahoot: (() => void) | undefined;
let stopIssues: (() => void) | undefined;
const dialog = document.querySelector<HTMLDialogElement>(
  '[data-testid="hunt-details-dialog"]',
);
const repository = createHuntRepository();
const copyAccessCodeButton = dialog?.querySelector<HTMLButtonElement>(
  '[data-testid="copy-hunt-access-code"]',
);
const copyAccessCodeStatus = dialog?.querySelector<HTMLElement>(
  '[data-testid="hunt-access-code-copy-status"]',
);
let activeRequest = 0;
let activeHunt: HuntDefinition | undefined;
let canExport = false;
let exporting = false;
let canViewProgress = false;
let participantRequest = 0;
let loadingParticipants = false;

function updateExportButtons(): void {
  const menu = dialog?.querySelector<HTMLDetailsElement>(
    '[data-testid="export-menu"]',
  );
  if (menu) menu.hidden = !canExport;
  dialog
    ?.querySelectorAll<HTMLButtonElement>("button[data-export-format]")
    .forEach((button) => {
      button.disabled = exporting || !activeHunt || !canExport;
    });
}

function updateParticipantControls(): void {
  const section = dialog?.querySelector<HTMLElement>(
    '[data-testid="participant-progress"]',
  );
  if (section) section.hidden = !canViewProgress;
  const button = dialog?.querySelector<HTMLButtonElement>(
    '[data-testid="refresh-participant-progress"]',
  );
  if (button) button.disabled = loadingParticipants || !canViewProgress;
  dialog
    ?.querySelectorAll<HTMLButtonElement>("[data-participant-action]")
    .forEach((control) => {
      control.disabled = loadingParticipants || !canViewProgress;
    });
}

function participantIcon(kind: "kick" | "ban"): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const paths =
    kind === "kick"
      ? ["M4 4h7l1 7 3 2 4 1.5 2 2V20H4l-1-2 1-3 1-1.5L4 4Z", "M8 7v4"]
      : ["M5 6l4-4 5 5-4 4z", "m10 10 9 9", "m16 15 3-3", "m18 19 3-3"];
  for (const data of paths) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", data);
    svg.append(path);
  }
  if (kind === "ban") {
    const slash = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    slash.setAttribute("d", "M4 20 20 4");
    slash.setAttribute("class", "participant-ban-slash");
    svg.append(slash);
  }
  return svg;
}

function renderParticipants(
  participants: HuntParticipantProgress[],
  summary: HuntParticipationSummary,
  currentCreatorId: string | null,
  bannedParticipants: HuntBannedParticipant[],
): void {
  const list = dialog?.querySelector<HTMLElement>(
    '[data-testid="participant-progress-list"]',
  );
  const empty = dialog?.querySelector<HTMLElement>(
    '[data-testid="participant-progress-empty"]',
  );
  const bannedList = dialog?.querySelector<HTMLElement>(
    '[data-testid="banned-participant-list"]',
  );
  const bannedEmpty = dialog?.querySelector<HTMLElement>(
    '[data-testid="banned-participant-empty"]',
  );
  if (!list || !empty || !bannedList || !bannedEmpty) return;
  for (const [testId, count] of [
    ["participant-active-count", summary.activeCount],
    ["participant-left-completed-count", summary.leftCompletedCount],
    ["participant-left-incomplete-count", summary.leftIncompleteCount],
  ] as const) {
    const output = dialog?.querySelector<HTMLElement>(
      `[data-testid="${testId}"]`,
    );
    if (output) output.textContent = String(count);
  }
  const fragment = document.createDocumentFragment();
  participants.forEach((participant, index) => {
    const card = document.createElement("li");
    card.className = "participant-progress-card";
    card.dataset.testid = "participant-progress-row";
    const heading = document.createElement("div");
    heading.className = "participant-progress-heading";
    const name = document.createElement("h4");
    name.textContent = participant.displayName?.trim() || `Player ${index + 1}`;
    const completed = participant.tasks.filter((task) => task.completed).length;
    const summary = document.createElement("span");
    summary.className = "participant-progress-summary";
    summary.textContent = participant.tasks.length
      ? `${completed} of ${participant.tasks.length} tasks complete`
      : "No tasks yet";
    heading.append(name, summary);
    const isCurrentCreator = participant.participantId === currentCreatorId;
    if (isCurrentCreator) {
      const selfBadge = document.createElement("span");
      selfBadge.className = "participant-self-badge";
      selfBadge.textContent = "You";
      heading.append(selfBadge);
    }
    card.append(heading);
    if (!isCurrentCreator) {
      const actions = document.createElement("div");
      actions.className = "participant-moderation-actions";
      for (const action of ["kick", "ban"] as const) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `participant-action-button is-${action}`;
        button.dataset.participantAction = action;
        button.dataset.participantId = participant.participantId;
        button.dataset.testid = `${action}-participant`;
        button.setAttribute(
          "aria-label",
          `${action === "kick" ? "Kick" : "Ban"} ${name.textContent} from hunt`,
        );
        button.title = action === "kick" ? "Kick from hunt" : "Ban from hunt";
        button.append(participantIcon(action));
        actions.append(button);
      }
      card.append(actions);
    }
    if (participant.tasks.length) {
      const tasks = document.createElement("ul");
      tasks.className = "participant-task-list";
      for (const task of participant.tasks) {
        const row = document.createElement("li");
        row.className = "participant-task-row";
        row.dataset.testid = "participant-task-row";
        const label = document.createElement("span");
        label.textContent = task.displayLabel;
        const status = document.createElement("span");
        status.className = `participant-task-status ${task.completed ? "is-complete" : "is-incomplete"}`;
        status.dataset.testid = "participant-task-status";
        status.textContent = task.completed ? "Completed" : "Incomplete";
        row.append(label, status);
        tasks.append(row);
      }
      card.append(tasks);
    }
    fragment.append(card);
  });
  list.replaceChildren(fragment);
  empty.hidden = participants.length !== 0;
  const bannedFragment = document.createDocumentFragment();
  bannedParticipants.forEach((participant, index) => {
    const row = document.createElement("li");
    row.className = "banned-participant-row";
    row.dataset.testid = "banned-participant-row";
    const name = document.createElement("span");
    name.textContent =
      participant.displayName?.trim() || `Banned player ${index + 1}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "participant-unban-button";
    button.dataset.participantAction = "unban";
    button.dataset.participantId = participant.participantId;
    button.dataset.testid = "unban-participant";
    button.setAttribute("aria-label", `Unban ${name.textContent}`);
    button.textContent = "Unban";
    row.append(name, button);
    bannedFragment.append(row);
  });
  bannedList.replaceChildren(bannedFragment);
  bannedEmpty.hidden = bannedParticipants.length !== 0;
}

async function loadParticipants(): Promise<void> {
  if (!activeHunt || !canViewProgress || loadingParticipants) return;
  const huntId = activeHunt.id;
  const requestId = activeRequest;
  const progressRequest = ++participantRequest;
  const status = dialog?.querySelector<HTMLElement>(
    '[data-testid="participant-progress-status"]',
  );
  loadingParticipants = true;
  updateParticipantControls();
  if (status) status.textContent = "Loading participant progress…";
  try {
    const [result, session] = await Promise.all([
      repository.getHuntParticipationProgress(huntId),
      getCreatorSession(),
    ]);
    if (
      requestId !== activeRequest ||
      progressRequest !== participantRequest ||
      !dialog?.open
    )
      return;
    if (!result.ok) {
      if (status) status.textContent = result.message;
      return;
    }
    renderParticipants(
      result.value,
      result.summary,
      session.ok ? session.value.id : null,
      result.bannedParticipants,
    );
    if (status) status.textContent = "Participant progress is up to date.";
  } finally {
    if (progressRequest === participantRequest) {
      loadingParticipants = false;
      updateParticipantControls();
    }
  }
}

dialog
  ?.querySelector<HTMLButtonElement>(
    '[data-testid="refresh-participant-progress"]',
  )
  ?.addEventListener("click", () => void loadParticipants());

dialog?.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLButtonElement>(
    "button[data-participant-action]",
  );
  const action = button?.dataset.participantAction;
  const participantId = button?.dataset.participantId;
  const huntId = activeHunt?.id;
  if (
    !button ||
    !huntId ||
    !participantId ||
    (action !== "kick" && action !== "ban" && action !== "unban") ||
    loadingParticipants ||
    !canViewProgress
  )
    return;
  const confirmation =
    action === "kick"
      ? "Kick this player from the hunt?"
      : action === "ban"
        ? "Ban this player from the hunt? They will not be able to rejoin."
        : "Unban this player from the hunt? They will be able to join again.";
  if (!window.confirm(confirmation)) return;
  const requestId = activeRequest;
  const status = dialog?.querySelector<HTMLElement>(
    '[data-testid="participant-progress-status"]',
  );
  loadingParticipants = true;
  updateParticipantControls();
  if (status) status.textContent = "Updating player access…";
  try {
    const result = await repository.moderateHuntParticipant(
      huntId,
      participantId,
      action,
    );
    if (requestId !== activeRequest || !dialog?.open) return;
    if (!result.ok) {
      if (status) status.textContent = result.message;
      return;
    }
    loadingParticipants = false;
    updateParticipantControls();
    await loadParticipants();
    if (status && requestId === activeRequest)
      status.textContent =
        action === "kick"
          ? "Player kicked from this hunt."
          : action === "ban"
            ? "Player banned from this hunt."
            : "Player unbanned and can join this hunt again.";
  } finally {
    if (requestId === activeRequest) {
      loadingParticipants = false;
      updateParticipantControls();
    }
  }
});

dialog
  ?.querySelectorAll<HTMLButtonElement>("button[data-export-format]")
  .forEach((button) => {
    button.addEventListener("click", async () => {
      const format = button.dataset.exportFormat;
      if (
        !activeHunt ||
        !canExport ||
        exporting ||
        (format !== "pdf" && format !== "csv")
      ) {
        return;
      }
      const huntId = activeHunt.id;
      const requestId = activeRequest;
      const status = dialog?.querySelector<HTMLElement>(
        '[data-testid="hunt-export-status"]',
      );
      const menu = button.closest<HTMLDetailsElement>(
        '[data-testid="export-menu"]',
      );
      if (menu) menu.open = false;
      exporting = true;
      updateExportButtons();
      if (status)
        status.textContent = `Preparing ${format.toUpperCase()} export…`;
      try {
        const result = await downloadHuntResults(huntId, format);
        if (status && activeRequest === requestId)
          status.textContent = result.ok
            ? `${format.toUpperCase()} export downloaded.`
            : result.message;
      } finally {
        exporting = false;
        updateExportButtons();
      }
    });
  });

copyAccessCodeButton?.addEventListener("click", async () => {
  const accessCode = activeHunt?.accessCode;
  if (!accessCode) return;
  try {
    await navigator.clipboard.writeText(accessCode);
    if (copyAccessCodeStatus) copyAccessCodeStatus.textContent = "Copied!";
  } catch {
    if (copyAccessCodeStatus)
      copyAccessCodeStatus.textContent = "Copy unavailable.";
  }
});

function addFact(list: HTMLElement, label: string, value: string): void {
  const item = document.createElement("div");
  item.className = "hunt-fact";
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  detail.textContent = value;
  item.append(term, detail);
  list.append(item);
}

function formatDate(value: string | null): string {
  if (!value) return "No end date";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not available"
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function renderTask(task: TaskDefinition): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "hunt-detail-task";
  const number = document.createElement("span");
  number.className = "task-order";
  number.textContent = String(task.order).padStart(2, "0");
  const content = document.createElement("div");
  content.className = "hunt-detail-task-content";
  const heading = document.createElement("h4");
  heading.textContent = task.displayLabel;
  const description = document.createElement("p");
  description.textContent = task.description;
  const answer = document.createElement("p");
  answer.className = "hunt-task-answer";
  answer.textContent = `Required answer: ${task.requiredAnswer}`;
  const meta = document.createElement("p");
  meta.className = "hunt-task-meta";
  meta.textContent = `${task.points} points · ${task.location.latitude.toFixed(4)}, ${task.location.longitude.toFixed(4)}`;
  content.append(heading, description, answer, meta);
  item.append(number, content);
  return item;
}

type DialogView = "manage" | "overview" | "editing";

function setDialogView(view: DialogView): void {
  if (!dialog) return;
  const manager = dialog.querySelector<HTMLElement>(
    '[data-testid="manage-hunts-view"]',
  );
  const overview = dialog.querySelector<HTMLElement>(
    '[data-testid="hunt-details-overview"]',
  );
  const editor = dialog.querySelector<HTMLElement>(
    '[data-testid="hunt-details-editor"]',
  );
  const mode = dialog.querySelector<HTMLElement>(
    '[data-testid="hunt-dialog-mode"]',
  );
  if (manager) manager.hidden = view !== "manage";
  if (overview) overview.hidden = view !== "overview";
  if (editor) editor.hidden = view !== "editing";
  if (mode)
    mode.textContent =
      view === "manage"
        ? "YOUR ADVENTURES"
        : view === "editing"
          ? "EDIT HUNT TASKS"
          : "HUNT OVERVIEW";
  const heading =
    view === "manage"
      ? "manage-hunts-title"
      : view === "editing"
        ? "hunt-edit-title"
        : "hunt-details-title";
  dialog.setAttribute("aria-labelledby", heading);
  if (view === "editing") window.dispatchEvent(new Event("resize"));
}

function setDetailView(editing: boolean): void {
  setDialogView(editing ? "editing" : "overview");
}

function resetDialog(): void {
  const settings = dialog?.querySelector<HTMLFormElement>(
    '[data-testid="hunt-settings-form"]',
  );
  if (settings) {
    settings.hidden = true;
    settings.onsubmit = null;
  }
  stopKahoot?.();
  stopIssues?.();
  activeHunt = undefined;
  canExport = false;
  canViewProgress = false;
  loadingParticipants = false;
  participantRequest++;
  updateExportButtons();
  updateParticipantControls();
  const exportStatus = dialog?.querySelector<HTMLElement>(
    '[data-testid="hunt-export-status"]',
  );
  if (exportStatus) exportStatus.textContent = "";
  setDetailView(false);
  const facts = dialog?.querySelector<HTMLElement>(
    '[data-testid="hunt-facts"]',
  );
  const creators = dialog?.querySelector<HTMLElement>(
    '[data-testid="hunt-creators"]',
  );
  const tasks = dialog?.querySelector<HTMLOListElement>(
    '[data-testid="hunt-detail-tasks"]',
  );
  facts?.replaceChildren();
  creators?.replaceChildren();
  tasks?.replaceChildren();
  dialog
    ?.querySelector<HTMLElement>('[data-testid="participant-progress-list"]')
    ?.replaceChildren();
  dialog
    ?.querySelector<HTMLElement>('[data-testid="banned-participant-list"]')
    ?.replaceChildren();
  const participantStatus = dialog?.querySelector<HTMLElement>(
    '[data-testid="participant-progress-status"]',
  );
  if (participantStatus) participantStatus.textContent = "";
  const participantEmpty = dialog?.querySelector<HTMLElement>(
    '[data-testid="participant-progress-empty"]',
  );
  if (participantEmpty) participantEmpty.hidden = true;
  const bannedParticipantEmpty = dialog?.querySelector<HTMLElement>(
    '[data-testid="banned-participant-empty"]',
  );
  if (bannedParticipantEmpty) bannedParticipantEmpty.hidden = true;
  for (const testId of [
    "participant-active-count",
    "participant-left-completed-count",
    "participant-left-incomplete-count",
  ]) {
    const output = dialog?.querySelector<HTMLElement>(
      `[data-testid="${testId}"]`,
    );
    if (output) output.textContent = "—";
  }
  const idOutput = dialog?.querySelector<HTMLOutputElement>(
    '[data-testid="hunt-detail-id"]',
  );
  if (idOutput) {
    idOutput.textContent = "";
    idOutput.hidden = true;
  }
  const toggle = dialog?.querySelector<HTMLButtonElement>(
    '[data-testid="hunt-id-toggle"]',
  );
  if (toggle) {
    toggle.textContent = "Reveal hunt ID";
    toggle.setAttribute("aria-expanded", "false");
  }
  const error = dialog?.querySelector<HTMLElement>(
    '[data-testid="hunt-detail-error"]',
  );
  if (error) {
    error.textContent = "";
    error.hidden = true;
  }
  const contributorsStatus = dialog?.querySelector<HTMLElement>(
    '[data-testid="contributors-load-status"]',
  );
  if (contributorsStatus) contributorsStatus.textContent = "";
  const contributorsPanel = dialog?.querySelector<HTMLDetailsElement>(
    '[data-testid="contributors-panel"]',
  );
  if (contributorsPanel) contributorsPanel.hidden = true;
  const taskSection = dialog?.querySelector<HTMLElement>(
    '[data-testid="hunt-tasks-section"]',
  );
  if (taskSection) taskSection.hidden = true;
  const editButton = dialog?.querySelector<HTMLButtonElement>(
    '[data-testid="edit-hunt-link"]',
  );
  if (editButton) editButton.hidden = true;
  const playerLink = dialog?.querySelector<HTMLAnchorElement>(
    '[data-testid="player-hunt-link"]',
  );
  if (playerLink) playerLink.hidden = true;
  const accessCodeSection =
    dialog?.querySelector<HTMLElement>(".hunt-access-code");
  if (accessCodeSection) accessCodeSection.hidden = true;
}

function renderHunt(hunt: HuntDefinition, role: HuntRole): void {
  if (!dialog) return;
  activeHunt = hunt;
  const settings = dialog.querySelector<HTMLFormElement>(
    '[data-testid="hunt-settings-form"]',
  );
  if (settings) {
    settings.hidden = role === "contributor";
    const organizationSelect = settings.elements.namedItem(
      "organizationId",
    ) as HTMLSelectElement;
    organizationSelect.disabled = role !== "owner";
    void populateOrganizationSelect(
      organizationSelect,
      undefined,
      hunt.organizationId ?? "",
    );
    (settings.elements.namedItem("maxParticipants") as HTMLInputElement).value =
      hunt.maxParticipants == null ? "" : String(hunt.maxParticipants);
    (
      settings.elements.namedItem("participationClosed") as HTMLInputElement
    ).checked = hunt.participationClosed ?? false;
    settings.onsubmit = async (event) => {
      event.preventDefault();
      const button = settings.querySelector<HTMLButtonElement>("button")!;
      const output = settings.querySelector<HTMLElement>(
        "[data-settings-status]",
      )!;
      button.disabled = true;
      const fields = new FormData(settings);
      const updates: Record<string, unknown> = {
        maxParticipants: String(fields.get("maxParticipants") ?? "").trim()
          ? Number(fields.get("maxParticipants"))
          : null,
        participationClosed: fields.has("participationClosed"),
      };
      if (role === "owner")
        updates.organizationId =
          String(fields.get("organizationId") ?? "") || null;
      const result = await request<HuntDefinition>(
        `/api/admin/hunts/${hunt.id}`,
        updates,
        "PATCH",
      );
      button.disabled = false;
      output.textContent = result.ok ? "Hunt settings saved." : result.message;
      if (result.ok && activeHunt?.id === hunt.id) {
        activeHunt = result.value;
        const teamPanel = dialog.querySelector<HTMLElement>(
          '[data-testid="contributors-panel"]',
        );
        if (teamPanel) teamPanel.hidden = Boolean(result.value.organizationId);
        document.dispatchEvent(new Event("buchunt:hunt-settings-saved"));
      }
    };
  }
  canExport = role === "owner" || role === "officer";
  canViewProgress = canExport;
  stopKahoot?.();
  stopIssues?.();
  stopIssues = mountAdminIssues(dialog, hunt.id, canExport);
  stopKahoot = mountKahootHost(dialog, hunt, canExport);
  updateExportButtons();
  updateParticipantControls();
  const contributorsPanel = dialog.querySelector<HTMLDetailsElement>(
    '[data-testid="contributors-panel"]',
  );
  if (contributorsPanel) {
    contributorsPanel.hidden = Boolean(hunt.organizationId);
    const management = contributorsPanel.querySelector<HTMLElement>(
      ".contributor-management",
    );
    if (management) management.hidden = role !== "owner";
    const creators =
      contributorsPanel.querySelector<HTMLElement>(".details-creators");
    if (creators) creators.hidden = role !== "owner";
    let permissions = contributorsPanel.querySelector<HTMLElement>(
      "[data-team-permissions]",
    );
    if (!permissions) {
      permissions = document.createElement("p");
      permissions.dataset.teamPermissions = "";
      contributorsPanel.append(permissions);
    }
    permissions.hidden = role === "owner";
    permissions.textContent =
      role === "officer"
        ? "As an Officer, you can create and edit hunt tasks. Only Owners can invite collaborators or change team roles."
        : "As a Contributor, you can view basic hunt details. Ask an Owner for Officer access to create or edit tasks. Only Owners can manage the team.";
    contributorsPanel.open = false;
  }
  const editButton = dialog.querySelector<HTMLButtonElement>(
    '[data-testid="edit-hunt-link"]',
  );
  if (editButton) editButton.hidden = role === "contributor";
  dialog.querySelector<HTMLElement>(
    '[data-testid="hunt-detail-name"]',
  )!.textContent = hunt.name;
  dialog.querySelector<HTMLElement>(
    '[data-testid="hunt-detail-description"]',
  )!.textContent = hunt.description || "A BucHunt adventure.";
  const idOutput = dialog.querySelector<HTMLOutputElement>(
    '[data-testid="hunt-detail-id"]',
  )!;
  idOutput.textContent = hunt.id;
  const toggle = dialog.querySelector<HTMLButtonElement>(
    '[data-testid="hunt-id-toggle"]',
  )!;
  toggle.onclick = () => {
    idOutput.hidden = !idOutput.hidden;
    toggle.setAttribute("aria-expanded", String(!idOutput.hidden));
    toggle.textContent = idOutput.hidden ? "Reveal hunt ID" : "Hide hunt ID";
  };
  const playerLink = dialog.querySelector<HTMLAnchorElement>(
    '[data-testid="player-hunt-link"]',
  )!;
  playerLink.hidden = role === "contributor";
  const encodedAccessCode = encodeURIComponent(hunt.accessCode ?? "");
  playerLink.href = `./player.html?accessCode=${encodedAccessCode}&autoJoin=1`;

  const facts = dialog.querySelector<HTMLElement>(
    '[data-testid="hunt-facts"]',
  )!;
  if (hunt.organizationName)
    addFact(facts, "Organization", hunt.organizationName);
  addFact(
    facts,
    "Hunt type",
    hunt.huntType === "kahoot" ? "Kahoot Hunt" : "Traditional Hunt",
  );
  addFact(facts, "Status", hunt.status);
  addFact(
    facts,
    "Task order",
    hunt.taskOrderMode === "sequential" ? "Sequential" : "Any order",
  );
  addFact(facts, "Begins", formatDate(hunt.beginsAt));
  addFact(facts, "Ends", formatDate(hunt.endsAt));
  addFact(facts, "Created", formatDate(hunt.createdAt));
  addFact(facts, "Last updated", formatDate(hunt.updatedAt));
  const accessCode = dialog.querySelector<HTMLElement>(
    '[data-testid="hunt-access-code"]',
  )!;
  accessCode.textContent = hunt.accessCode || "Not set";
  const accessCodeSection =
    accessCode.closest<HTMLElement>(".hunt-access-code");
  if (accessCodeSection) accessCodeSection.hidden = role === "contributor";
  if (copyAccessCodeButton) {
    copyAccessCodeButton.hidden = !hunt.accessCode;
    copyAccessCodeButton.setAttribute(
      "aria-label",
      hunt.accessCode ? "Copy access code" : "No access code to copy",
    );
  }
  if (copyAccessCodeStatus) copyAccessCodeStatus.textContent = "";
  const ownerLabel = dialog.querySelector<HTMLElement>(
    '[data-testid="hunt-owner"]',
  )!;
  ownerLabel.textContent =
    role === "owner"
      ? "You own this hunt"
      : role === "officer"
        ? "Officer access"
        : "Contributor access";

  const contributorsStatus = dialog.querySelector<HTMLElement>(
    '[data-testid="contributors-load-status"]',
  )!;
  if (role !== "owner") {
    contributorsStatus.textContent =
      role === "officer"
        ? "Officers can edit and create hunt tasks."
        : "Contributors can view basic hunt details. Ask a hunt owner for a promotion to edit.";
  }

  const taskList = dialog.querySelector<HTMLOListElement>(
    '[data-testid="hunt-detail-tasks"]',
  )!;
  const taskSection = dialog.querySelector<HTMLElement>(
    '[data-testid="hunt-tasks-section"]',
  );
  const emptyTasks = dialog.querySelector<HTMLElement>(
    '[data-testid="empty-tasks"]',
  )!;
  if (taskSection) taskSection.hidden = role === "contributor";
  for (const task of [...hunt.tasks].sort(
    (left, right) => left.order - right.order,
  )) {
    taskList.append(renderTask(task));
  }
  emptyTasks.hidden = hunt.tasks.length !== 0;
  dialog.querySelector<HTMLElement>(
    '[data-testid="hunt-detail-status"]',
  )!.textContent =
    role === "contributor"
      ? `Contributor access · basic hunt details · ${hunt.status}`
      : `${hunt.tasks.length} ${hunt.tasks.length === 1 ? "task" : "tasks"} · ${hunt.status}`;
  if (canViewProgress) void loadParticipants();
}

dialog
  ?.querySelector<HTMLButtonElement>('[data-testid="close-hunt-details"]')
  ?.addEventListener("click", () => dialog.close());
dialog
  ?.querySelector<HTMLButtonElement>('[data-testid="edit-hunt-link"]')
  ?.addEventListener("click", () => {
    const huntId = dialog.dataset.huntId;
    if (!huntId) return;
    setDetailView(true);
    document.dispatchEvent(
      new CustomEvent("hunt-details-edit", {
        detail: { huntId, tasks: activeHunt?.tasks },
      }),
    );
  });
dialog
  ?.querySelector<HTMLButtonElement>('[data-testid="back-to-hunt-details"]')
  ?.addEventListener("click", () => setDetailView(false));
dialog?.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

export async function openHuntDetails(
  huntId: string,
  role: HuntRole,
): Promise<void> {
  if (!dialog) return;
  const requestId = ++activeRequest;
  resetDialog();
  setDialogView("overview");
  dialog.dataset.huntId = huntId;
  dialog.querySelector<HTMLElement>(
    '[data-testid="hunt-detail-name"]',
  )!.textContent = "Loading hunt…";
  dialog.querySelector<HTMLElement>(
    '[data-testid="hunt-detail-status"]',
  )!.textContent = "Loading hunt details…";
  if (!dialog.open) dialog.showModal();
  try {
    const result = await repository.getAdminHunt(huntId);
    if (requestId !== activeRequest || !dialog.open) return;
    if (!result.ok) throw new Error(result.message);
    renderHunt(result.value, role);
  } catch (cause) {
    if (requestId !== activeRequest || !dialog.open) return;
    const error = dialog.querySelector<HTMLElement>(
      '[data-testid="hunt-detail-error"]',
    )!;
    error.textContent =
      cause instanceof Error
        ? cause.message
        : "Hunt details could not be loaded. Try again.";
    error.hidden = false;
    dialog.querySelector<HTMLElement>(
      '[data-testid="hunt-detail-status"]',
    )!.textContent = "";
  }
}
