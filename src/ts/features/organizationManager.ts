import type {
  OperationResult,
  OrganizationDefinition,
  OrganizationInvitationDefinition,
  OrganizationInvitationResponse,
  PlayerIdentity,
} from "../foundation/types.js";

const SESSION_KEY = "buchunt.player-session";
type JsonResult<T> = OperationResult<T>;

export function storedPlayerIdentity(): PlayerIdentity | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(SESSION_KEY) ??
        sessionStorage.getItem(SESSION_KEY) ??
        "null",
    ) as (Partial<PlayerIdentity> & { expiresAt?: number }) | null;
    if (
      value?.provider === "google" &&
      typeof value.accountId === "string" &&
      typeof value.idToken === "string" &&
      typeof value.email === "string" &&
      (typeof value.expiresAt !== "number" ||
        value.expiresAt * 1000 > Date.now())
    )
      return value as PlayerIdentity;
  } catch {
    // Treat inaccessible session storage as signed out.
  }
  return null;
}

export async function organizationRequest<T>(
  identity: PlayerIdentity,
  path: string,
  input?: unknown,
  method?: string,
): Promise<JsonResult<T>> {
  try {
    const response = await fetch(path, {
      method: method ?? (input === undefined ? "GET" : "POST"),
      credentials: "omit",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${identity.idToken}`,
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    const result = (await response.json()) as JsonResult<T>;
    if (typeof result.ok !== "boolean" || response.ok !== result.ok)
      throw new Error("Invalid organization response");
    return result;
  } catch {
    return {
      ok: false,
      code: "network",
      message: "Organizations could not be reached. Try again.",
    };
  }
}

export async function populateOrganizationSelect(
  select: HTMLSelectElement,
  identity = storedPlayerIdentity(),
  selectedId = select.value,
): Promise<void> {
  if (!identity) return;
  const result = await organizationRequest<OrganizationDefinition[]>(
    identity,
    "/api/player/account/organizations",
  );
  if (!result.ok) return;
  const options = document.createDocumentFragment();
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "No organization";
  options.append(none);
  for (const organization of result.value) {
    if (organization.role === "contributor") continue;
    const option = document.createElement("option");
    option.value = organization.id;
    option.textContent = `${organization.name} (${organization.role})`;
    options.append(option);
  }
  select.replaceChildren(options);
  select.value = selectedId;
}

export interface OrganizationManagerController {
  setIdentity(identity: PlayerIdentity | null): void;
  refresh(): Promise<void>;
  close(): void;
}

export function mountOrganizationManager(
  root: ParentNode,
  onMembershipChanged: () => void = () => undefined,
  promptInvitations = true,
): OrganizationManagerController | null {
  const workspace = root.querySelector<HTMLElement>(
    '[data-testid="organization-workspace"]',
  );
  const dialog = root.querySelector<HTMLDialogElement>(
    '[data-testid="organization-dialog"]',
  );
  const openButton = root.querySelector<HTMLButtonElement>(
    '[data-testid="open-organizations"]',
  );
  const inviteButton = root.querySelector<HTMLButtonElement>(
    '[data-testid="open-organization-invitations"]',
  );
  const closeButton = root.querySelector<HTMLButtonElement>(
    '[data-testid="close-organizations"]',
  );
  const createForm = root.querySelector<HTMLFormElement>(
    '[data-testid="organization-create-form"]',
  );
  const createStatus = root.querySelector<HTMLElement>(
    '[data-testid="organization-create-status"]',
  );
  const list = root.querySelector<HTMLUListElement>(
    '[data-testid="organization-list"]',
  );
  const editor = root.querySelector<HTMLElement>(
    '[data-testid="organization-editor"]',
  );
  const detailsForm = root.querySelector<HTMLFormElement>(
    '[data-testid="organization-details-form"]',
  );
  const detailsStatus = root.querySelector<HTMLElement>(
    '[data-testid="organization-details-status"]',
  );
  const inviteForm = root.querySelector<HTMLFormElement>(
    '[data-testid="organization-invite-form"]',
  );
  const inviteStatus = root.querySelector<HTMLElement>(
    '[data-testid="organization-invite-status"]',
  );
  const members = root.querySelector<HTMLUListElement>(
    '[data-testid="organization-members"]',
  );
  const invitations = root.querySelector<HTMLUListElement>(
    '[data-testid="organization-invitations"]',
  );
  const invitationsPanel = root.querySelector<HTMLElement>(
    '[data-testid="organization-invitations-panel"]',
  );
  const invitationsStatus = root.querySelector<HTMLElement>(
    '[data-testid="organization-invitations-status"]',
  );
  if (
    !workspace ||
    !dialog ||
    !openButton ||
    !inviteButton ||
    !closeButton ||
    !createForm ||
    !createStatus ||
    !list ||
    !editor ||
    !detailsForm ||
    !detailsStatus ||
    !inviteForm ||
    !inviteStatus ||
    !members ||
    !invitations ||
    !invitationsPanel ||
    !invitationsStatus
  )
    return null;

  let identity: PlayerIdentity | null = null;
  let organizations: OrganizationDefinition[] = [];
  let pending: OrganizationInvitationDefinition[] = [];
  let selectedId = "";
  let promptedAccount: string | null = null;
  const selected = () => organizations.find((org) => org.id === selectedId);

  const renderMembers = (organization: OrganizationDefinition): void => {
    members.replaceChildren();
    for (const member of organization.members) {
      const row = document.createElement("li");
      row.className = "organization-member";
      const label = document.createElement("span");
      label.className = "organization-member-label";
      label.textContent = `${member.email} · ${member.role}${member.originalOwner ? " · Original Owner" : ""}${member.pending ? " · Invitation pending" : ""}`;
      row.append(label);
      const key = member.accountId ?? `invite:${member.email}`;
      if (
        organization.role === "owner" &&
        !member.originalOwner &&
        !member.isSelf
      ) {
        const role = document.createElement("select");
        role.setAttribute("aria-label", `Role for ${member.email}`);
        role.dataset.memberKey = key;
        for (const value of ["owner", "officer", "contributor"] as const) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = value[0]!.toUpperCase() + value.slice(1);
          role.append(option);
        }
        role.value = member.role;
        row.append(role);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.dataset.memberKey = key;
        remove.textContent = "Remove";
        row.append(remove);
      }
      members.append(row);
    }
  };

  const renderEditor = (): void => {
    const organization = selected();
    editor.hidden = !organization;
    if (!organization) return;
    const name = detailsForm.elements.namedItem("name") as HTMLInputElement;
    const canEditName =
      organization.role === "owner" || organization.role === "officer";
    name.value = organization.name;
    name.disabled = !canEditName;
    detailsForm.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!.disabled = !canEditName;
    inviteForm.hidden = organization.role !== "owner";
    members.replaceChildren();
    renderMembers(organization);
    list
      .querySelectorAll<HTMLButtonElement>("[data-organization-id]")
      .forEach((button) => {
        button.setAttribute(
          "aria-current",
          String(button.dataset.organizationId === organization.id),
        );
      });
  };

  const refresh = async (): Promise<void> => {
    if (!identity) return;
    const [organizationResult, invitationResult] = await Promise.all([
      organizationRequest<OrganizationDefinition[]>(
        identity,
        "/api/player/account/organizations",
      ),
      organizationRequest<OrganizationInvitationDefinition[]>(
        identity,
        "/api/player/account/organization-invitations",
      ),
    ]);
    if (!organizationResult.ok) {
      createStatus.textContent = organizationResult.message;
      return;
    }
    organizations = organizationResult.value;
    selectedId =
      organizations.find((org) => org.id === selectedId)?.id ??
      organizations[0]?.id ??
      "";
    list.replaceChildren();
    if (!organizations.length) {
      const empty = document.createElement("li");
      empty.textContent = "You are not in an organization yet.";
      list.append(empty);
    }
    for (const org of organizations) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.organizationId = org.id;
      button.textContent = `${org.name} (${org.role})`;
      item.append(button);
      list.append(item);
    }
    renderEditor();
    if (!invitationResult.ok) {
      invitationsStatus.textContent = invitationResult.message;
      invitationsStatus.hidden = false;
      return;
    }
    pending = invitationResult.value;
    inviteButton.hidden = pending.length === 0;
    inviteButton.textContent = `Organization invitations (${pending.length})`;
    invitationsPanel.hidden = pending.length === 0;
    invitations.replaceChildren();
    for (const invitation of pending) {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `${invitation.organizationName} invited you as a ${invitation.role}.`;
      const actions = document.createElement("div");
      actions.className = "organization-invitation-actions";
      for (const action of ["accept", "decline"] as const) {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.invitationAction = action;
        button.dataset.organizationId = invitation.organizationId;
        button.textContent = action === "accept" ? "Accept" : "Decline";
        actions.append(button);
      }
      item.append(label, actions);
      invitations.append(item);
    }
    if (
      promptInvitations &&
      pending.length &&
      promptedAccount !== identity.accountId
    ) {
      promptedAccount = identity.accountId;
      if (!dialog.open) dialog.showModal();
    }
  };

  openButton.addEventListener("click", () => {
    dialog.showModal();
    void refresh();
  });
  inviteButton.addEventListener("click", () => {
    dialog.showModal();
    void refresh();
  });
  closeButton.addEventListener("click", () => dialog.close());
  list.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-organization-id]",
    );
    if (!button) return;
    selectedId = button.dataset.organizationId ?? "";
    renderEditor();
  });
  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!identity) return;
    const name = String(new FormData(createForm).get("name") ?? "").trim();
    const button = createForm.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    button.disabled = true;
    const result = await organizationRequest<OrganizationDefinition>(
      identity,
      "/api/player/account/organizations",
      { name },
    );
    button.disabled = false;
    createStatus.textContent = result.ok
      ? "Organization created."
      : result.message;
    if (result.ok) {
      createForm.reset();
      selectedId = result.value.id;
      await refresh();
      onMembershipChanged();
    }
  });
  detailsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const org = selected();
    if (!identity || !org) return;
    const name = String(new FormData(detailsForm).get("name") ?? "").trim();
    const result = await organizationRequest<OrganizationDefinition>(
      identity,
      `/api/player/account/organizations/${encodeURIComponent(org.id)}`,
      { name },
      "PATCH",
    );
    detailsStatus.textContent = result.ok
      ? "Organization name saved."
      : result.message;
    if (result.ok) {
      await refresh();
      onMembershipChanged();
    }
  });
  inviteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const org = selected();
    if (!identity || !org) return;
    const email = String(new FormData(inviteForm).get("email") ?? "")
      .trim()
      .toLowerCase();
    const result = await organizationRequest<OrganizationDefinition>(
      identity,
      `/api/player/account/organizations/${encodeURIComponent(org.id)}/members`,
      { email },
    );
    inviteStatus.textContent = result.ok
      ? `Invitation sent to ${email}. They must accept it before joining.`
      : result.message;
    if (result.ok) {
      inviteForm.reset();
      await refresh();
    }
  });
  members.addEventListener("change", async (event) => {
    const target = event.target;
    const org = selected();
    if (
      !(target instanceof HTMLSelectElement) ||
      !identity ||
      !org ||
      !target.dataset.memberKey
    )
      return;
    const previous = org.members.find(
      (member) =>
        (member.accountId ?? `invite:${member.email}`) ===
        target.dataset.memberKey,
    )?.role;
    target.disabled = true;
    const result = await organizationRequest<OrganizationDefinition>(
      identity,
      `/api/player/account/organizations/${encodeURIComponent(org.id)}/members/${encodeURIComponent(target.dataset.memberKey)}`,
      { role: target.value },
      "PATCH",
    );
    target.disabled = false;
    detailsStatus.textContent = result.ok
      ? "Member role updated."
      : result.message;
    if (result.ok) {
      await refresh();
      onMembershipChanged();
    } else if (previous) target.value = previous;
  });
  members.addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-member-key]",
    );
    const org = selected();
    if (!button || !identity || !org) return;
    button.disabled = true;
    const result = await organizationRequest<OrganizationDefinition>(
      identity,
      `/api/player/account/organizations/${encodeURIComponent(org.id)}/members/${encodeURIComponent(button.dataset.memberKey!)}`,
      undefined,
      "DELETE",
    );
    detailsStatus.textContent = result.ok ? "Member removed." : result.message;
    if (result.ok) {
      await refresh();
      onMembershipChanged();
    } else button.disabled = false;
  });
  invitations.addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-invitation-action]",
    );
    if (!button || !identity) return;
    button.disabled = true;
    const result = await organizationRequest<OrganizationInvitationResponse>(
      identity,
      `/api/player/account/organization-invitations/${encodeURIComponent(button.dataset.organizationId!)}`,
      { action: button.dataset.invitationAction },
    );
    invitationsStatus.textContent = result.ok
      ? result.value.accepted
        ? "Organization invitation accepted."
        : "Organization invitation declined."
      : result.message;
    invitationsStatus.hidden = false;
    if (result.ok) {
      await refresh();
      onMembershipChanged();
    } else button.disabled = false;
  });

  const controller: OrganizationManagerController = {
    setIdentity(value) {
      identity = value;
      workspace.hidden = !value;
      if (!value) {
        organizations = [];
        pending = [];
        list.replaceChildren();
        invitations.replaceChildren();
        if (dialog.open) dialog.close();
      } else void refresh();
    },
    refresh,
    close() {
      if (dialog.open) dialog.close();
    },
  };
  controller.setIdentity(storedPlayerIdentity());
  return controller;
}
