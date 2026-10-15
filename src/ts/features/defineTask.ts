import type { HuntRepository } from "../foundation/contracts.js";
import type { TaskDefinition, TaskInput } from "../foundation/types.js";

function field<T extends HTMLInputElement | HTMLTextAreaElement>(
  form: HTMLFormElement,
  name: string,
): T | null {
  return form.querySelector<T>(`[name="${name}"]`);
}

function showIssues(root: HTMLElement, messages: string[]): void {
  const list = root.querySelector<HTMLUListElement>(
    '[data-testid="validation-errors"]',
  );
  if (!list) return;
  list.replaceChildren();
  for (const message of messages) {
    const item = document.createElement("li");
    item.textContent = message;
    list.append(item);
  }
}

function renderTasks(root: HTMLElement, tasks: TaskDefinition[]): void {
  const list = root.querySelector<HTMLOListElement>(
    '[data-testid="defined-task-list"]',
  );
  if (!list) return;
  list.replaceChildren();
  for (const task of [...tasks].sort((left, right) => left.order - right.order)) {
    const item = document.createElement("li");
    item.className = "defined-task";
    const order = document.createElement("span");
    order.className = "task-order";
    order.textContent = String(task.order).padStart(2, "0");
    const content = document.createElement("span");
    content.className = "task-summary";
    const label = document.createElement("strong");
    label.textContent = task.displayLabel;
    const description = document.createElement("span");
    description.textContent = task.description;
    content.append(label, description);
    item.append(order, content);
    list.append(item);
  }
}

export function mountDefineTask(
  root: HTMLElement,
  repository: HuntRepository,
): void {
  root.dataset.feature = "defineTask";
  const form = root.querySelector<HTMLFormElement>(
    '[data-testid="task-form"]',
  );
  const status = root.querySelector<HTMLElement>(
    '[data-testid="task-status"]',
  );
  if (!form || !status) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showIssues(root, []);

    const huntId = field<HTMLInputElement>(form, "huntId")?.value.trim() ?? "";
    const displayLabel =
      field<HTMLInputElement>(form, "displayLabel")?.value.trim() ?? "";
    const description =
      field<HTMLTextAreaElement>(form, "description")?.value.trim() ?? "";
    const requiredAnswer =
      field<HTMLInputElement>(form, "requiredAnswer")?.value.trim() ?? "";
    const latitudeValue = field<HTMLInputElement>(form, "latitude")?.value ?? "";
    const longitudeValue =
      field<HTMLInputElement>(form, "longitude")?.value ?? "";
    const orderValue = field<HTMLInputElement>(form, "order")?.value ?? "";
    const pointsValue = field<HTMLInputElement>(form, "points")?.value ?? "0";
    const hintValue = field<HTMLInputElement>(form, "hint")?.value.trim() ?? "";
    const answerCaseSensitive =
      field<HTMLInputElement>(form, "answerCaseSensitive")?.checked ?? false;

    const latitude = Number(latitudeValue);
    const longitude = Number(longitudeValue);
    const order = Number(orderValue);
    const points = Number(pointsValue);
    const issues: string[] = [];
    if (!huntId) issues.push("Enter the hunt ID for this task.");
    if (!displayLabel) issues.push("Enter a display label.");
    if (!description) issues.push("Enter the clue and instructions.");
    if (!requiredAnswer) issues.push("Enter the required answer.");
    if (
      latitudeValue === "" ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90
    )
      issues.push("Latitude must be a number from -90 to 90.");
    if (
      longitudeValue === "" ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    )
      issues.push("Longitude must be a number from -180 to 180.");
    if (!Number.isInteger(order) || order < 1)
      issues.push("Task order must be a whole number of at least 1.");
    if (!Number.isInteger(points) || points < 0)
      issues.push("Points must be a whole number of 0 or more.");
    if (issues.length) {
      showIssues(root, issues);
      status.textContent = "Check the highlighted task details and try again.";
      return;
    }

    const task: TaskInput = {
      displayLabel,
      description,
      requiredAnswer,
      location: { latitude, longitude },
      order,
      answerCaseSensitive,
      hint: hintValue || null,
      points,
    };
    const button = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    if (button) button.disabled = true;
    status.textContent = "Saving task…";
    try {
      const saved = await repository.addTask(huntId, task);
      if (!saved.ok) {
        showIssues(
          root,
          saved.issues?.map((issue) => issue.message) ?? [saved.message],
        );
        status.textContent = "Task was not saved.";
        return;
      }

      status.textContent = "Task saved. Refreshing the hunt task list…";
      const result = await repository.getAdminHunt(huntId);
      if (result.ok) {
        renderTasks(root, result.value.tasks);
        status.textContent =
          `“${saved.value.displayLabel}” was saved and appears in this hunt’s task list.`;
        form.reset();
        const pointsInput = field<HTMLInputElement>(form, "points");
        const orderInput = field<HTMLInputElement>(form, "order");
        if (pointsInput) pointsInput.value = "0";
        if (orderInput) orderInput.value = String(result.value.tasks.length + 1);
        const huntInput = field<HTMLInputElement>(form, "huntId");
        if (huntInput) huntInput.value = huntId;
      } else {
        status.textContent =
          `Task was saved, but the updated hunt list could not be loaded: ${result.message}`;
      }
    } catch {
      status.textContent = "The task service could not be reached. Try again.";
    } finally {
      if (button) button.disabled = false;
    }
  });
}
