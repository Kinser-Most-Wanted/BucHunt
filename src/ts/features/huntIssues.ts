import { accountRequest, request } from "./huntRepository.js";
import type { PlayerIdentity } from "../foundation/types.js";

interface Inbox {
  unreadCount: number;
  issues: {
    id: string;
    taskLabel: string;
    description: string;
    unread: boolean;
  }[];
}
function issueDialog(title: string): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.className = "hunt-issue-dialog";
  const heading = document.createElement("h2");
  heading.id = "hunt-issue-title";
  heading.textContent = title;
  dialog.setAttribute("aria-labelledby", heading.id);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "action";
  close.textContent = "Close";
  close.onclick = () => dialog.close();
  dialog.append(heading, close);
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  return dialog;
}
export function mountAdminIssues(
  root: HTMLDialogElement,
  huntId: string,
  allowed: boolean,
): () => void {
  const button = root.querySelector<HTMLButtonElement>(
    '[data-testid="hunt-issues-button"]',
  );
  if (!button) return () => {};
  button.hidden = !allowed;
  let disposed = false;
  let popup: HTMLDialogElement | undefined;
  let loading = false;
  let openPending = false;
  async function refresh(open = false) {
    if (disposed || !allowed) return;
    if (loading) {
      openPending ||= open;
      return;
    }
    loading = true;
    const result = await request<Inbox>(`/api/admin/hunts/${huntId}/issues`);
    loading = false;
    open ||= openPending;
    openPending = false;
    if (disposed) return;
    if (!result.ok) {
      button!.textContent = "Issues (unavailable)";
      if (open) {
        popup = issueDialog("Hunt issues");
        const error = document.createElement("p");
        error.textContent = result.message;
        popup.append(error);
        popup.showModal();
      }
      return;
    }
    button!.textContent = `Issues (${result.value.unreadCount} unread)`;
    if (!open) return;
    popup = issueDialog("Hunt issues");
    const list = document.createElement("ul");
    for (const issue of result.value.issues) {
      const row = document.createElement("li");
      const label = document.createElement("strong");
      label.textContent = issue.taskLabel;
      const description = document.createElement("p");
      description.textContent = issue.description;
      row.append(label, description);
      list.append(row);
    }
    if (!list.childElementCount) {
      const empty = document.createElement("p");
      empty.textContent = "No issues reported for this hunt.";
      popup.append(empty);
    }
    popup.append(list);
    popup.showModal();
    const ids = result.value.issues
      .filter((issue) => issue.unread)
      .map((issue) => issue.id);
    for (let offset = 0; offset < ids.length; offset += 1000) {
      const marked = await request(`/api/admin/hunts/${huntId}/issues/read`, {
        ids: ids.slice(offset, offset + 1000),
      });
      if (!marked.ok) {
        const error = document.createElement("p");
        error.textContent = marked.message;
        popup.append(error);
        return;
      }
    }
    if (!disposed) void refresh();
  }
  button.onclick = () => void refresh(true);
  if (allowed) void refresh();
  const timer = window.setInterval(() => {
    if (root.open) void refresh();
  }, 5000);
  const dispose = () => {
    disposed = true;
    window.clearInterval(timer);
    popup?.close();
    button.onclick = null;
    button.hidden = true;
  };
  root.addEventListener("close", dispose, { once: true });
  return () => {
    root.removeEventListener("close", dispose);
    dispose();
  };
}
export function mountPlayerIssues(
  root: HTMLDialogElement,
  huntId: string,
  identity: PlayerIdentity,
): void {
  root.querySelector('[data-testid="submit-issue"]')?.remove();
  const leave = root.querySelector('[data-testid="leave-hunt"]');
  if (!leave) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "action player-submit-issue";
  button.dataset.testid = "submit-issue";
  button.textContent = "Submit Issue";
  leave.after(button);
  button.onclick = async () => {
    button.disabled = true;
    const tasks = await accountRequest<{ id: string; displayLabel: string }[]>(
      `/api/player/account/hunts/${huntId}/issues/tasks`,
      identity,
    );
    button.disabled = false;
    if (!root.open || !button.isConnected) return;
    const popup = issueDialog("Submit Issue");
    const form = document.createElement("form");
    const taskLabel = document.createElement("label");
    taskLabel.textContent = "Task";
    const select = document.createElement("select");
    select.name = "taskId";
    select.add(new Option("Hunt in general", ""));
    if (tasks.ok)
      for (const task of tasks.value)
        select.add(new Option(task.displayLabel, task.id));
    const descriptionLabel = document.createElement("label");
    descriptionLabel.textContent = "Issue description";
    const description = document.createElement("textarea");
    description.name = "description";
    description.required = true;
    description.maxLength = 4000;
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "action";
    submit.textContent = "Submit Issue";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    if (!tasks.ok) status.textContent = tasks.message;
    taskLabel.append(select);
    descriptionLabel.append(description);
    form.append(taskLabel, descriptionLabel, submit, status);
    popup.append(form);
    popup.showModal();
    form.onsubmit = async (event) => {
      event.preventDefault();
      submit.disabled = true;
      const result = await accountRequest(
        `/api/player/account/hunts/${huntId}/issues`,
        identity,
        { taskId: select.value || null, description: description.value },
      );
      status.textContent = result.ok ? "Issue submitted." : result.message;
      if (result.ok) {
        description.value = "";
        form.reset();
      }
      submit.disabled = false;
    };
  };
}

