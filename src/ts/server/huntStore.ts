import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { validateHunt } from "../validation/huntValidation.js";
import type {
  HuntConfigurationFile,
  HuntDefinition,
  OperationResult,
  TaskDefinition,
} from "../foundation/types.js";

export class StoreError extends Error {
  constructor(
    public code: "storage" | "validation" | "not-found",
    message: string,
    public issues?: { field: string; message: string }[],
  ) {
    super(message);
  }
}

// One process owns each file. Keep read/modify/write in the same queue so
// concurrent requests cannot overwrite each other's updates.
export class JsonFile<T> {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private path: string,
    private initial: () => T,
    private validate: (value: unknown) => T,
  ) {}
  private async read(): Promise<T> {
    try {
      return this.validate(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return this.initial();
      throw new StoreError(
        "storage",
        "Stored data could not be read or is invalid. It has not been overwritten.",
      );
    }
  }
  async get(): Promise<T> {
    await this.tail;
    return this.read();
  }
  update<R>(operation: (value: T) => R): Promise<R> {
    const task = this.tail.then(async () => {
      const value = await this.read();
      const result = operation(value);
      this.validate(value);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        const file = await open(temporary, "wx", 0o600);
        try {
          await file.writeFile(JSON.stringify(value, null, 2) + "\n");
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, this.path);
        // POSIX directory fsync makes the rename durable. Windows does not
        // support opening directories this way; the file itself is still synced.
        if (process.platform !== "win32") {
          const directory = await open(dirname(this.path), "r");
          try {
            await directory.sync();
          } finally {
            await directory.close();
          }
        }
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
      return result;
    });
    this.tail = task.catch(() => undefined);
    return task;
  }
}

function configuration(value: unknown): HuntConfigurationFile {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid configuration");
  const data = value as HuntConfigurationFile;
  if (
    data.schemaVersion !== 1 ||
    !Array.isArray(data.hunts) ||
    Object.keys(data).some((key) => !["schemaVersion", "hunts"].includes(key))
  )
    throw new Error("Unsupported configuration");
  const ids = new Set<string>();
  const codes = new Set<string>();
  for (const hunt of data.hunts) {
    if (!validateHunt(hunt).ok || ids.has(hunt.id))
      throw new Error("Invalid stored hunt");
    ids.add(hunt.id);
    if (hunt.accessCode) {
      if (codes.has(hunt.accessCode)) throw new Error("Duplicate access code");
      codes.add(hunt.accessCode);
    }
  }
  return data;
}
function accepted(result: OperationResult<HuntDefinition>): HuntDefinition {
  if (!result.ok)
    throw new StoreError("validation", result.message, result.issues);
  return result.value;
}
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new StoreError("validation", "Submit a JSON object.");
  return input as Record<string, unknown>;
}
function inputFields(input: Record<string, unknown>, allowed: string[]): void {
  const unexpected = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unexpected.length)
    throw new StoreError(
      "validation",
      "Unknown input fields.",
      unexpected.map((field) => ({ field, message: "Unknown input field." })),
    );
}
function newAccessCode(hunts: HuntDefinition[]): string {
  let code: string;
  do {
    code = randomBytes(4).toString("hex").toUpperCase();
  } while (hunts.some((hunt) => hunt.accessCode === code));
  return code;
}
export function isHuntJoinable(
  hunt: HuntDefinition,
  now = Date.now(),
): boolean {
  return (
    hunt.status !== "archived" &&
    (hunt.endsAt === null || now < Date.parse(hunt.endsAt))
  );
}

export function isHuntActive(hunt: HuntDefinition, now = Date.now()): boolean {
  return (
    hunt.status !== "archived" &&
    Date.parse(hunt.beginsAt) <= now &&
    (hunt.endsAt === null || now < Date.parse(hunt.endsAt))
  );
}
export class HuntStore {
  private file: JsonFile<HuntConfigurationFile>;
  constructor(path: string) {
    this.file = new JsonFile(
      path,
      () => ({ schemaVersion: 1, hunts: [] }),
      configuration,
    );
  }
  async create(input: unknown, ownerId: string): Promise<HuntDefinition> {
    const fields = object(input);
    inputFields(fields, [
      "name",
      "description",
      "ownerId",
      "beginsAt",
      "endsAt",
      "taskOrderMode",
    ]);
    const now = new Date().toISOString();
    const hunt = accepted(
      validateHunt({
        ...fields,
        ownerId,
        id: randomUUID(),
        status: "draft",
        createdAt: now,
        updatedAt: now,
        accessCode: null,
        tasks: [],
      }),
    );
    return this.file.update((data) => {
      hunt.accessCode = newAccessCode(data.hunts);
      data.hunts.push(hunt);
      return hunt;
    });
  }
  async list(): Promise<HuntDefinition[]> {
    return (await this.file.get()).hunts;
  }
  async get(id: string): Promise<HuntDefinition> {
    const hunt = (await this.file.get()).hunts.find((item) => item.id === id);
    if (!hunt) throw new StoreError("not-found", "Hunt not found.");
    return hunt;
  }
  async getWithAccessCode(id: string): Promise<HuntDefinition> {
    const hunt = await this.get(id);
    if (hunt.accessCode) return hunt;
    return this.file.update((data) => {
      const saved = data.hunts.find((item) => item.id === id);
      if (!saved) throw new StoreError("not-found", "Hunt not found.");
      saved.accessCode ??= newAccessCode(data.hunts);
      return saved;
    });
  }
  async findByAccessCode(code: string): Promise<HuntDefinition | undefined> {
    return (await this.list()).find((hunt) => hunt.accessCode === code);
  }
  async addTask(id: string, input: unknown): Promise<TaskDefinition> {
    const fields = object(input);
    inputFields(fields, [
      "taskType",
      "choices",
      "displayLabel",
      "description",
      "requiredAnswer",
      "location",
      "order",
      "answerCaseSensitive",
      "hint",
      "points",
    ]);
    return this.file.update((data) => {
      const hunt = data.hunts.find((item) => item.id === id);
      if (!hunt) throw new StoreError("not-found", "Hunt not found.");
      const task = { ...fields, id: randomUUID() } as unknown as TaskDefinition;
      hunt.tasks.push(task);
      hunt.updatedAt = new Date().toISOString();
      accepted(validateHunt(hunt));
      hunt.tasks.sort((left, right) => left.order - right.order);
      return task;
    });
  }
  async updateTask(
    id: string,
    taskId: string,
    input: unknown,
  ): Promise<TaskDefinition> {
    const fields = object(input);
    inputFields(fields, [
      "taskType",
      "choices",
      "displayLabel",
      "description",
      "requiredAnswer",
      "location",
      "order",
      "answerCaseSensitive",
      "hint",
      "points",
    ]);
    return this.file.update((data) => {
      const hunt = data.hunts.find((item) => item.id === id);
      if (!hunt) throw new StoreError("not-found", "Hunt not found.");
      const index = hunt.tasks.findIndex((item) => item.id === taskId);
      if (index < 0) throw new StoreError("not-found", "Task not found.");
      const previous = hunt.tasks[index];
      if (!previous) throw new StoreError("not-found", "Task not found.");
      const task = {
        ...previous,
        ...fields,
        id: previous.id,
      } as TaskDefinition;
      hunt.tasks[index] = task;
      hunt.updatedAt = new Date().toISOString();
      accepted(validateHunt(hunt));
      hunt.tasks.sort((left, right) => left.order - right.order);
      return task;
    });
  }
  async deleteTask(id: string, taskId: string): Promise<{ deleted: true }> {
    return this.file.update((data) => {
      const hunt = data.hunts.find((item) => item.id === id);
      if (!hunt) throw new StoreError("not-found", "Hunt not found.");
      const index = hunt.tasks.findIndex((item) => item.id === taskId);
      if (index < 0) throw new StoreError("not-found", "Task not found.");
      hunt.tasks.splice(index, 1);
      hunt.updatedAt = new Date().toISOString();
      accepted(validateHunt(hunt));
      return { deleted: true as const };
    });
  }
}

interface ContributorFile {
  schemaVersion: 1;
  contributors: Record<string, string[]>;
}
function contributorFile(value: unknown): ContributorFile {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid contributor configuration");
  const data = value as ContributorFile;
  if (
    data.schemaVersion !== 1 ||
    !data.contributors ||
    typeof data.contributors !== "object" ||
    Array.isArray(data.contributors)
  )
    throw new Error("Invalid contributor configuration");
  for (const [huntId, members] of Object.entries(data.contributors)) {
    if (
      !/^[a-zA-Z0-9-]+$/.test(huntId) ||
      !Array.isArray(members) ||
      members.some(
        (id) => typeof id !== "string" || !/^browser:[a-f0-9]{64}$/.test(id),
      )
    )
      throw new Error("Invalid contributor configuration");
  }
  return data;
}
// Keep membership separate so existing version-1 hunt definitions remain valid.
// Future account integration must explicitly map these temporary creator IDs.
export class ContributorStore {
  private file: JsonFile<ContributorFile>;
  constructor(path: string) {
    this.file = new JsonFile(
      path,
      () => ({ schemaVersion: 1, contributors: {} }),
      contributorFile,
    );
  }
  async all(): Promise<Record<string, string[]>> {
    return (await this.file.get()).contributors;
  }
  async members(huntId: string): Promise<string[]> {
    const all = await this.all();
    return Object.hasOwn(all, huntId) ? all[huntId] : [];
  }
  async add(huntId: string, creatorId: unknown): Promise<void> {
    if (
      typeof creatorId !== "string" ||
      !/^browser:[a-f0-9]{64}$/.test(creatorId)
    )
      throw new StoreError(
        "validation",
        "Enter the contributor's creator ID from their Hunt Studio page.",
      );
    await this.file.update((data) => {
      if (!Object.hasOwn(data.contributors, huntId))
        data.contributors[huntId] = [];
      if (!data.contributors[huntId].includes(creatorId))
        data.contributors[huntId].push(creatorId);
    });
  }
  async remove(huntId: string, creatorId: string): Promise<void> {
    await this.file.update((data) => {
      if (Object.hasOwn(data.contributors, huntId))
        data.contributors[huntId] = data.contributors[huntId].filter(
          (id) => id !== creatorId,
        );
    });
  }
}
