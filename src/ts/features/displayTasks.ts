import type { HuntRepository } from "../foundation/contracts.js";
export function mountDisplayTasks(
  root: HTMLElement,
  repository: HuntRepository,
): void {
  const form = root.querySelector<HTMLFormElement>("form");
  const input = root.querySelector<HTMLInputElement>('[name="huntId"]');
  const status = root.querySelector<HTMLElement>(
    '[data-testid="player-task-status"]',
  );
  const list = root.querySelector<HTMLElement>(
    '[data-testid="player-task-list"]',
  );
  if (!form || !input || !status || !list) return;
  let generation = 0;
  async function load(id: string): Promise<void> {
    const current = ++generation;
    list!.replaceChildren();
    status!.textContent = "Loading hunt…";
    try {
      const result = await repository.getPlayerHunt(id);
      if (current !== generation) return;
      if (!result.ok) {
        status!.textContent = result.message;
        return;
      }
      root.querySelector('[data-testid="player-hunt-name"]')!.textContent =
        result.value.name;
      status!.textContent = result.value.tasks.length
        ? `${result.value.tasks.length} tasks loaded.`
        : "This hunt has no tasks yet.";
      for (const task of result.value.tasks) {
        const item = document.createElement("li");
        item.dataset.testid = "player-task";
        const label = document.createElement("strong");
        label.textContent = task.displayLabel;
        const state = document.createElement("p");
        state.textContent = task.completed ? "Completed" : "Incomplete";
        item.append(label, state);
        if ("description" in task && typeof task.description === "string") {
          const description = document.createElement("p");
          description.textContent = task.description;
          item.append(description);
        }
        if (!task.completed) {
          const answerForm = document.createElement("form");
          const answerLabel = document.createElement("label");
          answerLabel.textContent = `Answer for ${task.displayLabel}`;
          const answer = document.createElement("input");
          answer.required = true;
          answerLabel.append(answer);
          const button = document.createElement("button");
          button.type = "submit";
          button.textContent = "Submit answer";
          const message = document.createElement("p");
          message.setAttribute("role", "status");
          answerForm.append(answerLabel, button, message);
          answerForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            button.disabled = true;
            try {
              const response = await fetch(
                `/api/player/hunts/${encodeURIComponent(id)}/tasks/${encodeURIComponent(task.id)}/answer`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ answer: answer.value }),
                },
              );
              const result = await response.json();
              if (!response.ok || !result.ok) {
                message.textContent =
                  result.message ?? "Answer could not be submitted.";
                return;
              }
              if (current === generation) await load(id);
            } catch {
              message.textContent = "The answer service could not be reached.";
            } finally {
              button.disabled = false;
            }
          });
          item.append(answerForm);
        }
        list!.append(item);
      }
    } catch {
      if (current === generation)
        status!.textContent = "The hunt service could not be reached.";
    }
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void load(input.value.trim());
  });
  const selected = new URLSearchParams(location.search).get("huntId");
  if (selected) {
    input.value = selected;
    void load(selected);
  }
}
