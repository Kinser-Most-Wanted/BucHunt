import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createApplication } from "../src/ts/server/server.js";
import { HuntStore } from "../src/ts/server/huntStore.js";

const ownerId = "google-" + createHash("sha256").update("owner").digest("hex");
const taskInput = {
  displayLabel: "Mascot",
  description: "Name the mascot",
  requiredAnswer: "Bucky",
  location: { latitude: 0, longitude: 0 },
  order: 1,
  answerCaseSensitive: false,
  hint: null,
  points: 1000,
};
async function fixture(options: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "buchunt-sprint6-"));
  const hunts = new HuntStore(join(directory, "hunts.json"));
  const hunt = await hunts.create(
    {
      name: "Sprint Six",
      description: "Explore together",
      organizationName: "ETSU",
      beginsAt: "2020-01-01T00:00:00Z",
      endsAt: null,
      taskOrderMode: "any",
      ...options,
    },
    ownerId,
  );
  const first = await hunts.addTask(hunt.id, taskInput);
  const second = await hunts.addTask(hunt.id, {
    ...taskInput,
    order: 2,
    displayLabel: "Library",
  });
  const app = createApplication({
    dataDirectory: directory,
    verifyPlayerToken: async (token) => token,
    verifyGoogleIdentity: async (token) => ({
      subject: token,
      email: `${token}@example.com`,
      emailVerified: true,
    }),
  });
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  const api = async (
    path: string,
    token = "owner",
    input?: unknown,
    method?: string,
  ) => {
    const response = await fetch(base + path, {
      method: method ?? (input === undefined ? "GET" : "POST"),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    return { status: response.status, data: await response.json() };
  };
  return {
    directory,
    hunts,
    hunt,
    first,
    second,
    base,
    api,
    close: async () => {
      await new Promise<void>((resolve) => app.close(() => resolve()));
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    },
  };
}

test("organization membership governs organization hunt access and migration", async () => {
  const f = await fixture();
  try {
    const created = await f.api("/api/player/account/organizations", "owner", {
      name: "ETSU",
    });
    expect(created.status).toBe(201);
    const organizationId = created.data.value.id as string;
    const invited = await f.api(
      `/api/player/account/organizations/${organizationId}/members`,
      "owner",
      { email: "member@example.com" },
    );
    expect(invited.status).toBe(200);
    const oldHuntInvite = await f.api(
      `/api/player/account/organizations/${organizationId}/members`,
      "owner",
      { email: "one@example.com" },
    );
    expect(oldHuntInvite.status).toBe(200);
    const pending = await f.api(
      "/api/player/account/organization-invitations",
      "member",
    );
    expect(pending.data.value).toHaveLength(1);
    const beforeAccept = await f.api("/api/player/account/join", "member", {
      huntId: f.hunt.id,
    });
    expect(beforeAccept.status).toBe(403);
    const accepted = await f.api(
      `/api/player/account/organization-invitations/${organizationId}`,
      "member",
      { action: "accept" },
    );
    expect(accepted.data.value.accepted).toBe(true);
    await f.api(
      `/api/player/account/organization-invitations/${organizationId}`,
      "one",
      { action: "accept" },
    );
    const linked = await f.hunts.get(f.hunt.id);
    expect(linked.organizationId).toBe(organizationId);
    expect(
      (await f.api("/api/player/account/organization-hunts", "member")).data
        .value,
    ).toContainEqual(
      expect.objectContaining({
        id: f.hunt.id,
        organizationId,
        organizationName: "ETSU",
      }),
    );
    expect(
      (await f.api("/api/player/account/join", "member", { huntId: f.hunt.id }))
        .status,
    ).toBe(200);
    expect(
      (await f.api("/api/player/account/hunts", "member")).data.value[0],
    ).toMatchObject({ organizationId, organizationName: "ETSU" });
    expect(
      (await f.api("/api/player/account/organization-hunts", "member")).data
        .value,
    ).toEqual([]);
    expect(
      (await f.api(`/api/admin/hunts/${f.hunt.id}/contributors`, "owner"))
        .status,
    ).toBe(403);
    expect(
      (
        await f.api("/api/player/account/join", "outsider", {
          accessCode: f.hunt.accessCode,
        })
      ).status,
    ).toBe(403);
    const promoted = await f.api(
      `/api/player/account/organizations/${organizationId}/members/google-${createHash("sha256").update("member").digest("hex")}`,
      "owner",
      { role: "officer" },
      "PATCH",
    );
    expect(
      promoted.data.value.members.find(
        (member: { email: string }) => member.email === "member@example.com",
      ).role,
    ).toBe("officer");
    const removed = await f.api(
      `/api/player/account/organizations/${organizationId}/members/google-${createHash("sha256").update("member").digest("hex")}`,
      "owner",
      undefined,
      "DELETE",
    );
    expect(removed.status).toBe(200);
    expect(
      (await f.api("/api/player/account/hunts", "member")).data.value,
    ).toEqual([]);
  } finally {
    await f.close();
  }
});
async function identity(page: Page, token: string, admin = false) {
  await page.addInitScript((token) => {
    localStorage.setItem(
      "buchunt.player-session",
      JSON.stringify({
        provider: "google",
        accountId: token,
        email: `${token}@example.com`,
        idToken: token,
      }),
    );
    localStorage.setItem(`buchunt.player-profile.${token}`, token);
  }, token);
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        user: {
          subject: token,
          email: `${token}@example.com`,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          role: admin ? "administrator" : "user",
        },
      },
    }),
  );
  await page.route("**/api/admin/capabilities", (route) =>
    route.fulfill({
      status: admin ? 200 : 403,
      json: admin ? { capabilities: ["administrative.access"] } : {},
    }),
  );
}

async function openAdminHunt(page: Page, base: string): Promise<void> {
  await page.goto(base + "/admin.html");
  await page.getByTestId("open-manage-hunts").click();
  await page
    .getByTestId("my-hunts")
    .getByRole("button", { name: /Sprint Six/ })
    .click();
  await expect(page.getByTestId("hunt-detail-name")).toHaveText("Sprint Six");
}

test("#139 #143 #142 APIs enforce roles, admission limits, saved membership, and issue isolation", async () => {
  const f = await fixture({ maxParticipants: 1 });
  const admin = `/api/admin/hunts/${f.hunt.id}`;
  const player = `/api/player/account/hunts/${f.hunt.id}`;
  try {
    expect(
      (
        await f.api("/api/player/account/join", "one", {
          accessCode: f.hunt.accessCode,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await f.api("/api/player/account/join", "two", {
          accessCode: f.hunt.accessCode,
        })
      ).data.message,
    ).toContain("capacity");
    expect((await f.api(player, "one")).data.value.organizationName).toBe(
      "ETSU",
    );
    expect(
      (
        await f.api("/api/player/account/organizations", "owner", {
          name: "Computing",
        })
      ).status,
    ).toBe(201);
    const computingMembership = (
      await f.api("/api/player/account/organizations", "owner")
    ).data.value.find(
      (organization: { name: string }) => organization.name === "Computing",
    );
    for (const token of ["one", "two"]) {
      await f.api(
        `/api/player/account/organizations/${computingMembership.id}/members`,
        "owner",
        { email: `${token}@example.com` },
      );
      await f.api(
        `/api/player/account/organization-invitations/${computingMembership.id}`,
        token,
        { action: "accept" },
      );
    }
    expect(
      (await f.api(admin, "outsider", { organizationName: "Spoof" }, "PATCH"))
        .status,
    ).toBe(403);
    expect(
      (
        await f.api(
          admin,
          "owner",
          { organizationName: "Computing", participationClosed: true },
          "PATCH",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await f.api("/api/player/account/join", "two", {
          accessCode: f.hunt.accessCode,
        })
      ).data.message,
    ).toContain("closed");
    expect(
      (
        await f.api("/api/player/account/join", "one", {
          accessCode: f.hunt.accessCode,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await f.api(player + `/tasks/${f.first.id}/answer`, "one", {
          answer: "Bucky",
        })
      ).status,
    ).toBe(200);
    expect((await f.api(player, "one")).data.value).toMatchObject({
      organizationName: "Computing",
      tasks: expect.arrayContaining([
        expect.objectContaining({ id: f.first.id, completed: true }),
      ]),
    });
    expect(
      (
        await f.api(player + "/issues", "outsider", {
          taskId: f.first.id,
          description: "bad",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await f.api(player + "/issues", "one", {
          taskId: f.first.id,
          description: "Sign missing",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await f.api(player + "/issues", "one", {
          taskId: null,
          description: "Hunt problem",
        })
      ).status,
    ).toBe(201);
    expect((await f.api(admin + "/issues", "outsider")).status).toBe(403);
    const inbox = await f.api(admin + "/issues");
    expect(inbox.data.value.unreadCount).toBe(2);
    await f.api(admin + "/issues/read", "owner", {
      ids: inbox.data.value.issues.map((i: { id: string }) => i.id),
    });
    expect((await f.api(admin + "/issues")).data.value.unreadCount).toBe(0);
    await f.api(admin, "owner", { participationClosed: false }, "PATCH");
    expect(
      (
        await f.api("/api/player/account/join", "two", {
          accessCode: f.hunt.accessCode,
        })
      ).data.message,
    ).toContain("capacity");
    await f.api(player, "one", undefined, "DELETE");
    expect(
      (
        await f.api("/api/player/account/join", "two", {
          accessCode: f.hunt.accessCode,
        })
      ).status,
    ).toBe(200);
  } finally {
    await f.close();
  }
});

test("#140 API blocks lobby answers, bypasses, late joining, and editing after start", async () => {
  const f = await fixture({ huntType: "kahoot" });
  const admin = `/api/admin/hunts/${f.hunt.id}`;
  const player = `/api/player/account/hunts/${f.hunt.id}`;
  try {
    for (const token of ["one", "two"])
      await f.api("/api/player/account/join", token, {
        accessCode: f.hunt.accessCode,
      });
    const lobby = (await f.api(player, "one")).data.value;
    expect(lobby.tasks).toEqual([]);
    expect(lobby.kahoot.phase).toBe("lobby");
    expect(lobby.kahoot.question).toBeUndefined();
    expect(
      (
        await f.api(player + `/tasks/${f.first.id}/answer`, "one", {
          answer: "Bucky",
        })
      ).status,
    ).toBe(400);
    expect(
      (await f.api(admin + "/kahoot", "outsider", { action: "start" })).status,
    ).toBe(403);
    expect(
      (await f.api(admin + "/kahoot", "owner", { action: "start" })).status,
    ).toBe(200);
    expect(
      (
        await f.api("/api/player/account/join", "three", {
          accessCode: f.hunt.accessCode,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await f.api(
          admin + `/tasks/${f.first.id}`,
          "owner",
          { ...taskInput },
          "PATCH",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await f.api(player + `/tasks/${f.second.id}/answer`, "one", {
          answer: "Bucky",
        })
      ).status,
    ).toBe(403);
    expect((await f.api(player + "/issues/tasks", "one")).data.value).toEqual([
      { id: f.first.id, displayLabel: "Mascot" },
    ]);
    expect(
      (
        await f.api(player + "/issues", "one", {
          taskId: f.second.id,
          description: "future task",
        })
      ).status,
    ).toBe(400);
    await f.api(player + `/tasks/${f.first.id}/answer`, "one", {
      answer: "wrong",
    });
    expect(
      (
        await f.api(player + `/tasks/${f.first.id}/answer`, "one", {
          answer: "Bucky",
        })
      ).status,
    ).toBe(400);
    expect((await f.api(player, "one")).data.value.kahoot.submitted).toBe(true);
    await f.api(player + `/tasks/${f.first.id}/answer`, "two", {
      answer: "Bucky",
    });
    expect((await f.api(player, "one")).data.value.kahoot.phase).toBe(
      "results",
    );
    await f.api(admin + "/kahoot", "owner", { action: "next" });
    expect((await f.api(player, "one")).data.value.kahoot.question.id).toBe(
      f.second.id,
    );
    await f.api(admin + "/kahoot", "owner", { action: "end-question" });
    expect((await f.api(player, "one")).data.value.kahoot.phase).toBe(
      "finished",
    );
  } finally {
    await f.close();
  }
});

test("#139 #142 #143 browser workflow edits settings and submits and reads a task issue", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const f = await fixture({ maxParticipants: 1 });
  const playerContext = await browser.newContext();
  const adminContext = await browser.newContext();
  const createdOrganization = await f.api(
    "/api/player/account/organizations",
    "owner",
    { name: "Computing" },
  );
  expect(createdOrganization.status).toBe(201);
  try {
    const player = await playerContext.newPage();
    await identity(player, "one");
    await player.goto(f.base + "/player.html");
    await player.getByLabel("Access code").fill(f.hunt.accessCode!);
    await player
      .getByRole("button", { name: "Join Hunt", exact: true })
      .click();
    await expect(player.getByTestId("player-hunt-facts")).toContainText("ETSU");
    await player.getByTestId("submit-issue").click();
    const report = player.getByRole("dialog", {
      name: "Submit Issue",
      exact: true,
    });
    const taskSelect = report.getByRole("combobox", {
      name: "Task",
      exact: true,
    });
    await expect(taskSelect).toBeVisible();
    await taskSelect.selectOption({ label: "Mascot" });
    await report
      .getByLabel("Issue description")
      .fill("The fountain sign is missing.");
    await report
      .getByRole("button", { name: "Submit Issue", exact: true })
      .click();
    await expect(report.getByRole("status")).toHaveText("Issue submitted.");
    await report.getByRole("button", { name: "Close", exact: true }).click();
    const admin = await adminContext.newPage();
    await identity(admin, "owner", true);
    await openAdminHunt(admin, f.base);
    await expect(admin.getByTestId("hunt-detail-name")).toHaveText(
      "Sprint Six",
    );
    await expect(admin.getByTestId("hunt-issues-button")).toHaveText(
      "Issues (1 unread)",
    );
    await admin.getByTestId("hunt-issues-button").click();
    const inbox = admin.getByRole("dialog", {
      name: "Hunt issues",
      exact: true,
    });
    await expect(inbox).toContainText("Mascot");
    await expect(inbox).toContainText("The fountain sign is missing.");
    await inbox.getByRole("button", { name: "Close", exact: true }).click();
    await expect(admin.getByTestId("hunt-issues-button")).toHaveText(
      "Issues (0 unread)",
    );
    const settings = admin.getByTestId("hunt-settings-form");
    const memberships = await f.api(
      "/api/player/account/organizations",
      "owner",
    );
    const computing = memberships.data.value.find(
      (organization: { name: string }) => organization.name === "Computing",
    );
    const organizationSelect = settings.getByLabel("Organization", {
      exact: true,
    });
    await expect(organizationSelect).toContainText("Computing (owner)");
    await organizationSelect.selectOption(computing.id);
    await settings.getByLabel("Close participation to new players").check();
    await settings.getByRole("button", { name: "Save hunt settings" }).click();
    await expect(settings.getByRole("status")).toHaveText(
      "Hunt settings saved.",
    );
    await f.api(
      `/api/player/account/organizations/${computing.id}/members`,
      "owner",
      { email: "one@example.com" },
    );
    await f.api(
      `/api/player/account/organization-invitations/${computing.id}`,
      "one",
      { action: "accept" },
    );
    const organizationHunt = await f.api("/api/admin/hunts", "owner", {
      name: "Organization discovery",
      description: "A taskless hunt shared by the organization",
      organizationId: computing.id,
      beginsAt: "2020-01-01T00:00:00Z",
      endsAt: null,
      taskOrderMode: "sequential",
    });
    expect(organizationHunt.status).toBe(201);
    expect(
      (
        await f.api("/api/player/account/join", "two", {
          accessCode: f.hunt.accessCode,
        })
      ).data.message,
    ).toContain("closed");
    await player.reload();
    await expect(
      player.getByTestId("organization-hunt-discovery"),
    ).toContainText("Organization discovery");
    await player
      .getByRole("button", { name: "Join Organization discovery", exact: true })
      .click();
    await expect(
      player.getByRole("button", {
        name: "Open Organization discovery",
        exact: true,
      }),
    ).toBeVisible();
    await player
      .getByRole("button", { name: "Open Sprint Six", exact: true })
      .click();
    await expect(player.getByTestId("player-hunt-facts")).toContainText(
      "Computing",
    );
    await player.screenshot({
      path: "/tmp/buchunt-traditional-player.png",
      fullPage: true,
    });
  } finally {
    await playerContext.close();
    await adminContext.close();
    await f.close();
  }
});

test("#140 browser players synchronize, reconnect, lock submissions, and finish from the host dashboard", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const f = await fixture({ huntType: "kahoot" });
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  try {
    const players = [];
    for (const [index, token] of ["one", "two"].entries()) {
      const page = await contexts[index].newPage();
      await identity(page, token);
      await page.goto(f.base + "/player.html");
      await page.getByLabel("Access code").fill(f.hunt.accessCode!);
      await page
        .getByRole("button", { name: "Join Hunt", exact: true })
        .click();
      await expect(page.getByTestId("kahoot-player")).toContainText(
        "host has not started",
      );
      players.push(page);
    }
    const admin = await contexts[2].newPage();
    await identity(admin, "owner", true);
    await openAdminHunt(admin, f.base);
    const host = admin.getByTestId("kahoot-host");
    await expect(host).toContainText("Connected");
    const startHunt = host.getByRole("button", {
      name: "Start hunt",
      exact: true,
    });
    await expect(startHunt).toBeVisible();
    await startHunt.click();
    for (const page of players)
      await expect(
        page
          .getByTestId("kahoot-player")
          .getByRole("heading", { name: "Mascot", exact: true }),
      ).toBeVisible();
    await players[0]
      .getByTestId("kahoot-player")
      .getByLabel("Your answer")
      .fill("Bucky");
    await players[0]
      .getByTestId("kahoot-player")
      .getByRole("button", { name: "Submit answer" })
      .click();
    await expect(players[0].getByTestId("kahoot-player")).toContainText(
      "Answer submitted",
    );
    await players[0].reload();
    await players[0]
      .getByRole("button", { name: "Open Sprint Six", exact: true })
      .click();
    await expect(players[0].getByTestId("kahoot-player")).toContainText(
      "Answer submitted",
    );
    await expect(
      players[0].getByTestId("kahoot-player").getByLabel("Your answer"),
    ).toHaveCount(0);
    await players[1]
      .getByTestId("kahoot-player")
      .getByLabel("Your answer")
      .fill("wrong");
    await players[1]
      .getByTestId("kahoot-player")
      .getByRole("button", { name: "Submit answer" })
      .click();
    await expect(
      host.getByRole("button", { name: "Next question", exact: true }),
    ).toBeVisible();
    await host
      .getByRole("button", { name: "Next question", exact: true })
      .click();
    for (const page of players)
      await expect(
        page
          .getByTestId("kahoot-player")
          .getByRole("heading", { name: "Library", exact: true }),
      ).toBeVisible();
    await host
      .getByRole("button", { name: "End question", exact: true })
      .click();
    for (const page of players)
      await expect(page.getByTestId("kahoot-player")).toContainText(
        "Hunt complete!",
      );
    await admin.screenshot({
      path: "/tmp/buchunt-kahoot-host.png",
      fullPage: true,
    });
  } finally {
    for (const context of contexts) await context.close();
    await f.close();
  }
});
