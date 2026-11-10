import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { validateHunt } from "../validation/huntValidation.js";
import type {
  HuntConfigurationFile,
  HuntDefinition,
  HuntRole,
  OperationResult,
  TaskDefinition,
} from "../foundation/types.js";

export class StoreError extends Error {
  constructor(
    public code: "storage" | "validation" | "not-found" | "forbidden",
    message: string,
    public issues?: { field: string; message: string }[],
  ) {
    super(message);
  }
}

// One process owns each file. Keep read/modify/write in the same queue so
// concurrent requests cannot overwrite each other's updates.
interface FileSnapshot {
  value: unknown;
  modifiedAt: number;
  changedAt: number;
  size: number;
}
const fileSnapshots = new Map<string, FileSnapshot>();
const fileQueues = new Map<string, Promise<unknown>>();

export class JsonFile<T> {
  private readonly key: string;
  constructor(
    private path: string,
    private initial: () => T,
    private validate: (value: unknown) => T,
  ) {
    this.key = resolve(path);
  }
  private async read(): Promise<T> {
    try {
      const details = await stat(this.path);
      const cached = fileSnapshots.get(this.key);
      if (
        cached &&
        cached.modifiedAt === details.mtimeMs &&
        cached.changedAt === details.ctimeMs &&
        cached.size === details.size
      )
        return cached.value as T;
      const value = this.validate(
        JSON.parse(await readFile(this.path, "utf8")),
      );
      fileSnapshots.set(this.key, {
        value,
        modifiedAt: details.mtimeMs,
        changedAt: details.ctimeMs,
        size: details.size,
      });
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const cached = fileSnapshots.get(this.key);
        if (cached?.modifiedAt === -1) return cached.value as T;
        const value = this.validate(this.initial());
        fileSnapshots.set(this.key, {
          value,
          modifiedAt: -1,
          changedAt: -1,
          size: 0,
        });
        return value;
      }
      throw new StoreError(
        "storage",
        "Stored data could not be read or is invalid. It has not been overwritten.",
      );
    }
  }
  async get(): Promise<T> {
    await fileQueues.get(this.key);
    return structuredClone(await this.read());
  }
  async query<R>(project: (value: Readonly<T>) => R): Promise<R> {
    await fileQueues.get(this.key);
    return project(await this.read());
  }
  update<R>(operation: (value: T) => R): Promise<R> {
    const previous = fileQueues.get(this.key) ?? Promise.resolve();
    const task = previous.then(async () => {
      const value = structuredClone(await this.read());
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
        const details = await stat(this.path);
        fileSnapshots.set(this.key, {
          value: structuredClone(value),
          modifiedAt: details.mtimeMs,
          changedAt: details.ctimeMs,
          size: details.size,
        });
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
    fileQueues.set(
      this.key,
      task.catch(() => undefined),
    );
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
      "organizationName",
      "huntType",
      "maxParticipants",
      "participationClosed",
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
  async updateSettings(id: string, input: unknown): Promise<HuntDefinition> {
    const fields = object(input);
    inputFields(fields, [
      "organizationName",
      "maxParticipants",
      "participationClosed",
    ]);
    return this.file.update((data) => {
      const hunt = data.hunts.find((item) => item.id === id);
      if (!hunt) throw new StoreError("not-found", "Hunt not found.");
      Object.assign(hunt, fields, { updatedAt: new Date().toISOString() });
      return accepted(validateHunt(hunt));
    });
  }
  async list(): Promise<HuntDefinition[]> {
    return (await this.file.get()).hunts;
  }
  async listSummaries(): Promise<
    Pick<
      HuntDefinition,
      "id" | "name" | "ownerId" | "createdAt" | "updatedAt"
    >[]
  > {
    return this.file.query((data) =>
      data.hunts.map(({ id, name, ownerId, createdAt, updatedAt }) => ({
        id,
        name,
        ownerId,
        createdAt,
        updatedAt,
      })),
    );
  }
  async migrateLegacyOwners(accountId: string): Promise<number> {
    return this.file.update((data) => {
      let migrated = 0;
      for (const hunt of data.hunts) {
        if (/^browser:[a-f0-9]{64}$/.test(hunt.ownerId)) {
          hunt.ownerId = accountId;
          migrated += 1;
        }
      }
      return migrated;
    });
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
  async delete(id: string): Promise<{ deleted: true }> {
    return this.file.update((data) => {
      const index = data.hunts.findIndex((item) => item.id === id);
      if (index < 0) throw new StoreError("not-found", "Hunt not found.");
      data.hunts.splice(index, 1);
      return { deleted: true as const };
    });
  }
  async findByAccessCode(code: string): Promise<HuntDefinition | undefined> {
    return (await this.list()).find((hunt) => hunt.accessCode === code);
  }
  async addTask(id: string, input: unknown): Promise<TaskDefinition> {
    const fields = object(input);
    inputFields(fields, [
      "timeLimitSeconds",
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
      "timeLimitSeconds",
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
  invitations: Record<string, string[]>;
  roles: Record<string, Record<string, "owner" | "officer">>;
  emails: Record<string, Record<string, string>>;
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
  data.invitations ??= {};
  data.roles ??= {};
  data.emails ??= {};
  if (
    !data.invitations ||
    typeof data.invitations !== "object" ||
    Array.isArray(data.invitations)
  )
    throw new Error("Invalid contributor configuration");
  if (
    !data.roles ||
    typeof data.roles !== "object" ||
    Array.isArray(data.roles)
  )
    throw new Error("Invalid contributor configuration");
  if (
    !data.emails ||
    typeof data.emails !== "object" ||
    Array.isArray(data.emails)
  )
    throw new Error("Invalid contributor configuration");
  for (const [huntId, members] of Object.entries(data.contributors)) {
    if (
      !/^[a-zA-Z0-9-]+$/.test(huntId) ||
      !Array.isArray(members) ||
      members.some(
        (id) =>
          typeof id !== "string" ||
          !/^(?:browser:[a-f0-9]{64}|google-[a-f0-9]{64})$/.test(id),
      )
    )
      throw new Error("Invalid contributor configuration");
  }
  for (const [huntId, emails] of Object.entries(data.invitations)) {
    if (
      !/^[a-zA-Z0-9-]+$/.test(huntId) ||
      !Array.isArray(emails) ||
      emails.some(
        (email) =>
          typeof email !== "string" ||
          email.length > 254 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          email !== email.toLowerCase(),
      )
    )
      throw new Error("Invalid contributor configuration");
  }
  for (const [huntId, roles] of Object.entries(data.roles)) {
    if (
      !/^[a-zA-Z0-9-]+$/.test(huntId) ||
      !roles ||
      typeof roles !== "object" ||
      Array.isArray(roles) ||
      Object.entries(roles).some(
        ([id, role]) =>
          !/^(?:browser:[a-f0-9]{64}|google-[a-f0-9]{64})$/.test(id) ||
          (role !== "owner" && role !== "officer"),
      )
    )
      throw new Error("Invalid contributor configuration");
  }
  for (const [huntId, emails] of Object.entries(data.emails)) {
    if (
      !/^[a-zA-Z0-9-]+$/.test(huntId) ||
      !emails ||
      typeof emails !== "object" ||
      Array.isArray(emails) ||
      Object.entries(emails).some(
        ([id, email]) =>
          !/^(?:browser:[a-f0-9]{64}|google-[a-f0-9]{64})$/.test(id) ||
          typeof email !== "string" ||
          email.length > 254 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          email !== email.toLowerCase(),
      )
    )
      throw new Error("Invalid contributor configuration");
  }
  return data;
}
export interface HuntContributorEntry {
  id: string;
  role: HuntRole;
  pending: boolean;
  originalOwner: boolean;
  email?: string;
  displayName?: string;
}
// Keep membership separate so existing version-1 hunt definitions remain valid.
export class ContributorStore {
  private file: JsonFile<ContributorFile>;
  constructor(path: string) {
    this.file = new JsonFile(
      path,
      () => ({
        schemaVersion: 1,
        contributors: {},
        invitations: {},
        roles: {},
        emails: {},
      }),
      contributorFile,
    );
  }
  async all(): Promise<Record<string, string[]>> {
    return (await this.file.get()).contributors;
  }
  async huntIdsFor(memberId: string): Promise<Set<string>> {
    return this.file.query(
      (data) =>
        new Set(
          Object.entries(data.contributors)
            .filter(([, members]) => members.includes(memberId))
            .map(([huntId]) => huntId),
        ),
    );
  }
  async members(huntId: string): Promise<string[]> {
    const all = await this.all();
    return Object.hasOwn(all, huntId) ? all[huntId] : [];
  }
  async roleFor(
    huntId: string,
    memberId: string,
    originalOwnerId: string,
  ): Promise<HuntRole | undefined> {
    if (memberId === originalOwnerId) return "owner";
    return this.file.query((data) => {
      if (!(data.contributors[huntId] ?? []).includes(memberId))
        return undefined;
      return data.roles[huntId]?.[memberId] ?? "contributor";
    });
  }
  async entries(
    huntId: string,
    originalOwnerId?: string,
    originalOwnerName?: string,
  ): Promise<HuntContributorEntry[]> {
    const data = await this.file.get();
    const members = data.contributors[huntId] ?? [];
    const invites = data.invitations[huntId] ?? [];
    const entries: HuntContributorEntry[] = [
      ...members.map((id) => ({
        id,
        role: data.roles[huntId]?.[id] ?? "contributor",
        pending: false,
        originalOwner: false,
        ...(data.emails[huntId]?.[id]
          ? { email: data.emails[huntId][id] }
          : {}),
      })),
      ...invites.map((email) => ({
        id: `invite:${email}`,
        role: "contributor" as const,
        pending: true,
        originalOwner: false,
      })),
    ];
    if (originalOwnerId)
      entries.unshift({
        id: "original-owner",
        role: "owner",
        pending: false,
        originalOwner: true,
        ...(originalOwnerName ? { displayName: originalOwnerName } : {}),
      });
    return entries;
  }
  async setRole(
    huntId: string,
    memberId: string,
    role: unknown,
    originalOwnerId: string,
    requesterId = "",
  ): Promise<void> {
    if (memberId === originalOwnerId)
      throw new StoreError(
        "forbidden",
        "The original hunt owner cannot be demoted or changed.",
      );
    if (memberId === requesterId)
      throw new StoreError(
        "forbidden",
        "You cannot change your own hunt role.",
      );
    if (role !== "owner" && role !== "officer" && role !== "contributor")
      throw new StoreError("validation", "Choose a valid hunt role.");
    await this.file.update((data) => {
      if (!(data.contributors[huntId] ?? []).includes(memberId))
        throw new StoreError("not-found", "Hunt contributor not found.");
      if (!Object.hasOwn(data.roles, huntId)) data.roles[huntId] = {};
      if (role === "contributor") delete data.roles[huntId][memberId];
      else data.roles[huntId][memberId] = role;
      if (Object.keys(data.roles[huntId]).length === 0)
        delete data.roles[huntId];
    });
  }
  async invite(huntId: string, email: unknown): Promise<void> {
    if (
      typeof email !== "string" ||
      email.trim().length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    )
      throw new StoreError("validation", "Enter a valid collaborator email.");
    const normalized = email.trim().toLowerCase();
    await this.file.update((data) => {
      if (!Object.hasOwn(data.invitations, huntId))
        data.invitations[huntId] = [];
      if (!data.invitations[huntId].includes(normalized))
        data.invitations[huntId].push(normalized);
    });
  }
  async acceptInvitations(email: string, accountId: string): Promise<void> {
    const normalized = email.toLowerCase();
    if (!/^google-[a-f0-9]{64}$/.test(accountId)) return;
    const current = await this.file.get();
    if (
      !Object.values(current.invitations).some((invites) =>
        invites.includes(normalized),
      )
    )
      return;
    await this.file.update((data) => {
      for (const [huntId, invites] of Object.entries(data.invitations)) {
        if (!invites.includes(normalized)) continue;
        if (!Object.hasOwn(data.contributors, huntId))
          data.contributors[huntId] = [];
        if (!data.contributors[huntId].includes(accountId))
          data.contributors[huntId].push(accountId);
        if (!Object.hasOwn(data.emails, huntId)) data.emails[huntId] = {};
        data.emails[huntId][accountId] = normalized;
        data.invitations[huntId] = invites.filter(
          (invitedEmail) => invitedEmail !== normalized,
        );
      }
    });
  }
  async linkLegacyCreator(legacyId: string, accountId: string): Promise<void> {
    if (
      !/^browser:[a-f0-9]{64}$/.test(legacyId) ||
      !/^google-[a-f0-9]{64}$/.test(accountId)
    )
      return;
    await this.file.update((data) => {
      for (const members of Object.values(data.contributors)) {
        if (!members.includes(legacyId)) continue;
        const remaining = members.filter((id) => id !== legacyId);
        if (!remaining.includes(accountId)) remaining.push(accountId);
        members.splice(0, members.length, ...remaining);
      }
      for (const roles of Object.values(data.roles)) {
        if (roles[legacyId]) {
          roles[accountId] = roles[legacyId];
          delete roles[legacyId];
        }
      }
      for (const emails of Object.values(data.emails)) {
        if (emails[legacyId]) {
          emails[accountId] = emails[legacyId];
          delete emails[legacyId];
        }
      }
    });
  }
  async add(huntId: string, creatorId: unknown): Promise<void> {
    if (
      typeof creatorId !== "string" ||
      !/^(?:browser:[a-f0-9]{64}|google-[a-f0-9]{64})$/.test(creatorId)
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
  async remove(
    huntId: string,
    creatorId: string,
    requesterId: string,
    originalOwnerId: string,
  ): Promise<void> {
    if (creatorId === originalOwnerId)
      throw new StoreError(
        "forbidden",
        "The original hunt owner cannot be removed.",
      );
    if (!creatorId.startsWith("invite:") && creatorId === requesterId)
      throw new StoreError(
        "forbidden",
        "You cannot remove your own hunt access.",
      );
    await this.file.update((data) => {
      if (creatorId.startsWith("invite:")) {
        const email = creatorId.slice("invite:".length).toLowerCase();
        if (Object.hasOwn(data.invitations, huntId))
          data.invitations[huntId] = data.invitations[huntId].filter(
            (invitedEmail) => invitedEmail !== email,
          );
        return;
      }
      if (Object.hasOwn(data.contributors, huntId))
        data.contributors[huntId] = data.contributors[huntId].filter(
          (id) => id !== creatorId,
        );
      if (data.roles[huntId]) {
        delete data.roles[huntId][creatorId];
        if (Object.keys(data.roles[huntId]).length === 0)
          delete data.roles[huntId];
      }
      if (data.emails[huntId]) {
        delete data.emails[huntId][creatorId];
        if (Object.keys(data.emails[huntId]).length === 0)
          delete data.emails[huntId];
      }
    });
  }
  async removeHunt(huntId: string): Promise<void> {
    await this.file.update((data) => {
      delete data.contributors[huntId];
      delete data.invitations[huntId];
      delete data.roles[huntId];
      delete data.emails[huntId];
    });
  }
}
