import type { HuntRepository } from "../foundation/contracts.js";
import type { HuntRole } from "../foundation/types.js";
import { getCreatorSession, request } from "./huntRepository.js";
import { openHuntDetails } from "./huntDetails.js";
interface HuntSummary {
  id: string;
  name: string;
  role: HuntRole;
  createdAt?: string;
  updatedAt?: string;
}
interface HuntContributor {
  id: string;
  role: HuntRole;
  pending: boolean;
  originalOwner: boolean;
  email?: string;
  displayName?: string;
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
  const listSearch = manageDialog.querySelector<HTMLInputElement>(
    '[data-testid="manage-hunts-search"]',
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
  const deleteDialog = document.querySelector<HTMLDialogElement>(
    '[data-testid="delete-hunt-dialog"]',
  )!;
  const deleteForm = deleteDialog.querySelector<HTMLFormElement>(
    '[data-testid="delete-hunt-form"]',
  )!;
  const deleteName = deleteDialog.querySelector<HTMLElement>(
    '[data-testid="delete-hunt-name"]',
  )!;
  const deleteNameInput = deleteDialog.querySelector<HTMLInputElement>(
    '[data-testid="delete-hunt-name-input"]',
  )!;
  const confirmDeleteButton = deleteDialog.querySelector<HTMLButtonElement>(
    '[data-testid="confirm-delete-hunt"]',
  )!;
  const deleteStatus = deleteDialog.querySelector<HTMLElement>(
    '[data-testid="delete-hunt-status"]',
  )!;
  const editTitle = document.querySelector<HTMLElement>("#hunt-edit-title")!;
  let selected: HuntSummary | undefined;
  let pendingDelete: HuntSummary | undefined;
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
    const query = listSearch.value.trim().toLocaleLowerCase();
    let matching = [...availableHunts];
    switch (mode) {
      case "recent-3":
      case "all":
      case "edited":
        matching = sortByEdited(matching);
        if (mode === "recent-3" && !query) matching = matching.slice(0, 3);
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
          matching.filter((hunt) => hunt.role !== "owner"),
        );
        break;
    }
    if (query)
      matching = matching.filter((hunt) =>
        hunt.name.toLocaleLowerCase().includes(query),
      );
    filteredHunts = matching;
    const filterDescription =
      query && mode === "recent-3"
        ? "Showing matches ordered by last edit."
        : huntFilterNotes[mode];
    listFilterNote.textContent = query
      ? `${matching.length} ${matching.length === 1 ? "hunt" : "hunts"} found. ${filterDescription}`
      : filterDescription;
    if (availableHunts.length && !matching.length)
      listFilterNote.textContent = query
        ? "No hunts match your search and filter."
        : "No hunts match this filter.";
    renderHuntWindow(reset);
  }

  function renderHuntWindow(reset = false): void {
    const dialog = manageDialog!;
    if (reset) {
      dialog.scrollTop = 0;
      renderedHuntWindow = "";
    }
    const listTop =
      list.getBoundingClientRect().top -
      dialog.getBoundingClientRect().top +
      dialog.scrollTop;
    const firstVisible = Math.max(
      0,
      Math.floor((dialog.scrollTop - listTop) / huntRowHeight),
    );
    const lastVisible = Math.max(
      0,
      Math.ceil(
        (dialog.scrollTop + dialog.clientHeight - listTop) / huntRowHeight,
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
  listSearch.addEventListener("input", () => updateFilteredHunts());

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
    const result = await request<HuntContributor[]>(
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
    const session = await getCreatorSession();
    if (selected?.id !== id) return;
    for (const contributor of result.value) {
      const invitation = contributor.pending;
      const creatorId = contributor.id;
      const isSelf = session.ok && session.value.id === creatorId;
      const identifier = invitation ? creatorId.slice("invite:".length) : "";
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = contributor.originalOwner
        ? `Original hunt owner · ${contributor.displayName ?? "Display name not set"}`
        : invitation
          ? `Invitation pending · ${identifier} · Contributor`
          : `${contributor.email ?? "Google account"} · ${contributor.role[0]!.toUpperCase()}${contributor.role.slice(1)}${isSelf ? " · You" : ""}`;
      if (!invitation && !contributor.originalOwner) {
        const role = document.createElement("select");
        role.className = "contributor-role-select";
        role.disabled = isSelf;
        if (isSelf) role.title = "You cannot change your own hunt role.";
        role.setAttribute(
          "aria-label",
          `Role for ${contributor.email ?? "Google account"}`,
        );
        for (const [value, name] of [
          ["contributor", "Contributor"],
          ["officer", "Officer"],
          ["owner", "Owner"],
        ]) {
          const option = document.createElement("option");
          option.value = value!;
          option.textContent = name!;
          role.append(option);
        }
        role.value = contributor.role;
        role.addEventListener("change", async () => {
          role.disabled = true;
          const updated = await request<HuntContributor[]>(
            `/api/admin/hunts/${id}/contributors/${encodeURIComponent(creatorId)}/role`,
            { role: role.value },
            "PATCH",
          );
          if (selected?.id !== id) return;
          if (!updated.ok) {
            role.value = contributor.role;
            memberStatus.textContent = updated.message;
          } else {
            memberStatus.textContent = `Role changed to ${role.options[role.selectedIndex]?.text}.`;
            await renderContributors();
          }
          role.disabled = false;
        });
        item.append(role);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = invitation ? "Cancel invitation" : "Remove access";
      remove.hidden = contributor.originalOwner;
      remove.disabled = isSelf;
      if (isSelf) remove.title = "You cannot remove your own hunt access.";
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        const result = await request<HuntContributor[]>(
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
      chip.textContent = contributor.originalOwner
        ? `Original owner · ${contributor.displayName ?? "Display name not set"}`
        : invitation
          ? `Invitation pending · ${identifier} · Contributor`
          : `${contributor.role[0]!.toUpperCase()}${contributor.role.slice(1)} · ${contributor.email ?? "Google account"}`;
      creators?.append(chip);
    }
    if (contributorsStatus) {
      contributorsStatus.textContent = result.value.some(
        (contributor) => !contributor.originalOwner,
      )
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
    panel.open = false;
    panel.hidden = hunt.role !== "owner";
    memberForm.hidden = hunt.role !== "owner";
    memberList.replaceChildren();
    memberStatus.textContent = "";
  }
  deleteHuntButton.addEventListener("click", () => {
    if (!selected || selected.role !== "owner") return;
    pendingDelete = selected;
    deleteName.textContent = pendingDelete.name;
    deleteNameInput.value = "";
    deleteStatus.textContent = "";
    deleteStatus.hidden = true;
    confirmDeleteButton.disabled = true;
    deleteDialog.showModal();
    deleteNameInput.focus();
  });
  deleteNameInput.addEventListener("input", () => {
    confirmDeleteButton.disabled =
      deleteNameInput.value !== pendingDelete?.name;
  });
  deleteDialog
    .querySelector<HTMLButtonElement>('[data-testid="cancel-delete-hunt"]')!
    .addEventListener("click", () => deleteDialog.close());
  deleteDialog.addEventListener("close", () => {
    pendingDelete = undefined;
    deleteNameInput.value = "";
    confirmDeleteButton.disabled = true;
  });
  deleteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const hunt = pendingDelete;
    if (!hunt || deleteNameInput.value !== hunt.name) return;
    confirmDeleteButton.disabled = true;
    deleteHuntButton.disabled = true;
    deleteStatus.hidden = true;
    deleteStatus.textContent = "";
    workspaceStatus.textContent = `Deleting ${hunt.name}…`;
    try {
      const result = await repository.deleteHunt(hunt.id, hunt.name);
      if (!result.ok) {
        deleteStatus.textContent = result.message;
        deleteStatus.hidden = false;
        confirmDeleteButton.disabled = false;
        return;
      }
      availableHunts = availableHunts.filter((item) => item.id !== hunt.id);
      updateFilteredHunts();
      if (selected?.id === hunt.id) {
        selected = undefined;
        taskHunt.value = "";
        panel.hidden = true;
      }
      managerView.hidden = false;
      if (overviewView) overviewView.hidden = true;
      if (editorView) editorView.hidden = true;
      if (mode) mode.textContent = "YOUR ADVENTURES";
      manageDialog.setAttribute("aria-labelledby", "manage-hunts-title");
      deleteDialog.close();
      workspaceStatus.textContent = `${hunt.name} was permanently deleted.`;
    } catch {
      deleteStatus.textContent =
        "The hunt could not be deleted. Check your connection and try again.";
      deleteStatus.hidden = false;
      confirmDeleteButton.disabled = false;
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
    populateHuntSelector();
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
      memberStatus.textContent = `Invitation saved for ${email}. They will start as a Contributor after signing in with Google.`;
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
