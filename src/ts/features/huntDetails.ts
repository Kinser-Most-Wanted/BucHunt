import type {
  HuntDefinition,
  HuntRole,
  TaskDefinition,
} from "../foundation/types.js";
import { createHuntRepository, downloadHuntResults } from "./huntRepository.js";

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

function updateExportButtons(): void {
  for (const format of ["pdf", "csv"] as const) {
    const button = dialog?.querySelector<HTMLButtonElement>(
      `[data-testid="export-hunt-${format}"]`,
    );
    if (button) {
      button.hidden = !canExport;
      button.disabled = exporting || !activeHunt || !canExport;
    }
  }
}

for (const format of ["pdf", "csv"] as const) {
  dialog
    ?.querySelector<HTMLButtonElement>(`[data-testid="export-hunt-${format}"]`)
    ?.addEventListener("click", async () => {
      if (!activeHunt || !canExport || exporting) return;
      const huntId = activeHunt.id;
      const requestId = activeRequest;
      const status = dialog?.querySelector<HTMLElement>(
        '[data-testid="hunt-export-status"]',
      );
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
}

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
  activeHunt = undefined;
  canExport = false;
  updateExportButtons();
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
  canExport = role === "owner" || role === "officer";
  updateExportButtons();
  const contributorsPanel = dialog.querySelector<HTMLDetailsElement>(
    '[data-testid="contributors-panel"]',
  );
  if (contributorsPanel) {
    contributorsPanel.hidden = role !== "owner";
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
