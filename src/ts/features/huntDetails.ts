import type { HuntDefinition, TaskDefinition } from "../foundation/types.js";
import {
  createHuntRepository,
  getCreatorSession,
  request,
} from "./huntRepository.js";

const dialog = document.querySelector<HTMLDialogElement>(
  '[data-testid="hunt-details-dialog"]',
);
const repository = createHuntRepository();
let activeRequest = 0;
let activeHunt: HuntDefinition | undefined;

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
}

function renderHunt(hunt: HuntDefinition, role: "owner" | "contributor"): void {
  if (!dialog) return;
  activeHunt = hunt;
  const contributorsPanel = dialog.querySelector<HTMLDetailsElement>(
    '[data-testid="contributors-panel"]',
  );
  if (contributorsPanel) {
    contributorsPanel.hidden = false;
    contributorsPanel.open = false;
  }
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
  const accessCode = encodeURIComponent(hunt.accessCode ?? "");
  playerLink.href = `./player.html?accessCode=${accessCode}&autoJoin=1`;

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
  const ownerLabel = dialog.querySelector<HTMLElement>(
    '[data-testid="hunt-owner"]',
  )!;
  ownerLabel.textContent = `Owner · ${hunt.ownerId || "Creator information unavailable"}`;

  const creators = dialog.querySelector<HTMLElement>(
    '[data-testid="hunt-creators"]',
  )!;
  const contributorsStatus = dialog.querySelector<HTMLElement>(
    '[data-testid="contributors-load-status"]',
  )!;
  if (role === "owner") {
    void request<string[]>(
      `/api/admin/hunts/${encodeURIComponent(hunt.id)}/contributors`,
    ).then((result) => {
      if (!dialog.open || dialog.dataset.huntId !== hunt.id) return;
      if (!result.ok) {
        contributorsStatus.textContent = result.message;
        return;
      }
      for (const creatorId of result.value) {
        const contributor = document.createElement("li");
        contributor.className = "creator-chip";
        contributor.textContent = `Contributor · ${creatorId}`;
        creators.append(contributor);
      }
      contributorsStatus.textContent = result.value.length
        ? ""
        : "No contributors have been added yet.";
    });
  } else {
    contributorsStatus.textContent =
      "Contributor details are visible to the hunt owner.";
  }

  const taskList = dialog.querySelector<HTMLOListElement>(
    '[data-testid="hunt-detail-tasks"]',
  )!;
  const emptyTasks = dialog.querySelector<HTMLElement>(
    '[data-testid="empty-tasks"]',
  )!;
  for (const task of [...hunt.tasks].sort(
    (left, right) => left.order - right.order,
  )) {
    taskList.append(renderTask(task));
  }
  emptyTasks.hidden = hunt.tasks.length !== 0;
  dialog.querySelector<HTMLElement>(
    '[data-testid="hunt-detail-status"]',
  )!.textContent =
    `${hunt.tasks.length} ${hunt.tasks.length === 1 ? "task" : "tasks"} · ${hunt.status}`;
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
  role: "owner" | "contributor",
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
    const creator = await getCreatorSession();
    if (!creator.ok) throw new Error(creator.message);
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
