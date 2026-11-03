import type { HuntRepository } from "../foundation/contracts.js";
import { getCreatorSession, request } from "./huntRepository.js";
import { openHuntDetails } from "./huntDetails.js";
interface HuntSummary {
  id: string;
  name: string;
  role: "owner" | "contributor";
  createdAt?: string;
  updatedAt?: string;
}
type HuntListFilter =
  | "recent-3"
  | "all"
  | "edited"
  | "created"
  | "name-asc"
  | "name-desc"
  | "owned"
  | "shared";

const huntFilterNotes: Record<HuntListFilter, string> = {
  "recent-3":
    "Showing the 3 most recently edited hunts. Choose a filter to browse more.",
  all: "Showing all hunts, most recently edited first.",
  edited: "Showing all hunts by last edit time.",
  created: "Showing all hunts by creation date.",
  "name-asc": "Showing all hunts from A to Z.",
  "name-desc": "Showing all hunts from Z to A.",
  owned: "Showing hunts you own, most recently edited first.",
  shared: "Showing hunts shared with you, most recently edited first.",
};

export function mountCreateHunt(
  root: HTMLElement,
  repository: HuntRepository,
): void {
  const form = root.querySelector<HTMLFormElement>('[data-testid="hunt-form"]');
  const status = root.querySelector<HTMLElement>('[data-testid="hunt-status"]');
  const createDialog = document.querySelector<HTMLDialogElement>(
    '[data-testid="create-hunt-dialog"]',
  );
  const manageDialog = document.querySelector<HTMLDialogElement>(
    '[data-testid="hunt-details-dialog"]',
  );
  const managerView = manageDialog?.querySelector<HTMLElement>(
    '[data-testid="manage-hunts-view"]',
  );
  const overviewView = manageDialog?.querySelector<HTMLElement>(
    '[data-testid="hunt-details-overview"]',
  );
  const editorView = manageDialog?.querySelector<HTMLElement>(
    '[data-testid="hunt-details-editor"]',
  );
  const mode = manageDialog?.querySelector<HTMLElement>(
    '[data-testid="hunt-dialog-mode"]',
  );
  if (!form || !status || !createDialog || !manageDialog || !managerView)
    return;
  const workspaceStatus = document.querySelector<HTMLElement>(
    '[data-testid="creator-status"]',
  )!;
  const list = document.querySelector<HTMLElement>('[data-testid="my-hunts"]')!;
  const listFilter = manageDialog.querySelector<HTMLSelectElement>(
    '[data-testid="manage-hunts-filter"]',
  )!;
  const listFilterNote = manageDialog.querySelector<HTMLElement>(
    '[data-testid="manage-hunts-filter-note"]',
  )!;
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
  const selector = document.querySelector<HTMLSelectElement>(
    '[data-testid="edit-hunt-selector"]',
  )!;
  const detailsActions =
    manageDialog.querySelector<HTMLElement>(".details-actions");
  const deleteHuntButton = document.createElement("button");
  deleteHuntButton.type = "button";
  deleteHuntButton.className = "action delete-hunt-button";
  deleteHuntButton.dataset.testid = "delete-hunt";
  deleteHuntButton.textContent = "Delete Hunt";
  deleteHuntButton.hidden = true;
  detailsActions?.append(deleteHuntButton);
  const editTitle = document.querySelector<HTMLElement>("#hunt-edit-title")!;
  let selected: HuntSummary | undefined;
  let availableHunts: HuntSummary[] = [];
  const huntRowHeight = 76;
  const huntWindowOverscan = 5;
  let renderedHuntWindow = "";
  let filteredHunts: HuntSummary[] = [];
  let huntsLoaded = false;
  let refreshInFlight: Promise<void> | undefined;
  let huntSelectorSignature = "";
  let querySelectionApplied = false;
  const requestedHuntId = new URLSearchParams(window.location.search).get(
    "huntId",
  );

  function populateHuntSelector(): void {
    const signature = JSON.stringify(
      availableHunts.map(({ id, name, role }) => [id, name, role]),
    );
    if (signature !== huntSelectorSignature) {
      const options = document.createDocumentFragment();
      for (const hunt of availableHunts) {
        const option = document.createElement("option");
        option.value = hunt.id;
        option.textContent = `${hunt.name} (${hunt.role})`;
        options.append(option);
      }
      selector.replaceChildren(options);
      huntSelectorSignature = signature;
    }
    selector.value = selected?.id ?? "";
  }

  function showManagerView(): void {
    if (overviewView) overviewView.hidden = true;
    if (editorView) editorView.hidden = true;
    managerView!.hidden = false;
    if (mode) mode.textContent = "YOUR ADVENTURES";
    manageDialog!.setAttribute("aria-labelledby", "manage-hunts-title");
    if (!manageDialog!.open) manageDialog!.showModal();
    renderHuntWindow(true);
    if (!huntsLoaded) void refresh();
  }

  function sortByEdited(hunts: HuntSummary[]): HuntSummary[] {
    return hunts.sort(
      (left, right) =>
        Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? ""),
    );
  }

  function updateFilteredHunts(reset = true): void {
    const mode = listFilter.value as HuntListFilter;
    let matching = [...availableHunts];
    switch (mode) {
      case "recent-3":
      case "all":
      case "edited":
        matching = sortByEdited(matching);
        if (mode === "recent-3") matching = matching.slice(0, 3);
        break;
      case "created":
        matching.sort(
          (left, right) =>
            Date.parse(right.createdAt ?? "") -
            Date.parse(left.createdAt ?? ""),
        );
        break;
      case "name-asc":
        matching.sort((left, right) => left.name.localeCompare(right.name));
        break;
      case "name-desc":
        matching.sort((left, right) => right.name.localeCompare(left.name));
        break;
      case "owned":
        matching = sortByEdited(
          matching.filter((hunt) => hunt.role === "owner"),
        );
        break;
      case "shared":
        matching = sortByEdited(
          matching.filter((hunt) => hunt.role === "contributor"),
        );
        break;
    }
    filteredHunts = matching;
    listFilterNote.textContent = huntFilterNotes[mode];
    if (availableHunts.length && !matching.length)
      listFilterNote.textContent = "No hunts match this filter.";
    renderHuntWindow(reset);
  }

  function renderHuntWindow(reset = false): void {
    if (reset) {
      manageDialog.scrollTop = 0;
      renderedHuntWindow = "";
    }
    const listTop =
      list.getBoundingClientRect().top -
      manageDialog.getBoundingClientRect().top +
      manageDialog.scrollTop;
    const firstVisible = Math.max(
      0,
      Math.floor((manageDialog.scrollTop - listTop) / huntRowHeight),
    );
    const lastVisible = Math.max(
      0,
      Math.ceil(
        (manageDialog.scrollTop + manageDialog.clientHeight - listTop) /
          huntRowHeight,
      ),
    );
    const start = Math.max(0, firstVisible - huntWindowOverscan);
    const end = Math.min(
      filteredHunts.length,
      lastVisible + huntWindowOverscan,
    );
    const windowKey = `${start}:${end}`;
    if (windowKey === renderedHuntWindow) return;
    renderedHuntWindow = windowKey;
    const fragment = document.createDocumentFragment();
    const spacer = (rows: number): HTMLLIElement => {
      const item = document.createElement("li");
      item.className = "hunt-list-spacer";
      item.setAttribute("aria-hidden", "true");
      item.style.height = `${rows * huntRowHeight}px`;
      return item;
    };
    if (start > 0) fragment.append(spacer(start));
    for (const hunt of filteredHunts.slice(start, end)) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hunt-list-link";
      button.textContent = hunt.name;
      const role = document.createElement("span");
      role.textContent = `(${hunt.role})`;
      button.append(role);
      button.addEventListener("click", () => {
        select(hunt);
        void openHuntDetails(hunt.id, hunt.role).then(() => {
          if (selected?.id === hunt.id && hunt.role === "owner")
            void renderContributors();
        });
      });
      item.append(button);
      fragment.append(item);
    }
    if (end < filteredHunts.length)
      fragment.append(spacer(filteredHunts.length - end));
    list.replaceChildren(fragment);
  }
  manageDialog.addEventListener("scroll", () => renderHuntWindow(), {
    passive: true,
  });
  listFilter.addEventListener("change", () => updateFilteredHunts());

  async function renderContributors(): Promise<void> {
    if (!selected || selected.role !== "owner") return;
    const id = selected.id;
    const creators = manageDialog!.querySelector<HTMLElement>(
      '[data-testid="hunt-creators"]',
    );
    const contributorsStatus = manageDialog!.querySelector<HTMLElement>(
      '[data-testid="contributors-load-status"]',
    );
    if (contributorsStatus)
      contributorsStatus.textContent = "Loading contributors…";
    const result = await request<string[]>(
      `/api/admin/hunts/${encodeURIComponent(id)}/contributors`,
    );
    if (selected?.id !== id) return;
    if (!result.ok) {
      memberStatus.textContent = result.message;
      if (contributorsStatus) contributorsStatus.textContent = result.message;
      return;
    }
    memberList.replaceChildren();
    creators?.replaceChildren();
    for (const creatorId of result.value) {
      const invitation = creatorId.startsWith("invite:");
      const identifier = invitation
        ? creatorId.slice("invite:".length)
        : creatorId;
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = invitation
        ? `Invitation pending · ${identifier}`
        : "Google account contributor";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = invitation
        ? "Cancel invitation"
        : "Remove contributor";
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
        memberStatus.textContent = invitation
          ? "Invitation canceled."
          : "Contributor removed.";
        await renderContributors();
      });
      item.append(label, remove);
      memberList.append(item);
      const chip = document.createElement("li");
      chip.className = "creator-chip";
      chip.textContent = invitation
        ? `Invitation pending · ${identifier}`
        : "Contributor · Google account";
      creators?.append(chip);
    }
    if (contributorsStatus) {
      contributorsStatus.textContent = result.value.length
        ? ""
        : "No contributors have been added yet.";
    }
  }
  function select(hunt: HuntSummary): void {
    selected = hunt;
    deleteHuntButton.hidden = hunt.role !== "owner";
    taskHunt.value = hunt.id;
    editTitle.textContent = "Editing " + hunt.name;
    document
      .getElementById("define-task")
      ?.dispatchEvent(new Event("hunt-selected"));
    panel.hidden = false;
    panel.open = false;
    memberForm.hidden = hunt.role !== "owner";
    memberList.replaceChildren();
    memberStatus.textContent = "";
  }
  deleteHuntButton.addEventListener("click", async () => {
    if (!selected || selected.role !== "owner") return;
    const hunt = selected;
    const confirmation = window.prompt(
      `Permanently delete “${hunt.name}”? Type the hunt name to confirm.`,
    );
    if (confirmation !== hunt.name) return;
    deleteHuntButton.disabled = true;
    workspaceStatus.textContent = `Deleting ${hunt.name}…`;
    try {
      const result = await repository.deleteHunt(hunt.id, confirmation);
      if (selected?.id !== hunt.id) return;
      if (!result.ok) {
        workspaceStatus.textContent = result.message;
        return;
      }
      selected = undefined;
      taskHunt.value = "";
      managerView.hidden = false;
      if (overviewView) overviewView.hidden = true;
      if (editorView) editorView.hidden = true;
      if (mode) mode.textContent = "YOUR ADVENTURES";
      manageDialog.setAttribute("aria-labelledby", "manage-hunts-title");
      await refresh();
      workspaceStatus.textContent = `${hunt.name} was deleted.`;
    } finally {
      deleteHuntButton.disabled = false;
    }
  });
  document.addEventListener("hunt-details-edit", (event: Event) => {
    const detail = (
      event as CustomEvent<{ huntId?: string; tasks?: unknown[] }>
    ).detail;
    const hunt = availableHunts.find((item) => item.id === detail?.huntId);
    if (!hunt) return;
    select(hunt);
    document.getElementById("define-task")?.dispatchEvent(
      new CustomEvent("load-hunt-tasks", {
        detail: { tasks: detail.tasks, huntName: hunt.name },
      }),
    );
  });
  async function loadHunts(): Promise<void> {
    const session = await getCreatorSession();
    if (!session.ok) {
      workspaceStatus.textContent = session.message;
      return;
    }
    const result = await request<HuntSummary[]>("/api/admin/hunts");
    if (!result.ok) {
      workspaceStatus.textContent = result.message;
      return;
    }
    availableHunts = result.value;
    huntsLoaded = true;
    updateFilteredHunts();
    workspaceStatus.textContent = result.value.length
      ? ""
      : "No hunts yet. Create one to get started.";
    populateHuntSelector();
    if (!querySelectionApplied && requestedHuntId) {
      const requestedHunt = result.value.find(
        (hunt) => hunt.id === requestedHuntId,
      );
      querySelectionApplied = true;
      if (requestedHunt) {
        select(requestedHunt);
        void openHuntDetails(requestedHunt.id, requestedHunt.role).then(() => {
          document
            .querySelector<HTMLButtonElement>('[data-testid="edit-hunt-link"]')
            ?.click();
        });
      }
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
  async function refresh(): Promise<void> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = loadHunts();
    try {
      await refreshInFlight;
    } finally {
      refreshInFlight = undefined;
    }
  }
  document
    .querySelector('[data-testid="open-create-hunt"]')
    ?.addEventListener("click", () => createDialog.showModal());
  document
    .querySelector('[data-testid="close-create-hunt"]')
    ?.addEventListener("click", () => createDialog.close());
  document
    .querySelector('[data-testid="open-manage-hunts"]')
    ?.addEventListener("click", showManagerView);
  document
    .querySelector('[data-testid="back-to-manage-hunts"]')
    ?.addEventListener("click", showManagerView);
  document
    .querySelector('[data-testid="refresh-my-hunts"]')
    ?.addEventListener("click", () => {
      void refresh();
    });
  selector.addEventListener("change", async () => {
    const hunt = availableHunts.find((item) => item.id === selector.value);
    if (!hunt) return;
    await openHuntDetails(hunt.id, hunt.role);
    document
      .querySelector<HTMLButtonElement>('[data-testid="edit-hunt-link"]')
      ?.click();
  });
  memberForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selected || selected.role !== "owner") return;
    const id = selected.id;
    const email = String(new FormData(memberForm).get("email") ?? "")
      .trim()
      .toLowerCase();
    const button = memberForm.querySelector<HTMLButtonElement>("button")!;
    button.disabled = true;
    try {
      const result = await request<string[]>(
        `/api/admin/hunts/${id}/contributors`,
        { email },
      );
      if (selected?.id !== id) return;
      if (!result.ok) {
        memberStatus.textContent = result.message;
        return;
      }
      memberStatus.textContent = `Invitation saved for ${email}. They can access this Hunt Studio after signing in with Google.`;
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
      status.textContent = `Hunt saved: ${result.value.name}. Open Manage Hunts to add tasks or edit details.`;
      select({ id: result.value.id, name: result.value.name, role: "owner" });
      huntsLoaded = false;
      form.reset();
      createDialog.close();
      showManagerView();
    } catch {
      status.textContent =
        "Hunt could not be saved. Check the dates and try again.";
    } finally {
      if (button) button.disabled = false;
    }
  });
  if (requestedHuntId) void refresh();
}
