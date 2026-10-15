import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createUserStore,
  UserAlreadyExistsError,
  UserDataCorruptError,
  UserDataValidationError,
  UserNotFoundError,
} from "../server/userStore.mjs";

const fixedTime = new Date("2026-10-15T12:00:00.000Z");

async function withStore(run) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "buchunt-user-store-"));
  const store = createUserStore({
    dataDir,
    clock: () => fixedTime,
    idGenerator: (() => {
      let nextId = 0;
      return () => "generated-id-" + ++nextId;
    })(),
  });
  try {
    await run({ dataDir, store });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

test("creates isolated private files for accounts and reloads them", async () => {
  await withStore(async ({ dataDir, store }) => {
    const first = await store.createUser("account-one", {
      displayName: "First User",
    });
    await store.createUser("account-two", { displayName: "Second User" });

    expect(first).toEqual({
      schemaVersion: 1,
      profile: {
        id: "account-one",
        displayName: "First User",
        createdAt: fixedTime.toISOString(),
        updatedAt: fixedTime.toISOString(),
      },
      hunts: [],
    });
    const files = await readdir(path.join(dataDir, "users"));
    expect(files).toHaveLength(2);
    expect(files.every((file) => /^[a-f0-9]{64}\.json$/.test(file))).toBe(true);
    expect(files.some((file) => file.includes("account-one"))).toBe(false);

    const restartedStore = createUserStore({ dataDir, clock: () => fixedTime });
    expect(await restartedStore.getUser("account-one")).toEqual(first);
    expect(await restartedStore.getUser("missing-account")).toBeNull();
  });
});

test("creates a Hunt and Tasks with server-owned metadata and persists them", async () => {
  await withStore(async ({ dataDir, store }) => {
    await store.createUser("account-one", { displayName: "First User" });
    const hunt = await store.createHunt("account-one", {
      name: "Campus Hunt",
      description: "Explore campus.",
    });
    const task = await store.addTask("account-one", hunt.id, {
      displayLabel: "Old Fountain",
      description: "Find the fountain.",
      requiredAnswer: "blue",
      location: { latitude: 36.3, longitude: -82.4 },
      order: 1,
    });

    expect(hunt.ownerId).toBe("account-one");
    expect(hunt.status).toBe("draft");
    expect(hunt.beginsAt).toBe(fixedTime.toISOString());
    expect(hunt.tasks).toEqual([]);
    expect(task).toMatchObject({
      id: "generated-id-2",
      answerCaseSensitive: false,
      hint: null,
      points: 0,
    });
    const stored = await store.getUser("account-one");
    expect(stored.hunts[0].tasks).toEqual([task]);

    const restartedStore = createUserStore({ dataDir, clock: () => fixedTime });
    expect(await restartedStore.getHunt("account-one", hunt.id)).toEqual({
      ...hunt,
      tasks: [task],
      updatedAt: fixedTime.toISOString(),
    });
  });
});

test("serializes concurrent mutations without losing Hunts or Tasks", async () => {
  await withStore(async ({ store }) => {
    await store.createUser("account-one", { displayName: "First User" });
    const hunts = await Promise.all(
      ["One", "Two", "Three"].map((name) =>
        store.createHunt("account-one", {
          name,
          description: "Description for " + name,
        }),
      ),
    );
    const tasks = await Promise.all(
      [1, 2, 3].map((order) =>
        store.addTask("account-one", hunts[0].id, {
          displayLabel: "Task " + order,
          description: "Description " + order,
          requiredAnswer: "answer " + order,
          location: { latitude: 36.3, longitude: -82.4 },
          order,
        }),
      ),
    );
    const value = await store.getUser("account-one");
    expect(value.hunts).toHaveLength(3);
    expect(value.hunts[0].tasks).toHaveLength(3);
    expect(new Set(value.hunts[0].tasks.map((task) => task.id)).size).toBe(3);
    expect(new Set(tasks.map((task) => task.order)).size).toBe(3);
  });
});

test("rejects invalid input and does not persist it", async () => {
  await withStore(async ({ store }) => {
    await store.createUser("account-one", { displayName: "First User" });
    await expect(
      store.createUser("account-one", { displayName: "Duplicate" }),
    ).rejects.toBeInstanceOf(UserAlreadyExistsError);
    await expect(
      store.createHunt("account-one", {
        name: " ",
        description: "Missing name",
      }),
    ).rejects.toBeInstanceOf(UserDataValidationError);
    await expect(store.getUser("account-one")).resolves.toMatchObject({
      hunts: [],
    });
  });
});

test("rejects a task with duplicate order and leaves the stored Hunt unchanged", async () => {
  await withStore(async ({ store }) => {
    await store.createUser("account-one", { displayName: "First User" });
    const hunt = await store.createHunt("account-one", {
      name: "Campus Hunt",
      description: "Explore campus.",
    });
    const input = {
      displayLabel: "First",
      description: "First clue",
      requiredAnswer: "blue",
      location: { latitude: 36.3, longitude: -82.4 },
      order: 1,
    };
    await store.addTask("account-one", hunt.id, input);
    await expect(
      store.addTask("account-one", hunt.id, {
        ...input,
        displayLabel: "Duplicate order",
      }),
    ).rejects.toBeInstanceOf(UserDataValidationError);
    await expect(store.getHunt("account-one", hunt.id)).resolves.toMatchObject({
      tasks: [{ displayLabel: "First" }],
    });
  });
});

test("preserves and reports corrupt or unsupported user files", async () => {
  await withStore(async ({ dataDir, store }) => {
    await store.createUser("account-one", { displayName: "First User" });
    const fileName = (await readdir(path.join(dataDir, "users")))[0];
    const filePath = path.join(dataDir, "users", fileName);
    await writeFile(filePath, "{broken json", "utf8");
    await expect(store.getUser("account-one")).rejects.toBeInstanceOf(
      UserDataCorruptError,
    );
    await expect(readFile(filePath, "utf8")).resolves.toBe("{broken json");
  });
});

test("reports storage failures without claiming the profile was saved", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "buchunt-user-store-failure-"));
  const dataDir = path.join(parent, "not-a-directory");
  await writeFile(dataDir, "blocker", "utf8");
  try {
    const store = createUserStore({ dataDir, clock: () => fixedTime });
    await expect(
      store.createUser("account-one", { displayName: "First User" }),
    ).rejects.toMatchObject({ code: "storage" });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("requires an existing user before modifying Hunts", async () => {
  await withStore(async ({ store }) => {
    await expect(store.listHunts("missing-account")).rejects.toBeInstanceOf(
      UserNotFoundError,
    );
    await expect(
      store.createHunt("missing-account", {
        name: "Campus Hunt",
        description: "Explore campus.",
      }),
    ).rejects.toBeInstanceOf(UserNotFoundError);
  });
});

