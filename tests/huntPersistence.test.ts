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
import { HuntStore } from "../src/ts/server/huntStore.js";
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
const token = "test-administrator-token";

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
    const before = await readFile(path, "utf8");
    await expect(store.addTask(hunt.id, task)).rejects.toThrow("invalid");
    await expect(
      store.addTask(hunt.id, { ...task, requiredAnswer: "", order: 20 }),
    ).rejects.toThrow("invalid");
    expect(await readFile(path, "utf8")).toBe(before);
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

test("HTTP authorization, validation, private projections, progress and server restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "buchunt-api-"));
  let app = createApplication({ adminToken: token, dataDirectory: directory });
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
  const admin = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  try {
    expect(
      (
        await fetch(base + "/api/admin/hunts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
    const id = created.value.id;
    const saved = await (
      await fetch(base + `/api/admin/hunts/${id}/tasks`, {
        method: "POST",
        headers: admin,
        body: JSON.stringify(task),
      })
    ).json();
    expect(saved.ok).toBe(true);
    const player = await fetch(base + `/api/player/hunts/${id}`);
    const cookie = player.headers.get("set-cookie")!.split(";")[0];
    const projection = await player.json();
    expect(projection.value.tasks[0].completed).toBe(false);
    expect(JSON.stringify(projection)).not.toContain("Bucky");
    expect(JSON.stringify(projection)).not.toContain("ownerId");
    const answerPath = `/api/player/hunts/${id}/tasks/${saved.value.id}/answer`;
    expect(
      (
        await fetch(base + answerPath, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: '{"answer":"wrong"}',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(base + answerPath, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: '{"answer":"bucky"}',
        })
      ).status,
    ).toBe(200);
    expect((await fetch(base + "/data/hunts.json")).status).toBe(404);
    expect((await fetch(base + "/js/server/server.js")).status).toBe(404);
    expect((await fetch(base + "/api/player/hunts/missing")).status).toBe(404);
    await stop();
    app = createApplication({ adminToken: token, dataDirectory: directory });
    base = await start();
    const restored = await (
      await fetch(base + `/api/player/hunts/${id}`, {
        headers: { Cookie: cookie },
      })
    ).json();
    expect(restored.value.tasks[0].completed).toBe(true);
    const adminHunt = await (
      await fetch(base + `/api/admin/hunts/${id}`, { headers: admin })
    ).json();
    expect(adminHunt.value.tasks[0].requiredAnswer).toBe("Bucky");
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("saved hunt configuration survives terminating and starting the Node process", async () => {
  const directory = await mkdtemp(join(tmpdir(), "buchunt-process-"));
  let child: ChildProcess | undefined;
  async function start(): Promise<string> {
    const moduleUrl = pathToFileURL(resolve("src/js/server/server.js")).href;
    const script = `import {createApplication} from ${JSON.stringify(moduleUrl)}; const app = createApplication({adminToken:process.env.ADMIN_TOKEN, dataDirectory:process.env.DATA_DIRECTORY}); app.listen(0, '127.0.0.1', () => process.send(app.address().port));`;
    child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, DATA_DIRECTORY: directory, ADMIN_TOKEN: token },
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
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const saved = await (
      await fetch(base + "/api/admin/hunts", {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      })
    ).json();
    expect(saved.ok).toBe(true);
    await stop();
    base = await start();
    const loaded = await (
      await fetch(base + `/api/admin/hunts/${saved.value.id}`, { headers })
    ).json();
    expect(loaded.value).toEqual(saved.value);
  } finally {
    await stop();
    await rm(directory, { recursive: true, force: true });
  }
});
