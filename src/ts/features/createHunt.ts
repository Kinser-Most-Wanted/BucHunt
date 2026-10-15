import type { HuntRepository } from "../foundation/contracts.js";
export function mountCreateHunt(
  root: HTMLElement,
  repository: HuntRepository,
): void {
  const form = root.querySelector<HTMLFormElement>('[data-testid="hunt-form"]');
  const status = root.querySelector<HTMLElement>('[data-testid="hunt-status"]');
  if (!form || !status) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fields = new FormData(form);
    const text = (key: string) => String(fields.get(key) ?? "").trim();
    const date = (key: string) =>
      text(key) ? new Date(text(key)).toISOString() : null;
    const button = form.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    if (button) button.disabled = true;
    status.textContent = "Saving hunt…";
    try {
      const result = await repository.createHunt({
        name: text("name"),
        description: text("description"),
        ownerId: "",
        beginsAt: date("beginsAt") ?? "",
        endsAt: date("endsAt"),
        taskOrderMode: text("taskOrderMode") === "any" ? "any" : "sequential",
      });
      if (!result.ok) {
        status.textContent = [
          result.message,
          ...(result.issues?.map(
            (issue) => `${issue.field}: ${issue.message}`,
          ) ?? []),
        ].join(" ");
        return;
      }
      status.textContent = `Hunt saved: ${result.value.name}. Hunt ID: ${result.value.id}`;
      const taskHunt = document.querySelector<HTMLInputElement>(
        '#define-task [name="huntId"]',
      );
      if (taskHunt) taskHunt.value = result.value.id;
      document
        .getElementById("define-task")
        ?.dispatchEvent(new Event("hunt-selected"));
      const link = root.querySelector<HTMLAnchorElement>(
        '[data-testid="hunt-player-link"]',
      );
      if (link) {
        link.href = `./player.html?huntId=${encodeURIComponent(result.value.id)}`;
        link.hidden = false;
      }
      form.reset();
    } catch {
      status.textContent =
        "Hunt could not be saved. Check the dates and try again.";
    } finally {
      if (button) button.disabled = false;
    }
  });
}
