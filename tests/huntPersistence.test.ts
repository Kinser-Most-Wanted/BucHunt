import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createApplication } from "../src/ts/server/server.js";
import {
  HuntStore,
  isHuntActive,
  isHuntJoinable,
} from "../src/ts/server/huntStore.js";
import { PlayerProgressStore } from "../src/ts/server/playerProgressStore.js";

const input = {
  name: "Campus",
  description: "Explore campus",
  ownerId: "spoofed",
  beginsAt: "2026-10-15T12:00:00Z",
  endsAt: null,
  taskOrderMode: "sequential",
};
const task = {
  displayLabel: "Fountain",
  description: "Read the plaque",
  requiredAnswer: "Bucky",
  location: { latitude: 36, longitude: -82 },
  order: 1,
  answerCaseSensitive: false,
  hint: null,
  points: 0,
};
test("JSON survives fresh storage instances; concurrent updates preserve every task", async () => {
  const directory = await mkdtemp(join(tmpdir(), "buchunt-store-"));
  try {
    const path = join(directory, "hunts.json");
    const store = new HuntStore(path);
    const hunt = await store.create(input, "trusted-owner");
    expect(hunt.ownerId).toBe("trusted-owner");
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        store.addTask(hunt.id, { ...task, order: index + 1 }),
      ),
    );
    const restarted = new HuntStore(path);
    expect((await restarted.get(hunt.id)).tasks).toHaveLength(12);
    const original = (await restarted.get(hunt.id)).tasks[0];
    const updated = await store.updateTask(hunt.id, original.id, {
      ...task,
      displayLabel: "Updated fountain",
      requiredAnswer: "New answer",
    });
    expect(updated.id).toBe(original.id);
    expect(updated.displayLabel).toBe("Updated fountain");
    expect(updated.requiredAnswer).toBe("New answer");
    const before = await readFile(path, "utf8");
    await expect(
      store.updateTask(hunt.id, original.id, {
        ...task,
        displayLabel: "Corrupted task",
        requiredAnswer: "",
      }),
    ).rejects.toThrow("invalid");
    await expect(store.addTask(hunt.id, task)).rejects.toThrow("invalid");
    await expect(
      store.addTask(hunt.id, { ...task, requiredAnswer: "", order: 20 }),
    ).rejects.toThrow("invalid");
    expect(await readFile(path, "utf8")).toBe(before);
    expect(await store.deleteTask(hunt.id, original.id)).toEqual({
      deleted: true,
    });
    expect((await restarted.get(hunt.id)).tasks).toHaveLength(11);
    await expect(store.deleteTask(hunt.id, original.id)).rejects.toThrow(
      "Task not found.",
    );
    const progressPath = join(directory, "player-progress.json");
    await new PlayerProgressStore(progressPath).complete(
      "player-a",
      hunt.id,
      "task-a",
    );
    expect(
      await new PlayerProgressStore(progressPath).completed(
        "player-a",
        hunt.id,
      ),
    ).toEqual(["task-a"]);
    expect(
      await new PlayerProgressStore(progressPath).completed(
        "player-b",
        hunt.id,
      ),
    ).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("corrupt or unsupported stores are preserved and write failures reject", async () => {
  const directory = await mkdtemp(join(tmpdir(), "buchunt-failure-"));
  try {
    const path = join(directory, "hunts.json");
    for (const content of ["{broken", '{"schemaVersion":2,"hunts":[]}']) {
      await writeFile(path, content);
      await expect(new HuntStore(path).create(input, "owner")).rejects.toThrow(
        "not been overwritten",
      );
      expect(await readFile(path, "utf8")).toBe(content);
    }
    const blocked = join(directory, "blocked");
    await writeFile(blocked, "not a directory");
    await expect(
      new HuntStore(join(blocked, "hunts.json")).create(input, "owner"),
    ).rejects.toThrow();
    await rm(path);
    await mkdir(path);
    await expect(new HuntStore(path).create(input, "owner")).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("creator ownership, contributor grants, privacy and restart persistence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "buchunt-api-"));
  let app = createApplication({ dataDirectory: directory });
  async function start() {
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  }
  async function stop() {
    await new Promise<void>((resolve, reject) =>
      app.close((error) => (error ? reject(error) : resolve())),
    );
  }
  let base = await start();
  async function identity() {
    const response = await fetch(base + "/api/admin/session");
    return {
      id: (await response.json()).value.id as string,
      cookie: response.headers.get("set-cookie")!.split(";")[0],
    };
  }
  try {
    const crossSite = await fetch(base + "/api/admin/session", {
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(crossSite.status).toBe(403);
    expect(crossSite.headers.get("set-cookie")).toBeNull();
    const owner = await identity();
    const collaborator = await identity();
    const stranger = await identity();
    const headers = (cookie: string) => ({
      Cookie: cookie,
      "Content-Type": "application/json",
    });
    const admin = headers(owner.cookie);
    expect(owner.id).not.toBe(owner.cookie.split("=")[1]);
    expect(
      (
        await fetch(base + "/api/admin/hunts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer local-development-only",
          },
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(base + "/api/admin/hunts", {
          method: "POST",
          headers: admin,
          body: "{bad",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(base + "/api/admin/hunts", {
          method: "POST",
          headers: admin,
          body: JSON.stringify({ ...input, name: " " }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(base + "/api/admin/hunts", {
          method: "POST",
          headers: { ...admin, Origin: "https://evil.invalid" },
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(403);
    const created = await (
      await fetch(base + "/api/admin/hunts", {
        method: "POST",
        headers: admin,
        body: JSON.stringify(input),
      })
    ).json();
    expect(created.ok).toBe(true);
    expect(created.value.ownerId).toBe(owner.id);
    const id = created.value.id;
    const route = `/api/admin/hunts/${id}`;
    const saved = await (
      await fetch(base + route + "/tasks", {
        method: "POST",
        headers: admin,
        body: JSON.stringify(task),
      })
    ).json();
    expect(saved.ok).toBe(true);
    const taskRoute = route + "/tasks/" + saved.value.id;
    for (const cookie of [
      stranger.cookie,
      collaborator.cookie,
      "buchunt-creator=" + owner.id.slice(8),
    ]) {
      expect(
        (await fetch(base + route, { headers: headers(cookie) })).status,
      ).toBe(403);
      expect(
        (
          await fetch(base + route + "/tasks", {
            method: "POST",
            headers: headers(cookie),
            body: JSON.stringify({ ...task, order: 2 }),
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(base + taskRoute, {
            method: "PATCH",
            headers: headers(cookie),
            body: JSON.stringify({
              ...task,
              displayLabel: "Unauthorized edit",
            }),
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(base + taskRoute, {
            method: "DELETE",
            headers: { ...headers(cookie), "Content-Type": "application/json" },
          })
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await (
          await fetch(base + "/api/admin/hunts", {
            headers: headers(stranger.cookie),
          })
        ).json()
      ).value,
    ).toEqual([]);
    expect(
      (
        await fetch(base + route + "/contributors", {
          method: "POST",
          headers: admin,
          body: JSON.stringify({ creatorId: "not-an-id" }),
        })
      ).status,
    ).toBe(400);
    const grant = await (
      await fetch(base + route + "/contributors", {
        method: "POST",
        headers: admin,
        body: JSON.stringify({ creatorId: collaborator.id }),
      })
    ).json();
    expect(grant.value).toEqual([collaborator.id]);
    expect(
      (await fetch(base + route, { headers: headers(collaborator.cookie) }))
        .status,
    ).toBe(200);
    expect(
      (
        await (
          await fetch(base + "/api/admin/hunts", {
            headers: headers(collaborator.cookie),
          })
        ).json()
      ).value,
    ).toEqual([{ id, name: input.name, role: "contributor" }]);
    const contributedTask = await (
      await fetch(base + route + "/tasks", {
        method: "POST",
        headers: headers(collaborator.cookie),
        body: JSON.stringify({ ...task, order: 2 }),
      })
    ).json();
    expect(contributedTask.ok).toBe(true);
    const contributedTaskRoute = route + "/tasks/" + contributedTask.value.id;

    const changedAnswer = await fetch(base + taskRoute, {
      method: "PATCH",
      headers: admin,
      body: JSON.stringify({
        ...task,
        displayLabel: "Updated fountain",
        requiredAnswer: "New answer",
      }),
    });
    expect(changedAnswer.status).toBe(200);
    expect((await changedAnswer.json()).value).toMatchObject({
      id: saved.value.id,
      displayLabel: "Updated fountain",
      requiredAnswer: "New answer",
    });
    const savedConfig = await (
      await fetch(base + route, { headers: admin })
    ).json();
    const rejectedEdit = await fetch(base + taskRoute, {
      method: "PATCH",
      headers: admin,
      body: JSON.stringify({
        ...task,
        displayLabel: "Corrupted task",
        requiredAnswer: "",
      }),
    });
    expect(rejectedEdit.status).toBe(400);
    expect(
      (await (await fetch(base + route, { headers: admin })).json()).value,
    ).toEqual(savedConfig.value);

    const removed = await fetch(base + contributedTaskRoute, {
      method: "DELETE",
      headers: headers(collaborator.cookie),
    });
    expect(removed.status).toBe(200);
    expect((await removed.json()).value).toEqual({ deleted: true });
    const afterDelete = await (
      await fetch(base + route, { headers: admin })
    ).json();
    expect(afterDelete.value.tasks).toHaveLength(1);
    expect(afterDelete.value.tasks[0]).toMatchObject({
      id: saved.value.id,
      displayLabel: "Updated fountain",
    });

    expect(
      (
        await fetch(base + route + "/contributors", {
          method: "POST",
          headers: headers(collaborator.cookie),
          body: JSON.stringify({ creatorId: stranger.id }),
        })
      ).status,
    ).toBe(403);
    const legacyPath = join(directory, "hunts.json");
    const legacy = JSON.parse(await readFile(legacyPath, "utf8"));
    legacy.hunts.find((hunt: { id: string }) => hunt.id === id).accessCode =
      null;
    await writeFile(legacyPath, JSON.stringify(legacy));
    const player = await fetch(base + `/api/player/hunts/${id}`);
    const playerCookie = player.headers.get("set-cookie")!.split(";")[0];
    const projection = await player.json();
    expect(projection.value.tasks[0].completed).toBe(false);
    expect(JSON.stringify(projection)).not.toContain("Bucky");
    expect(JSON.stringify(projection)).not.toContain("ownerId");
    const answerPath = `/api/player/hunts/${id}/tasks/${saved.value.id}/answer`;
    expect(
      (
        await fetch(base + answerPath, {
          method: "POST",
          headers: headers(playerCookie),
          body: '{"answer":"bucky"}',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(base + answerPath, {
          method: "POST",
          headers: headers(playerCookie),
          body: '{"answer":"new answer"}',
        })
      ).status,
    ).toBe(200);
    for (const path of [
      "/data/hunts.json",
      "/data/hunt-contributors.json",
      "/js/server/server.js",
    ])
      expect((await fetch(base + path)).status).toBe(404);
    await stop();
    app = createApplication({ dataDirectory: directory });
    base = await start();
    const restoredHunt = await (
      await fetch(base + `/api/player/hunts/${id}`, {
        headers: headers(playerCookie),
      })
    ).json();
    expect(restoredHunt.value.tasks[0].completed).toBe(true);
    const restoredConfig = await (
      await fetch(base + route, { headers: admin })
    ).json();
    expect(restoredConfig.value.tasks).toHaveLength(1);
    expect(restoredConfig.value.tasks[0]).toMatchObject({
      id: saved.value.id,
      displayLabel: "Updated fountain",
      requiredAnswer: "New answer",
    });
    expect(
      (await fetch(base + route, { headers: headers(collaborator.cookie) }))
        .status,
    ).toBe(200);
    expect(
      (await (await fetch(base + route, { headers: admin })).json()).value
        .ownerId,
    ).toBe(owner.id);
    expect(
      (
        await fetch(
          base + route + "/contributors/" + encodeURIComponent(collaborator.id),
          { method: "DELETE", headers: admin },
        )
      ).status,
    ).toBe(200);
    expect(
      (await fetch(base + route, { headers: headers(collaborator.cookie) }))
        .status,
    ).toBe(403);
    expect(
      (
        await (
          await fetch(base + "/api/admin/hunts", {
            headers: headers(collaborator.cookie),
          })
        ).json()
      ).value,
    ).toEqual([]);
    expect((await fetch(base + route, { headers: admin })).status).toBe(200);
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("origin protection is infrastructure-only and needs no creator API token", async () => {
  const app = createApplication({ originToken: "private-origin" });
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  try {
    expect((await fetch(base + "/api/admin/session")).status).toBe(403);
    expect(
      (
        await fetch(base + "/api/admin/session", {
          headers: { "x-origin-token": "private-origin" },
        })
      ).status,
    ).toBe(200);
  } finally {
    await new Promise<void>((resolve) => app.close(() => resolve()));
  }
});

test("ownership and contributor grants survive terminating the Node process", async () => {
  const directory = await mkdtemp(join(tmpdir(), "buchunt-process-"));
  let child: ChildProcess | undefined;
  async function start(): Promise<string> {
    const moduleUrl = pathToFileURL(resolve("src/js/server/server.js")).href;
    const script = `import {createApplication} from ${JSON.stringify(moduleUrl)}; const app=createApplication({dataDirectory:process.env.DATA_DIRECTORY}); app.listen(0,'127.0.0.1',()=>process.send(app.address().port));`;
    child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, DATA_DIRECTORY: directory },
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    const [port] = await once(child, "message");
    return `http://127.0.0.1:${port}`;
  }
  async function stop(): Promise<void> {
    if (!child || child.exitCode !== null) return;
    const closed = once(child, "exit");
    child.kill("SIGTERM");
    await closed;
    child = undefined;
  }
  try {
    let base = await start();
    const identity = await fetch(base + "/api/admin/session");
    const cookie = identity.headers.get("set-cookie")!.split(";")[0];
    const headers = { Cookie: cookie, "Content-Type": "application/json" };
    const saved = await (
      await fetch(base + "/api/admin/hunts", {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      })
    ).json();
    const collaborator = "browser:" + "a".repeat(64);
    await fetch(base + `/api/admin/hunts/${saved.value.id}/contributors`, {
      method: "POST",
      headers,
      body: JSON.stringify({ creatorId: collaborator }),
    });
    await stop();
    base = await start();
    const loaded = await (
      await fetch(base + `/api/admin/hunts/${saved.value.id}`, { headers })
    ).json();
    expect(loaded.value).toEqual(saved.value);
    expect(
      (
        await (
          await fetch(
            base + `/api/admin/hunts/${saved.value.id}/contributors`,
            { headers },
          )
        ).json()
      ).value,
    ).toEqual([collaborator]);
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});

// These test tokens are accepted only by the injected test verifier. The
// production server never reads identity or completion state from the client.
const verifyPlayerToken = async (token: string): Promise<string> => {
  const subjects: Record<string, string> = {
    "player-a": "google-subject-a",
    "player-a-new-token": "google-subject-a",
    "player-b": "google-subject-b",
  };
  if (!Object.hasOwn(subjects, token)) throw new Error("Invalid token");
  return subjects[token];
};

test("account task progress survives restart without cookies and isolates players", async () => {
  const directory = await mkdtemp(join(tmpdir(), "buchunt-account-"));
  const store = new HuntStore(join(directory, "hunts.json"));
  const hunt = await store.create(input, "owner");
  const first = await store.addTask(hunt.id, task);
  await store.addTask(hunt.id, { ...task, order: 2 });
  let app = createApplication({ dataDirectory: directory, verifyPlayerToken });
  const start = async () => {
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  };
  const stop = async () => {
    await new Promise<void>((resolve) => app.close(() => resolve()));
  };
  let base = await start();
  const call = async (
    path: string,
    token?: string,
    body?: unknown,
    cookie?: string,
  ) => {
    const response = await fetch(base + "/api/player/account" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    return { status: response.status, payload: await response.json() };
  };
  try {
    expect((await call("/hunts")).status).toBe(401);
    expect((await call("/hunts", "forged-token")).status).toBe(401);
    expect(
      (
        await call(
          "/hunts",
          undefined,
          undefined,
          "buchunt-player=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        )
      ).status,
    ).toBe(401);
    expect((await call(`/hunts/${hunt.id}`, "player-a")).status).toBe(403);
    expect(
      (await call("/join", "player-a", { accessCode: hunt.accessCode })).status,
    ).toBe(200);
    const opened = await call(`/hunts/${hunt.id}`, "player-a");
    expect(opened.status).toBe(200);
    expect(
      opened.payload.value.tasks.map(
        (task: { completed: boolean }) => task.completed,
      ),
    ).toEqual([false, false]);
    expect(opened.payload.value.tasks[0].description).toBe(task.description);
    expect(JSON.stringify(opened.payload)).not.toMatch(
      /Bucky|ownerId|requiredAnswer/,
    );
    expect((await call("/hunts", "player-a")).payload.value).toHaveLength(1);
    const answerPath = `/hunts/${hunt.id}/tasks/${first.id}/answer`;
    expect(
      (await call(answerPath, undefined, { answer: "Bucky" })).status,
    ).toBe(401);
    expect(
      (await call(answerPath, "player-a", { answer: "wrong" })).status,
    ).toBe(400);
    expect(
      (await call(answerPath, "player-a", { answer: " bucky " })).status,
    ).toBe(200);
    expect(
      (await call("/join", "player-a", { accessCode: hunt.accessCode })).status,
    ).toBe(200);
    await stop();
    app = createApplication({ dataDirectory: directory, verifyPlayerToken });
    base = await start();
    const restored = await call("/hunts", "player-a-new-token");
    expect(
      restored.payload.value[0].tasks.map(
        (task: { completed: boolean }) => task.completed,
      ),
    ).toEqual([true, false]);
    expect((await call("/hunts", "player-b")).payload.value).toEqual([]);
    expect(
      (await call(`/hunts/${hunt.id}`, "player-a")).payload.value.tasks[0]
        .completed,
    ).toBe(true);
    expect((await call(`/hunts/${hunt.id}`, "player-b")).status).toBe(403);
    expect(
      (await call("/join", "player-b", { accessCode: hunt.accessCode })).status,
    ).toBe(200);
    expect(
      (await call(`/hunts/${hunt.id}`, "player-b")).payload.value.tasks[0]
        .completed,
    ).toBe(false);
    const bytes = await readFile(
      join(directory, "account-player-progress.json"),
      "utf8",
    );
    expect(bytes).not.toMatch(/player-a|player-b|Bucky/);
    await writeFile(join(directory, "account-player-progress.json"), "{broken");
    const failure = await call("/hunts", "player-a");
    expect(failure.status).toBe(500);
    expect(failure.payload.code).toBe("storage");
    expect(failure.payload.value).toBeUndefined();
    expect(
      (await call(answerPath, "player-a", { answer: "bucky" })).status,
    ).toBe(500);
    expect(
      await readFile(join(directory, "account-player-progress.json"), "utf8"),
    ).toBe("{broken");
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("account browser answers tasks and restores progress in another browser", async ({
  browser,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "buchunt-account-ui-"));
  const store = new HuntStore(join(directory, "hunts.json"));
  const hunt = await store.create(input, "owner");
  await store.addTask(hunt.id, task);
  await store.addTask(hunt.id, { ...task, displayLabel: "Library", order: 2 });
  const app = createApplication({
    dataDirectory: directory,
    verifyPlayerToken,
  });
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  const contexts = [];
  try {
    for (const [index, token] of ["player-a", "player-a-new-token"].entries()) {
      const context = await browser.newContext();
      contexts.push(context);
      // A pre-existing cookie must never accompany the new player API calls.
      await context.addCookies([{ name: "legacy", value: "keep", url: base }]);
      await context.addInitScript(
        ({ token }) => {
          sessionStorage.setItem(
            "buchunt.player-session",
            JSON.stringify({
              provider: "google",
              accountId: "google-subject-a",
              email: "a@example.com",
              idToken: token,
            }),
          );
          localStorage.setItem(
            "buchunt.player-profile.google-subject-a",
            "Baja",
          );
        },
        { token },
      );
      const page = await context.newPage();
      const cookieHeaders: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("/api/player/account/")) {
          if (request.headers().cookie)
            cookieHeaders.push(request.headers().cookie);
          expect(request.headers().authorization).toBe(`Bearer ${token}`);
        }
      });
      await page.goto(base + "/player.html");
      if (index === 0) {
        await page.getByLabel("Access code").fill("00000000");
        await page
          .getByRole("button", { name: "Join Hunt", exact: true })
          .click();
        await expect(
          page.getByTestId("player-hunt-lookup-status"),
        ).toContainText("Invalid access code");
        await page.getByLabel("Access code").fill(hunt.accessCode!);
        await page
          .getByRole("button", { name: "Join Hunt", exact: true })
          .click();
        await expect(page.getByTestId("player-hunt-name")).toHaveText(
          input.name,
        );
        await page.getByLabel("Answer for Fountain").fill("bucky");
        await page
          .getByRole("button", { name: "Submit answer" })
          .first()
          .click();
      } else {
        await expect(page.getByTestId("player-hunt-list")).toContainText(
          input.name,
        );
        await page
          .getByRole("button", { name: "Open Hunt", exact: true })
          .click();
      }
      await expect(page.getByTestId("player-task").first()).toContainText(
        "Completed",
      );
      await expect(page.getByTestId("player-task").nth(1)).toContainText(
        "Incomplete",
      );
      await page.reload();
      await page
        .getByRole("button", { name: "Open Hunt", exact: true })
        .click();
      await expect(page.getByTestId("player-task").first()).toContainText(
        "Completed",
      );
      expect(cookieHeaders).toEqual([]);
      expect(await context.cookies()).toEqual([
        expect.objectContaining({ name: "legacy", value: "keep" }),
      ]);
    }
  } finally {
    for (const context of contexts) await context.close();
    await new Promise<void>((resolve) => app.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("account progress reads and completion report storage failures without claiming success", async () => {
  const directory = await mkdtemp(join(tmpdir(), "buchunt-account-write-"));
  const store = new HuntStore(join(directory, "hunts.json"));
  const hunt = await store.create(input, "owner");
  const savedTask = await store.addTask(hunt.id, task);
  const progressPath = join(directory, "account-player-progress.json");
  const app = createApplication({
    dataDirectory: directory,
    verifyPlayerToken,
  });
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}/api/player/account`;
  const post = async (path: string, input: unknown) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        Authorization: "Bearer player-a",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
  try {
    await mkdir(progressPath);
    const failedRead = await fetch(base + `/hunts/${hunt.id}`, {
      headers: { Authorization: "Bearer player-a" },
    });
    expect(failedRead.status).toBe(500);
    expect((await failedRead.json()).ok).toBe(false);
    await rm(progressPath, { recursive: true });
    const before = JSON.stringify({ schemaVersion: 1, players: {} });
    await writeFile(progressPath, before);
    await rm(progressPath);
    await mkdir(progressPath);
    const failedAnswer = await post(
      `/hunts/${hunt.id}/tasks/${savedTask.id}/answer`,
      { answer: "Bucky" },
    );
    expect(failedAnswer.status).toBe(500);
    expect((await failedAnswer.json()).ok).toBe(false);
    await rm(progressPath, { recursive: true });
    await writeFile(progressPath, before);
    expect((await post("/join", { accessCode: hunt.accessCode })).status).toBe(
      200,
    );
    const restored = await fetch(base + `/hunts/${hunt.id}`, {
      headers: { Authorization: "Bearer player-a" },
    });
    expect((await restored.json()).value.tasks[0].completed).toBe(false);
  } finally {
    await new Promise<void>((resolve) => app.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("access code joins persist before answers and reject unavailable hunts and bypasses", async () => {
  const directory = await mkdtemp(join(tmpdir(), "buchunt-join-"));
  const store = new HuntStore(join(directory, "hunts.json"));
  const hunt = await store.create(
    { ...input, beginsAt: "2020-01-01T00:00:00Z" },
    "owner",
  );
  await store.addTask(hunt.id, task);
  const expiring = await store.create(
    {
      ...input,
      beginsAt: "2020-01-01T00:00:00Z",
      endsAt: null,
    },
    "owner",
  );
  const expiringTask = await store.addTask(expiring.id, task);
  const empty = await store.create(
    { ...input, beginsAt: "2020-01-01T00:00:00Z" },
    "owner",
  );
  const future = await store.create(
    { ...input, beginsAt: "2099-01-01T00:00:00Z" },
    "owner",
  );
  await store.addTask(future.id, task);
  const ended = await store.create(
    {
      ...input,
      beginsAt: "2020-01-01T00:00:00Z",
      endsAt: "2021-01-01T00:00:00Z",
    },
    "owner",
  );
  await store.addTask(ended.id, task);
  let app = createApplication({ dataDirectory: directory, verifyPlayerToken });
  const start = async () => {
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  };
  const stop = () => new Promise<void>((resolve) => app.close(() => resolve()));
  let base = await start();
  const joinHunt = (accessCode: unknown, token = "player-a") =>
    fetch(base + "/api/player/account/join", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ accessCode }),
    });
  try {
    expect(hunt.accessCode).toMatch(/^[A-F0-9]{8}$/);
    expect(new Set((await store.list()).map((h) => h.accessCode)).size).toBe(5);
    expect((await joinHunt(hunt.accessCode, "forged-token")).status).toBe(401);
    for (const code of ["wrong", hunt.id, null, ended.accessCode]) {
      const rejected = await joinHunt(code);
      expect(rejected.status).toBe(400);
      expect((await rejected.json()).message).toContain("Invalid access code");
    }
    expect((await joinHunt(empty.accessCode)).status).toBe(200);
    expect((await joinHunt(future.accessCode)).status).toBe(200);
    expect((await joinHunt(expiring.accessCode)).status).toBe(200);
    expect((await fetch(base + `/api/player/hunts/${hunt.id}`)).status).toBe(
      403,
    );
    expect((await joinHunt(` ${hunt.accessCode!.toLowerCase()} `)).status).toBe(
      200,
    );
    expect((await joinHunt(hunt.accessCode)).status).toBe(200);
    const concurrent = await Promise.all([
      joinHunt(hunt.accessCode),
      joinHunt(hunt.accessCode),
    ]);
    expect(concurrent.map((response) => response.status)).toEqual([200, 200]);
    await stop();
    app = createApplication({ dataDirectory: directory, verifyPlayerToken });
    base = await start();
    const restored = await fetch(base + "/api/player/account/hunts", {
      headers: { Authorization: "Bearer player-a-new-token" },
    });
    const saved = (await restored.json()).value;
    expect(saved).toHaveLength(4);
    const savedMain = saved.find((item) => item.id === hunt.id);
    const savedEmpty = saved.find((item) => item.id === empty.id);
    const savedFuture = saved.find((item) => item.id === future.id);
    expect(savedMain?.tasks[0].completed).toBe(false);
    expect(savedEmpty?.tasks).toEqual([]);
    expect(savedEmpty).toMatchObject({
      beginsAt: empty.beginsAt,
      endsAt: null,
      status: "draft",
    });
    expect(savedFuture?.beginsAt).toBe(future.beginsAt);
    expect(saved.find((item) => item.id === expiring.id)).toMatchObject({
      beginsAt: expiring.beginsAt,
      endsAt: null,
      status: "draft",
    });
    expect(JSON.stringify(saved)).not.toContain(hunt.accessCode);
    const definition = await store.get(hunt.id);
    const begins = Date.parse(definition.beginsAt);
    expect(isHuntActive(definition, begins)).toBe(true);
    expect(isHuntActive(definition, begins - 1)).toBe(false);
    expect(isHuntJoinable(definition, begins - 1)).toBe(true);
    expect(
      isHuntActive(
        { ...definition, endsAt: "2021-01-01T00:00:00Z" },
        Date.parse("2021-01-01T00:00:00Z"),
      ),
    ).toBe(false);
    expect(
      isHuntJoinable(
        { ...definition, endsAt: "2021-01-01T00:00:00Z" },
        Date.parse("2021-01-01T00:00:00Z"),
      ),
    ).toBe(false);
    expect(isHuntJoinable({ ...definition, status: "archived" })).toBe(false);
    const huntsPath = join(directory, "hunts.json");
    const storedHunts = JSON.parse(await readFile(huntsPath, "utf8"));
    storedHunts.hunts.find(
      (item: { id: string }) => item.id === expiring.id,
    ).endsAt = new Date(Date.now() - 1000).toISOString();
    await writeFile(huntsPath, JSON.stringify(storedHunts));
    const answerResponse = await fetch(
      base +
        `/api/player/account/hunts/${expiring.id}/tasks/${expiringTask.id}/answer`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer player-a-new-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ answer: task.requiredAnswer }),
      },
    );
    expect(answerResponse.status).toBe(400);
    expect((await answerResponse.json()).message).toContain("Hunt Ended");
    const path = join(directory, "hunts.json");
    const legacy = JSON.parse(await readFile(path, "utf8"));
    legacy.hunts[0].accessCode = null;
    await writeFile(path, JSON.stringify(legacy));
    const migrated = await Promise.all([
      store.getWithAccessCode(hunt.id),
      store.getWithAccessCode(hunt.id),
    ]);
    expect(migrated[0].accessCode).toBe(migrated[1].accessCode);
    expect((await new HuntStore(path).get(hunt.id)).accessCode).toBe(
      migrated[0].accessCode,
    );
    const progressPath = join(directory, "account-player-progress.json");
    await writeFile(progressPath, "{broken");
    expect((await joinHunt(migrated[0].accessCode)).status).toBe(500);
    expect(await readFile(progressPath, "utf8")).toBe("{broken");
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});
