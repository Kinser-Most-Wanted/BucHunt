import type { HuntDefinition, TaskDefinition } from "../foundation/types.js";
import { createHuntRepository } from "../foundation/adapters.js";
import { getCreatorSession, request } from "./huntRepository.js";

const parameters = new URLSearchParams(window.location.search);
const huntId = parameters.get("huntId")?.trim() ?? "";
const role = parameters.get("role");
const status = document.querySelector<HTMLElement>('[data-testid="hunt-detail-status"]')!;
const error = document.querySelector<HTMLElement>('[data-testid="hunt-detail-error"]')!;
const repository = createHuntRepository();

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
  const heading = document.createElement("h3");
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

function renderHunt(hunt: HuntDefinition): void {
  document.title = `${hunt.name} | BucHunt`;
  document.querySelector<HTMLElement>('[data-testid="hunt-detail-name"]')!.textContent = hunt.name;
  document.querySelector<HTMLElement>('[data-testid="hunt-detail-description"]')!.textContent = hunt.description || "A BucHunt adventure.";
  const idOutput = document.querySelector<HTMLOutputElement>('[data-testid="hunt-detail-id"]')!;
  idOutput.textContent = hunt.id;
  const toggle = document.querySelector<HTMLButtonElement>('[data-testid="hunt-id-toggle"]')!;
  toggle.addEventListener("click", () => {
    idOutput.hidden = !idOutput.hidden;
    toggle.setAttribute("aria-expanded", String(!idOutput.hidden));
    toggle.textContent = idOutput.hidden ? "Reveal hunt ID" : "Hide hunt ID";
  });
  document.querySelector<HTMLAnchorElement>('[data-testid="edit-hunt-link"]')!.href =
    `./admin.html?huntId=${encodeURIComponent(hunt.id)}`;
  document.querySelector<HTMLAnchorElement>('[data-testid="player-hunt-link"]')!.href =
    `./player.html?huntId=${encodeURIComponent(hunt.id)}`;

  const facts = document.querySelector<HTMLElement>('[data-testid="hunt-facts"]')!;
  addFact(facts, "Status", hunt.status);
  addFact(facts, "Task order", hunt.taskOrderMode === "sequential" ? "Sequential" : "Any order");
  addFact(facts, "Begins", formatDate(hunt.beginsAt));
  addFact(facts, "Ends", formatDate(hunt.endsAt));
  addFact(facts, "Created", formatDate(hunt.createdAt));
  addFact(facts, "Last updated", formatDate(hunt.updatedAt));
  addFact(facts, "Access code", hunt.accessCode ? hunt.accessCode : "Not set");

  const creators = document.querySelector<HTMLElement>('[data-testid="hunt-creators"]')!;
  const owner = document.createElement("li");
  owner.className = "creator-chip creator-owner";
  owner.textContent = `Owner · ${hunt.ownerId || "Creator information unavailable"}`;
  creators.append(owner);
  const contributorStatus = document.querySelector<HTMLElement>('[data-testid="contributors-load-status"]')!;
  if (role === "owner") {
    void request<string[]>(`/api/admin/hunts/${encodeURIComponent(hunt.id)}/contributors`).then(result => {
      if (!result.ok) {
        contributorStatus.textContent = result.message;
        return;
      }
      for (const creatorId of result.value) {
        const contributor = document.createElement("li");
        contributor.className = "creator-chip";
        contributor.textContent = `Contributor · ${creatorId}`;
        creators.append(contributor);
      }
      contributorStatus.textContent = result.value.length ? "" : "No contributors have been added yet.";
    });
  } else {
    contributorStatus.textContent = "Contributor details are visible to the hunt owner.";
  }

  const taskList = document.querySelector<HTMLOListElement>('[data-testid="hunt-detail-tasks"]')!;
  const emptyTasks = document.querySelector<HTMLElement>('[data-testid="empty-tasks"]')!;
  for (const task of [...hunt.tasks].sort((left, right) => left.order - right.order)) {
    taskList.append(renderTask(task));
  }
  emptyTasks.hidden = hunt.tasks.length !== 0;
  status.textContent = `${hunt.tasks.length} ${hunt.tasks.length === 1 ? "task" : "tasks"} · ${hunt.status}`;
}

async function initialize(): Promise<void> {
  if (!huntId) {
    error.textContent = "This page needs a hunt ID. Return to My hunts and select a hunt to continue.";
    error.hidden = false;
    status.textContent = "";
    return;
  }
  const creator = await getCreatorSession();
  if (!creator.ok) {
    error.textContent = creator.message;
    error.hidden = false;
    status.textContent = "";
    return;
  }
  const result = await repository.getAdminHunt(huntId);
  if (!result.ok) {
    error.textContent = result.message;
    error.hidden = false;
    status.textContent = "";
    return;
  }
  renderHunt(result.value);
}

void initialize().catch(() => {
  status.textContent = "";
  error.textContent = "Hunt details could not be loaded. Return to Hunt Studio and try again.";
  error.hidden = false;
});
export {};
