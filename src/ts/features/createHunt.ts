import type { HuntRepository } from "../foundation/contracts.js";
import { getCreatorSession, request } from "./huntRepository.js";
import { openHuntDetails } from "./huntDetails.js";
interface HuntSummary {
  id: string;
  name: string;
  role: "owner" | "contributor";
}

export function mountCreateHunt(
  root: HTMLElement,
  repository: HuntRepository,
): void {
  const form = root.querySelector<HTMLFormElement>('[data-testid="hunt-form"]');
  const status = root.querySelector<HTMLElement>('[data-testid="hunt-status"]');
  if (!form || !status) return;
  const profile = document.querySelector<HTMLElement>(
    '[data-testid="creator-id"]',
  )!;
  const workspaceStatus = document.querySelector<HTMLElement>(
    '[data-testid="creator-status"]',
  )!;
  const list = document.querySelector<HTMLElement>('[data-testid="my-hunts"]')!;
  const panel = document.querySelector<HTMLDetailsElement>(
    '[data-testid="contributors-panel"]',
  )!;
  const memberList = panel.querySelector<HTMLElement>(
    '[data-testid="contributor-list"]',
  )!;
  const memberStatus = panel.querySelector<HTMLElement>(
    '[data-testid="contributor-status"]',
  )!;
  const memberForm = panel.querySelector<HTMLFormElement>("form")!;
  const taskHunt = document.querySelector<HTMLInputElement>(
    '#define-task [name="huntId"]',
  )!;
  let selected: HuntSummary | undefined;
  let availableHunts: HuntSummary[] = [];
  let querySelectionApplied = false;
  const requestedHuntId = new URLSearchParams(window.location.search).get(
    "huntId",
  );

  async function renderContributors(): Promise<void> {
    if (!selected || selected.role !== "owner") return;
    const id = selected.id;
    const result = await request<string[]>(
      `/api/admin/hunts/${id}/contributors`,
    );
    if (selected?.id !== id) return;
    if (!result.ok) {
      memberStatus.textContent = result.message;
      return;
    }
    memberList.replaceChildren();
    for (const creatorId of result.value) {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = creatorId;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove contributor";
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        const result = await request<string[]>(
          `/api/admin/hunts/${id}/contributors/${encodeURIComponent(creatorId)}`,
          undefined,
          "DELETE",
        );
        if (selected?.id !== id) return;
        if (!result.ok) {
          memberStatus.textContent = result.message;
          remove.disabled = false;
          return;
        }
        memberStatus.textContent = "Contributor removed.";
        await renderContributors();
      });
      item.append(label, remove);
      memberList.append(item);
    }
  }
  function select(hunt: HuntSummary, loadTasks: boolean): void {
    selected = hunt;
    taskHunt.value = hunt.id;
    document
      .getElementById("define-task")
      ?.dispatchEvent(new Event("hunt-selected"));
    panel.hidden = hunt.role !== "owner";
    panel.open = hunt.role === "owner";
    memberList.replaceChildren();
    memberStatus.textContent = "";
    const link = root.querySelector<HTMLAnchorElement>(
      '[data-testid="hunt-player-link"]',
    );
    if (link) {
      link.hidden = true;
      void repository.getAdminHunt(hunt.id).then((result) => {
        if (selected?.id !== hunt.id || !result.ok || !result.value.accessCode)
          return;
        link.href = `./player.html?accessCode=${encodeURIComponent(result.value.accessCode)}`;
        link.hidden = false;
      });
    }
    if (loadTasks)
      document
        .querySelector<HTMLButtonElement>('[data-testid="load-admin-hunt"]')
        ?.click();
    if (hunt.role === "owner") void renderContributors();
  }
  document.addEventListener("hunt-details-edit", (event: Event) => {
    const huntId = (event as CustomEvent<{ huntId?: string }>).detail?.huntId;
    const hunt = availableHunts.find((item) => item.id === huntId);
    if (!hunt) return;
    select(hunt, true);
    document.getElementById("define-task")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });
  async function refresh(): Promise<void> {
    const session = await getCreatorSession();
    if (!session.ok) {
      workspaceStatus.textContent = session.message;
      return;
    }
    profile.textContent = session.value.id;
    const result = await request<HuntSummary[]>("/api/admin/hunts");
    if (!result.ok) {
      workspaceStatus.textContent = result.message;
      return;
    }
    availableHunts = result.value;
    list.replaceChildren();
    workspaceStatus.textContent = result.value.length
      ? "Choose a hunt to continue."
      : "No hunts yet. Create your first hunt below.";
    for (const hunt of result.value) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hunt-list-link";
      button.textContent = hunt.name;
      const role = document.createElement("span");
      role.textContent = `(${hunt.role})`;
      button.append(role);
      button.addEventListener("click", () => {
        void openHuntDetails(hunt.id, hunt.role);
      });
      item.append(button);
      list.append(item);
    }
    if (!querySelectionApplied && requestedHuntId) {
      const requestedHunt = result.value.find(
        (hunt) => hunt.id === requestedHuntId,
      );
      querySelectionApplied = true;
      if (requestedHunt) select(requestedHunt, true);
    }
    if (selected && !result.value.some((hunt) => hunt.id === selected?.id)) {
      selected = undefined;
      taskHunt.value = "";
      panel.hidden = true;
      document
        .getElementById("define-task")
        ?.dispatchEvent(new Event("hunt-selected"));
    }
  }
  document
    .querySelector('[data-testid="refresh-my-hunts"]')
    ?.addEventListener("click", () => {
      void refresh();
    });
  document
    .querySelector('[data-testid="copy-creator-id"]')
    ?.addEventListener("click", async () => {
      const session = await getCreatorSession();
      if (!session.ok) {
        workspaceStatus.textContent = session.message;
        return;
      }
      try {
        await navigator.clipboard.writeText(session.value.id);
        workspaceStatus.textContent = "Creator ID copied.";
      } catch {
        workspaceStatus.textContent = "Select and copy your creator ID above.";
      }
    });
  memberForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selected || selected.role !== "owner") return;
    const id = selected.id;
    const creatorId = String(
      new FormData(memberForm).get("creatorId") ?? "",
    ).trim();
    const button = memberForm.querySelector<HTMLButtonElement>("button")!;
    button.disabled = true;
    try {
      const result = await request<string[]>(
        `/api/admin/hunts/${id}/contributors`,
        { creatorId },
      );
      if (selected?.id !== id) return;
      if (!result.ok) {
        memberStatus.textContent = result.message;
        return;
      }
      memberStatus.textContent =
        "Contributor added. They can refresh My hunts to get started.";
      memberForm.reset();
      await renderContributors();
    } finally {
      button.disabled = false;
    }
  });
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
      status.textContent = `Hunt saved: ${result.value.name}. Add its tasks below.`;
      select(
        { id: result.value.id, name: result.value.name, role: "owner" },
        false,
      );
      form.reset();
      await refresh();
    } catch {
      status.textContent =
        "Hunt could not be saved. Check the dates and try again.";
    } finally {
      if (button) button.disabled = false;
    }
  });
  void refresh();
}
