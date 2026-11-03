import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createApplication } from "../src/ts/server/server.js";
import { ContributorStore, HuntStore } from "../src/ts/server/huntStore.js";
import { PlayerProgressStore } from "../src/ts/server/playerProgressStore.js";
import { PlayerProfileStore } from "../src/ts/server/playerProfileStore.js";
import {
  buildHuntResults,
  resultsCsv,
  resultsPdf,
} from "../src/ts/server/huntResultsExport.js";
import type { HuntDefinition } from "../src/ts/foundation/types.js";

const accountId = (subject: string) =>
  "google-" + createHash("sha256").update(subject).digest("hex");
const input = {
  name: "Campus hunt",
  description: "Explore campus",
  ownerId: "ignored",
  beginsAt: "2026-11-03T18:00:00Z",
  endsAt: null,
  taskOrderMode: "any",
};
const taskInput = {
  displayLabel: "Library",
  description: "Find the library",
  requiredAnswer: "Bucky",
  location: { latitude: 36, longitude: -82 },
  order: 1,
  answerCaseSensitive: false,
  hint: null,
  points: 0,
};

function sample(taskCount = 3): HuntDefinition {
  return {
    ...input,
    taskOrderMode: "any",
    id: "hunt-demo",
    status: "published",
    createdAt: input.beginsAt,
    updatedAt: input.beginsAt,
    accessCode: null,
    tasks: Array.from({ length: taskCount }, (_, i) => ({
      ...taskInput,
      id: `task-${i}`,
      order: i + 1,
      displayLabel: `Task ${i + 1}`,
    })),
  };
}

test("table derives completion from current tasks and retains zero-completion players", () => {
  const hunt = sample();
  hunt.tasks.reverse();
  const result = buildHuntResults(hunt, [
    { playerId: "b", completedTaskIds: [] },
    {
      playerId: "a",
      displayName: "Alex",
      completedTaskIds: ["task-2", "task-2", "deleted-task"],
    },
  ]);
  expect(result.tasks.map((task) => task.id)).toEqual([
    "task-0",
    "task-1",
    "task-2",
  ]);
  expect(result.players).toEqual([
    {
      id: "a",
      displayName: "Alex",
      completed: 1,
      statuses: [false, false, true],
    },
    {
      id: "b",
      displayName: null,
      completed: 0,
      statuses: [false, false, false],
    },
  ]);
  expect(hunt.tasks[0].id).toBe("task-2");
});

test("CSV escapes delimiters, quotes, line breaks, formula cells, and preserves Unicode", () => {
  const hunt = sample(1);
  hunt.tasks[0].displayLabel = 'Library, "north"\nentrance';
  const csv = resultsCsv(
    buildHuntResults(hunt, [
      {
        playerId: "google-demo",
        displayName: ' =HYPERLINK("x")',
        completedTaskIds: [],
      },
      {
        playerId: "google-other",
        displayName: "李 🐔",
        completedTaskIds: ["task-0"],
      },
    ]),
  );
  expect(csv).toContain('"T1 - Library, ""north""\nentrance (task-0)"');
  expect(csv).toContain('"\' =HYPERLINK(""x"")"');
  expect(csv).toContain('"李 🐔","1 / 1","0","Completed"');
  expect(csv.endsWith("\r\n")).toBe(true);
});

test("empty hunts produce header-only CSV and valid PDF, including hunts without tasks", async () => {
  const result = buildHuntResults(sample(), []);
  expect(resultsCsv(result).split("\r\n")).toHaveLength(2);
  expect(resultsCsv(result)).toContain("Player ID");
  const pdf = await PDFDocument.load(await resultsPdf(result));
  expect(pdf.getPageCount()).toBeGreaterThan(0);
  const noTasks = buildHuntResults(sample(0), [
    { playerId: "empty", completedTaskIds: [] },
  ]);
  expect(resultsCsv(noTasks)).toContain('"empty","","0 / 0","0"');
  expect(
    (await PDFDocument.load(await resultsPdf(noTasks))).getPageCount(),
  ).toBeGreaterThan(0);
});

test("PDF paginates many players and tasks without dropping long or Unicode content", async () => {
  const hunt = sample(11);
  hunt.description = "Long hunt description. ".repeat(120);
  hunt.tasks[0].displayLabel = "校園 🐔 " + "Long task label ".repeat(50);
  const result = buildHuntResults(
    hunt,
    Array.from({ length: 28 }, (_, i) => ({
      playerId: `google-${String(i).padStart(64, "0")}`,
      displayName: i === 0 ? "李 🐔" : "Player name",
      completedTaskIds: i % 2 ? ["task-0"] : [],
    })),
  );
  const bytes = await resultsPdf(result);
  expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
  expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(4);
});

test("exports enforce owner/contributor access, include both stores, and never alter saved player data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "buchunt-export-"));
  const hunts = new HuntStore(join(directory, "hunts.json"));
  const hunt = await hunts.create(input, accountId("owner"));
  const first = await hunts.addTask(hunt.id, taskInput);
  await hunts.addTask(hunt.id, {
    ...taskInput,
    displayLabel: "Statue",
    order: 2,
  });
  const accounts = new PlayerProgressStore(
    join(directory, "account-player-progress.json"),
  );
  const legacy = new PlayerProgressStore(
    join(directory, "player-progress.json"),
  );
  const profiles = new PlayerProfileStore(
    join(directory, "player-profiles.json"),
  );
  await accounts.join(accountId("player"), hunt.id);
  await profiles.save(accountId("player"), { displayName: "Alex" });
  await accounts.complete(accountId("player"), hunt.id, first.id);
  await accounts.join(accountId("zero"), hunt.id);
  await accounts.join(accountId("left"), hunt.id);
  await accounts.leave(accountId("left"), hunt.id);
  await legacy.complete("legacy-player", hunt.id, first.id);
  await accounts.rejectChoice(
    accountId("player"),
    hunt.id,
    first.id,
    "Do not export answers",
  );
  await new ContributorStore(join(directory, "hunt-contributors.json")).add(
    hunt.id,
    accountId("contributor"),
  );
  const trackedFiles = [
    "hunts.json",
    "account-player-progress.json",
    "player-progress.json",
    "player-profiles.json",
  ];
  const before = await Promise.all(
    trackedFiles.map((file) => readFile(join(directory, file), "utf8")),
  );
  const app = createApplication({
    dataDirectory: directory,
    verifyGoogleIdentity: async (token) => {
      if (token === "invalid") throw new Error("Invalid token");
      return {
        subject: token,
        email: `${token}@example.com`,
        emailVerified: true,
      };
    },
  });
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  const url = `${base}/api/admin/hunts/${hunt.id}/results/`;
  try {
    for (const format of ["csv", "pdf"]) {
      expect((await fetch(url + format)).status).toBe(401);
      expect(
        (
          await fetch(url + format, {
            headers: { Authorization: "Bearer invalid" },
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await fetch(url + format, {
            headers: { Authorization: "Bearer outsider" },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(url + format, {
            headers: {
              Authorization: "Bearer owner",
              "sec-fetch-site": "cross-site",
            },
          })
        ).status,
      ).toBe(403);
      const response = await fetch(url + format, {
        headers: { Authorization: "Bearer owner" },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-disposition")).toBe(
        `attachment; filename="hunt-${hunt.id}-results.${format}"`,
      );
      if (format === "csv") {
        expect(response.headers.get("content-type")).toContain("text/csv");
        const csv = await response.text();
        expect(csv).toContain('"Alex","1 / 2","1","Completed","Incomplete"');
        expect(csv).toContain(accountId("zero"));
        expect(csv).toContain("legacy-player");
        expect(csv).not.toContain(accountId("left"));
        expect(csv).not.toContain("Do not export answers");
        expect(csv.split("\r\n")).toHaveLength(5);
      } else {
        expect(response.headers.get("content-type")).toBe("application/pdf");
        expect(
          (await PDFDocument.load(await response.arrayBuffer())).getPageCount(),
        ).toBeGreaterThan(0);
      }
      expect(
        (
          await fetch(url + format, {
            headers: { Authorization: "Bearer contributor" },
          })
        ).status,
      ).toBe(200);
    }
    const after = await Promise.all(
      trackedFiles.map((file) => readFile(join(directory, file), "utf8")),
    );
    expect(after).toEqual(before);
    expect(
      (
        await fetch(`${base}/api/admin/hunts/missing/results/csv`, {
          headers: { Authorization: "Bearer owner" },
        })
      ).status,
    ).toBe(404);
    expect(
      (await fetch(url + "xml", { headers: { Authorization: "Bearer owner" } }))
        .status,
    ).toBe(404);
    const empty = await hunts.create(input, accountId("owner"));
    const emptyResponse = await fetch(
      `${base}/api/admin/hunts/${empty.id}/results/csv`,
      { headers: { Authorization: "Bearer owner" } },
    );
    expect((await emptyResponse.text()).split("\r\n")).toHaveLength(2);
    await writeFile(
      join(directory, "account-player-progress.json"),
      "invalid JSON",
    );
    expect(
      (await fetch(url + "csv", { headers: { Authorization: "Bearer owner" } }))
        .status,
    ).toBe(500);
  } finally {
    await new Promise<void>((resolve, reject) =>
      app.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
