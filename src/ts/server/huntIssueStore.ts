import { randomUUID } from "node:crypto";
import { JsonFile, StoreError } from "./huntStore.js";
import type { HuntDefinition } from "../foundation/types.js";

export interface HuntIssue {
  id: string;
  huntId: string;
  taskId: string | null;
  taskLabel: string;
  description: string;
  submittedBy?: string;
  resolved?: boolean;
  createdAt: string;
  readBy: string[];
}
function validate(value: unknown): HuntIssue[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (issue) =>
        !issue ||
        typeof issue.id !== "string" ||
        typeof issue.huntId !== "string" ||
        !(issue.taskId === null || typeof issue.taskId === "string") ||
        typeof issue.taskLabel !== "string" ||
        typeof issue.description !== "string" ||
        !issue.description.trim() ||
        issue.description.length > 4000 ||
        typeof issue.createdAt !== "string" ||
        !Number.isFinite(Date.parse(issue.createdAt)) ||
        (issue.submittedBy !== undefined &&
          typeof issue.submittedBy !== "string") ||
        (issue.resolved !== undefined && typeof issue.resolved !== "boolean") ||
        !Array.isArray(issue.readBy) ||
        issue.readBy.some((id: unknown) => typeof id !== "string"),
    )
  )
    throw new Error("Invalid issue reports");
  return value as HuntIssue[];
}
export class HuntIssueStore {
  private file: JsonFile<HuntIssue[]>;
  constructor(path: string) {
    this.file = new JsonFile(path, () => [], validate);
  }
  async submit(
    hunt: HuntDefinition,
    input: unknown,
    submittedBy: string,
  ): Promise<{ submitted: true }> {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new StoreError("validation", "Enter an issue description.");
    const fields = input as Record<string, unknown>;
    if (
      Object.keys(fields).some(
        (key) => !["taskId", "description"].includes(key),
      ) ||
      !(fields.taskId === null || typeof fields.taskId === "string") ||
      typeof fields.description !== "string" ||
      !fields.description.trim() ||
      fields.description.trim().length > 4000
    )
      throw new StoreError(
        "validation",
        "Select a task or Hunt in general and enter a description of 1–4000 characters.",
      );
    const task = hunt.tasks.find((task) => task.id === fields.taskId);
    if (fields.taskId !== null && !task)
      throw new StoreError("validation", "Task not found in this hunt.");
    const issue: HuntIssue = {
      id: randomUUID(),
      huntId: hunt.id,
      taskId: task?.id ?? null,
      taskLabel: task?.displayLabel ?? "Hunt in general",
      description: fields.description.trim(),
      submittedBy,
      resolved: false,
      createdAt: new Date().toISOString(),
      readBy: [],
    };
    await this.file.update((issues) => {
      const activeCount = issues.filter(
        (item) =>
          item.huntId === hunt.id &&
          item.submittedBy === submittedBy &&
          !item.resolved,
      ).length;
      if (activeCount >= 3)
        throw new StoreError(
          "validation",
          "You can have up to 3 unresolved issues for this hunt. Ask an admin to resolve one before submitting another.",
        );
      issues.push(issue);
    });
    return { submitted: true };
  }
  async submissionStatus(huntId: string, submittedBy: string) {
    const activeCount = (await this.file.get()).filter(
      (issue) =>
        issue.huntId === huntId &&
        issue.submittedBy === submittedBy &&
        !issue.resolved,
    ).length;
    return { activeCount, limit: 3, canSubmit: activeCount < 3 };
  }
  async list(huntId: string, reader: string) {
    const issues = (await this.file.get()).filter(
      (issue) => issue.huntId === huntId,
    );
    return {
      unreadCount: issues.filter((issue) => !issue.readBy.includes(reader))
        .length,
      issues: issues.map(({ readBy, ...issue }) => {
        delete issue.submittedBy;
        return {
          ...issue,
          resolved: Boolean(issue.resolved),
          unread: !readBy.includes(reader),
        };
      }),
    };
  }
  async resolve(huntId: string, issueId: string): Promise<{ resolved: true }> {
    return this.file.update((issues) => {
      const issue = issues.find(
        (item) => item.huntId === huntId && item.id === issueId,
      );
      if (!issue) throw new StoreError("not-found", "Issue not found.");
      issue.resolved = true;
      return { resolved: true as const };
    });
  }
  async markRead(
    huntId: string,
    reader: string,
    input: unknown,
  ): Promise<{ read: true }> {
    const ids =
      input && typeof input === "object"
        ? (input as { ids?: unknown }).ids
        : undefined;
    if (
      !Array.isArray(ids) ||
      ids.length > 1000 ||
      ids.some((id) => typeof id !== "string")
    )
      throw new StoreError("validation", "Choose valid issue IDs.");
    await this.file.update((issues) => {
      for (const issue of issues)
        if (
          issue.huntId === huntId &&
          ids.includes(issue.id) &&
          !issue.readBy.includes(reader)
        )
          issue.readBy.push(reader);
    });
    return { read: true };
  }
  async removeHunt(huntId: string): Promise<void> {
    await this.file.update((issues) => {
      for (let i = issues.length - 1; i >= 0; i--)
        if (issues[i].huntId === huntId) issues.splice(i, 1);
    });
  }
}
