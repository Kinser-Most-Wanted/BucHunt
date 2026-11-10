import { test, expect } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HuntIssueStore } from "../src/ts/server/huntIssueStore.js";
import { HuntStore } from "../src/ts/server/huntStore.js";

test("issue reports persist without submitter identities and unread status is per administrator", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hunt-issues-"));
  try {
    const hunts = new HuntStore(join(directory, "hunts.json"));
    const hunt = await hunts.create(
      {
        name: "Issues",
        description: "Campus",
        beginsAt: "2020-01-01T00:00:00Z",
        endsAt: null,
        taskOrderMode: "any",
      },
      "owner",
    );
    const task = await hunts.addTask(hunt.id, {
      displayLabel: "Fountain",
      description: "Read sign",
      requiredAnswer: "yes",
      location: { latitude: 0, longitude: 0 },
      order: 1,
      answerCaseSensitive: false,
      hint: null,
      points: 0,
    });
    const definition = await hunts.get(hunt.id);
    const path = join(directory, "issues.json");
    const reports = new HuntIssueStore(path);
    await reports.submit(definition, {
      taskId: task.id,
      description: "The sign is missing",
    });
    await reports.submit(definition, {
      taskId: null,
      description: "Hunt instructions unclear",
    });
    const inbox = await new HuntIssueStore(path).list(hunt.id, "admin-a");
    expect(inbox.unreadCount).toBe(2);
    expect(inbox.issues[0].taskLabel).toBe("Fountain");
    await reports.markRead(hunt.id, "admin-a", {
      ids: inbox.issues.map((i) => i.id),
    });
    expect((await reports.list(hunt.id, "admin-a")).unreadCount).toBe(0);
    expect((await reports.list(hunt.id, "admin-b")).unreadCount).toBe(2);
    await reports.submit(definition, {
      taskId: null,
      description: "New report",
    });
    expect((await reports.list(hunt.id, "admin-a")).unreadCount).toBe(1);
    expect(await readFile(path, "utf8")).not.toMatch(
      /submitter|playerId|email/,
    );
    await expect(
      reports.submit(definition, {
        taskId: "other-hunt-task",
        description: "bad",
      }),
    ).rejects.toThrow("Task not found");
    await expect(
      reports.submit(definition, { taskId: null, description: " " }),
    ).rejects.toThrow("1–4000");
    await expect(
      reports.submit(definition, {
        taskId: null,
        description: "x".repeat(4001),
      }),
    ).rejects.toThrow("1–4000");
    await writeFile(path, "corrupt");
    await expect(reports.list(hunt.id, "admin-a")).rejects.toThrow(
      "not been overwritten",
    );
    expect(await readFile(path, "utf8")).toBe("corrupt");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
