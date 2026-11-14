import { accountRequest, request } from "./huntRepository.js";
import type { PlayerIdentity } from "../foundation/types.js";

interface Inbox {
  unreadCount: number;
  issues: {
    id: string;
    taskLabel: string;
    description: string;
    unread: boolean;
    resolved: boolean;
  }[];
}
interface SubmissionStatus {
  activeCount: number;
  limit: number;
  canSubmit: boolean;
}
function issueToast(message: string): void {
  document.querySelector(".hunt-issue-toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "hunt-issue-toast";
  toast.dataset.testid = "issue-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.textContent = message;
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 2400);
}
function issueDialog(title: string): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.className = "hunt-issue-dialog";
  const header = document.createElement("header");
  header.className = "hunt-issue-dialog-header";
  const heading = document.createElement("h2");
  heading.id = "hunt-issue-title";
  heading.textContent = title;
  dialog.setAttribute("aria-labelledby", heading.id);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "action hunt-issue-dialog-close";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";
  close.onclick = () => dialog.close();
  header.append(heading, close);
  dialog.append(header);
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
  async function refresh(open = false) {
    if (disposed || loading || !allowed) return;
    loading = true;
    const result = await request<Inbox>(`/api/admin/hunts/${huntId}/issues`);
    loading = false;
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
    list.className = "hunt-issue-list";
    for (const issue of result.value.issues) {
      const row = document.createElement("li");
      row.className = "hunt-issue-card";
      const label = document.createElement("strong");
      label.className = "hunt-issue-card-title";
      label.textContent = issue.taskLabel;
      const description = document.createElement("p");
      description.className = "hunt-issue-card-description";
      description.textContent = issue.description;
      const heading = document.createElement("div");
      heading.className = "hunt-issue-card-heading";
      const state = document.createElement("span");
      state.className = "hunt-issue-card-state";
      state.dataset.resolved = String(issue.resolved);
      state.textContent = issue.resolved ? "Resolved" : "Open";
      heading.append(label, state);
      row.append(heading, description);
      if (!issue.resolved) {
        const resolve = document.createElement("button");
        resolve.type = "button";
        resolve.className = "hunt-issue-resolve";
        resolve.textContent = "Mark resolved";
        resolve.onclick = async () => {
          resolve.disabled = true;
          const saved = await request(
            `/api/admin/hunts/${huntId}/issues/${issue.id}/resolve`,
            {},
          );
          if (!saved.ok) {
            resolve.disabled = false;
            issueToast(saved.message);
            return;
          }
          state.textContent = "Resolved";
          state.dataset.resolved = "true";
          resolve.textContent = "Resolved";
        };
        row.append(resolve);
      }
      list.append(row);
    }
    if (!list.childElementCount) {
      const empty = document.createElement("p");
      empty.className = "hunt-issue-empty";
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
  button.textContent = "Report issue";
  leave.before(button);
  button.onclick = async () => {
    button.disabled = true;
    const [tasks, issueStatus] = await Promise.all([
      accountRequest<{ id: string; displayLabel: string }[]>(
        `/api/player/account/hunts/${huntId}/issues/tasks`,
        identity,
      ),
      accountRequest<SubmissionStatus>(
        `/api/player/account/hunts/${huntId}/issues/status`,
        identity,
      ),
    ]);
    button.disabled = false;
    if (!root.open || !button.isConnected) return;
    const popup = issueDialog("Submit Issue");
    const form = document.createElement("form");
    form.className = "hunt-issue-form";
    const taskLabel = document.createElement("label");
    taskLabel.textContent = "Task";
    const select = document.createElement("select");
    select.name = "taskId";
    select.add(new Option("Whole hunt", ""));
    if (tasks.ok)
      for (const task of tasks.value)
        select.add(new Option(task.displayLabel, task.id));
    const descriptionLabel = document.createElement("label");
    descriptionLabel.textContent = "Issue description";
    const description = document.createElement("textarea");
    description.name = "description";
    description.required = true;
    description.maxLength = 4000;
    description.placeholder = "Describe what went wrong…";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "action";
    submit.textContent = "Submit Issue";
    const status = document.createElement("p");
    status.className = "hunt-issue-status";
    status.setAttribute("role", "status");
    if (!tasks.ok) status.textContent = tasks.message;
    if (issueStatus.ok && !issueStatus.value.canSubmit) {
      status.textContent =
        "You have 3 open issues for this hunt. An admin must resolve one before you can submit another.";
      submit.disabled = true;
      description.disabled = true;
      select.disabled = true;
    }
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
      if (result.ok) {
        popup.close();
        issueToast("Issue submitted.");
        return;
      }
      status.textContent = result.message;
      submit.disabled = false;
    };
  };
}
