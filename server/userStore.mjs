import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

const USER_SCHEMA_VERSION = 1;
const HUNT_FIELDS = [
  "id",
  "name",
  "description",
  "ownerId",
  "beginsAt",
  "endsAt",
  "status",
  "createdAt",
  "updatedAt",
  "accessCode",
  "taskOrderMode",
  "tasks",
];
const TASK_FIELDS = [
  "id",
  "displayLabel",
  "description",
  "requiredAnswer",
  "location",
  "order",
  "answerCaseSensitive",
  "hint",
  "points",
];

export class UserStoreError extends Error {
  constructor(message, code, options) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class UserDataValidationError extends UserStoreError {
  constructor(issues) {
    super("User data is invalid.", "validation");
    this.issues = issues;
  }
}

export class UserDataCorruptError extends UserStoreError {
  constructor(accountId, options) {
    super("Stored user data is invalid or unreadable.", "storage", options);
    this.accountId = accountId;
  }
}

export class UserAlreadyExistsError extends UserStoreError {
  constructor() {
    super("A profile already exists for this account.", "already-exists");
  }
}

export class UserNotFoundError extends UserStoreError {
  constructor() {
    super("The account profile was not found.", "not-found");
  }
}

export class HuntNotFoundError extends UserStoreError {
  constructor() {
    super("The hunt was not found for this account.", "not-found");
  }
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactFields(value, fields, prefix, issues) {
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) {
      issues.push({ field: prefix + field, message: "Required field is missing." });
    }
  }
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) {
      issues.push({ field: prefix + field, message: "Unknown field is not allowed." });
    }
  }
}

function checkText(value, field, issues) {
  if (typeof value !== "string" || !/\S/.test(value)) {
    issues.push({ field, message: "Must be a nonblank string." });
  }
}

function timestamp(value) {
  if (typeof value !== "string") return undefined;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/.exec(
      value,
    );
  if (!match) return undefined;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1] ||
    Number(hourText) > 23 ||
    Number(minuteText) > 59 ||
    Number(secondText) > 59
  ) {
    return undefined;
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : undefined;
}

function checkTimestamp(value, field, issues) {
  const result = timestamp(value);
  if (result === undefined) {
    issues.push({
      field,
      message: "Must be a valid UTC date-time ending in Z.",
    });
  }
  return result;
}

function validateTask(value, prefix, ids, orders, issues) {
  if (!isObject(value)) {
    issues.push({ field: prefix.slice(0, -1), message: "Task must be an object." });
    return;
  }
  hasExactFields(value, TASK_FIELDS, prefix, issues);
  for (const field of ["id", "displayLabel", "description", "requiredAnswer"]) {
    checkText(value[field], prefix + field, issues);
  }
  if (typeof value.id === "string") {
    if (ids.has(value.id)) {
      issues.push({ field: prefix + "id", message: "Task IDs must be unique within a Hunt." });
    }
    ids.add(value.id);
  }
  if (value.hint !== null) checkText(value.hint, prefix + "hint", issues);
  if (typeof value.answerCaseSensitive !== "boolean") {
    issues.push({
      field: prefix + "answerCaseSensitive",
      message: "Must be a boolean.",
    });
  }
  for (const [field, minimum] of [["order", 1], ["points", 0]]) {
    const number = value[field];
    if (typeof number !== "number" || !Number.isInteger(number) || number < minimum) {
      issues.push({
        field: prefix + field,
        message: "Must be an integer of at least " + minimum + ".",
      });
    }
  }
  if (typeof value.order === "number") {
    if (orders.has(value.order)) {
      issues.push({
        field: prefix + "order",
        message: "Task orders must be unique within a Hunt.",
      });
    }
    orders.add(value.order);
  }
  if (!isObject(value.location)) {
    issues.push({
      field: prefix + "location",
      message: "Must be a coordinate object.",
    });
    return;
  }
  hasExactFields(value.location, ["latitude", "longitude"], prefix + "location.", issues);
  for (const [field, limit] of [["latitude", 90], ["longitude", 180]]) {
    const coordinate = value.location[field];
    if (
      typeof coordinate !== "number" ||
      !Number.isFinite(coordinate) ||
      Math.abs(coordinate) > limit
    ) {
      issues.push({
        field: prefix + "location." + field,
        message: "Must be a finite number between -" + limit + " and " + limit + ".",
      });
    }
  }
}

function validateHunt(value, accountId, prefix, issues, ids) {
  if (!isObject(value)) {
    issues.push({ field: prefix.slice(0, -1), message: "Hunt must be an object." });
    return;
  }
  hasExactFields(value, HUNT_FIELDS, prefix, issues);
  for (const field of ["id", "name", "description", "ownerId"]) {
    checkText(value[field], prefix + field, issues);
  }
  if (value.ownerId !== accountId) {
    issues.push({
      field: prefix + "ownerId",
      message: "Hunt owner must match the account that stores it.",
    });
  }
  if (typeof value.id === "string") {
    if (ids.has(value.id)) {
      issues.push({ field: prefix + "id", message: "Hunt IDs must be unique per account." });
    }
    ids.add(value.id);
  }
  if (!["draft", "published", "archived"].includes(value.status)) {
    issues.push({
      field: prefix + "status",
      message: "Must be draft, published, or archived.",
    });
  }
  if (value.taskOrderMode !== "sequential" && value.taskOrderMode !== "any") {
    issues.push({
      field: prefix + "taskOrderMode",
      message: "Must be sequential or any.",
    });
  }
  if (value.accessCode !== null) {
    issues.push({ field: prefix + "accessCode", message: "Must be null until access codes are implemented." });
  }
  const beginsAt = checkTimestamp(value.beginsAt, prefix + "beginsAt", issues);
  const endsAt =
    value.endsAt === null
      ? undefined
      : checkTimestamp(value.endsAt, prefix + "endsAt", issues);
  const createdAt = checkTimestamp(value.createdAt, prefix + "createdAt", issues);
  const updatedAt = checkTimestamp(value.updatedAt, prefix + "updatedAt", issues);
  if (beginsAt !== undefined && endsAt !== undefined && endsAt <= beginsAt) {
    issues.push({
      field: prefix + "endsAt",
      message: "Must be later than beginsAt.",
    });
  }
  if (createdAt !== undefined && updatedAt !== undefined && updatedAt < createdAt) {
    issues.push({
      field: prefix + "updatedAt",
      message: "Must not precede createdAt.",
    });
  }
  if (!Array.isArray(value.tasks)) {
    issues.push({ field: prefix + "tasks", message: "Must be an array." });
    return;
  }
  const taskIds = new Set();
  const orders = new Set();
  for (let index = 0; index < value.tasks.length; index++) {
    validateTask(value.tasks[index], prefix + "tasks[" + index + "].", taskIds, orders, issues);
  }
}

function validateUserData(value, accountId) {
  const issues = [];
  if (!isObject(value)) {
    return [{ field: "$", message: "User data must be an object." }];
  }
  hasExactFields(value, ["schemaVersion", "profile", "hunts"], "", issues);
  if (value.schemaVersion !== USER_SCHEMA_VERSION) {
    issues.push({
      field: "schemaVersion",
      message: "Unsupported user data schema version.",
    });
  }
  if (!isObject(value.profile)) {
    issues.push({ field: "profile", message: "Profile must be an object." });
  } else {
    hasExactFields(
      value.profile,
      ["id", "displayName", "createdAt", "updatedAt"],
      "profile.",
      issues,
    );
    if (value.profile.id !== accountId) {
      issues.push({
        field: "profile.id",
        message: "Profile ID does not match the requested account.",
      });
    }
    checkText(value.profile.displayName, "profile.displayName", issues);
    const createdAt = checkTimestamp(
      value.profile.createdAt,
      "profile.createdAt",
      issues,
    );
    const updatedAt = checkTimestamp(
      value.profile.updatedAt,
      "profile.updatedAt",
      issues,
    );
    if (createdAt !== undefined && updatedAt !== undefined && updatedAt < createdAt) {
      issues.push({
        field: "profile.updatedAt",
        message: "Must not precede profile.createdAt.",
      });
    }
  }
  if (!Array.isArray(value.hunts)) {
    issues.push({ field: "hunts", message: "Must be an array." });
  } else {
    const huntIds = new Set();
    for (let index = 0; index < value.hunts.length; index++) {
      validateHunt(
        value.hunts[index],
        accountId,
        "hunts[" + index + "].",
        issues,
        huntIds,
      );
    }
  }
  return issues;
}

function requireAccountId(accountId) {
  if (typeof accountId !== "string" || !/\S/.test(accountId)) {
    throw new UserDataValidationError([
      { field: "accountId", message: "Must be a nonblank trusted account ID." },
    ]);
  }
}

function requireText(value, field) {
  const issues = [];
  checkText(value, field, issues);
  if (issues.length) throw new UserDataValidationError(issues);
  return value;
}

function requireDisplayName(displayName) {
  if (typeof displayName !== "string" || !/\S/.test(displayName)) {
    throw new UserDataValidationError([
      { field: "profile.displayName", message: "Must be a nonblank string." },
    ]);
  }
  return displayName.trim();
}

function requireObject(value, field) {
  if (!isObject(value)) {
    throw new UserDataValidationError([
      { field, message: "Must be an object." },
    ]);
  }
}

function verifyIssues(value, accountId) {
  const issues = validateUserData(value, accountId);
  if (issues.length) throw new UserDataValidationError(issues);
}

async function writeAtomically(filePath, data, exclusive) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    ".user-" + process.pid + "-" + randomUUID() + ".tmp",
  );
  let handle;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(JSON.stringify(data, null, 2) + "\n", "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (exclusive) {
      await link(temporaryPath, filePath);
      await unlink(temporaryPath).catch(() => {});
    } else {
      await rename(temporaryPath, filePath);
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
    if (exclusive && error?.code === "EEXIST") {
      throw new UserAlreadyExistsError();
    }
    throw new UserStoreError("User data could not be written.", "storage", {
      cause: error,
    });
  }
}

export function createUserStore({
  dataDir = process.env.BUCHUNT_DATA_DIR || path.resolve("var/data"),
  clock = () => new Date(),
  idGenerator = randomUUID,
} = {}) {
  const usersDirectory = path.join(path.resolve(dataDir), "users");
  const pendingWrites = new Map();

  function fileFor(accountId) {
    requireAccountId(accountId);
    const fileName =
      createHash("sha256").update(accountId, "utf8").digest("hex") + ".json";
    return path.join(usersDirectory, fileName);
  }

  function now() {
    const value = clock();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw new UserStoreError("The store clock returned an invalid time.", "storage");
    }
    return date.toISOString();
  }

  function serialize(accountId, operation) {
    const key = fileFor(accountId);
    const previous = pendingWrites.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    pendingWrites.set(key, current);
    return current.finally(() => {
      if (pendingWrites.get(key) === current) pendingWrites.delete(key);
    });
  }

  async function readUnlocked(accountId) {
    const filePath = fileFor(accountId);
    let contents;
    try {
      contents = await readFile(filePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw new UserStoreError("User data could not be read.", "storage", {
        cause: error,
      });
    }
    let value;
    try {
      value = JSON.parse(contents);
    } catch (error) {
      throw new UserDataCorruptError(accountId, { cause: error });
    }
    const issues = validateUserData(value, accountId);
    if (issues.length) {
      throw new UserDataCorruptError(accountId, {
        cause: new UserDataValidationError(issues),
      });
    }
    return value;
  }

  async function writeUnlocked(accountId, value, exclusive = false) {
    verifyIssues(value, accountId);
    await writeAtomically(fileFor(accountId), value, exclusive);
  }

  async function requireUser(accountId) {
    const value = await readUnlocked(accountId);
    if (!value) throw new UserNotFoundError();
    return value;
  }

  return {
    async getUser(accountId) {
      requireAccountId(accountId);
      return readUnlocked(accountId);
    },

    async createUser(accountId, { displayName }) {
      requireAccountId(accountId);
      const cleanDisplayName = requireDisplayName(displayName);
      return serialize(accountId, async () => {
        if (await readUnlocked(accountId)) throw new UserAlreadyExistsError();
        const createdAt = now();
        const value = {
          schemaVersion: USER_SCHEMA_VERSION,
          profile: {
            id: accountId,
            displayName: cleanDisplayName,
            createdAt,
            updatedAt: createdAt,
          },
          hunts: [],
        };
        await writeUnlocked(accountId, value, true);
        return structuredClone(value);
      });
    },

    async updateProfile(accountId, patch) {
      requireAccountId(accountId);
      requireObject(patch, "profile");
      const unknownFields = Object.keys(patch).filter(
        (field) => field !== "displayName",
      );
      if (unknownFields.length) {
        throw new UserDataValidationError(
          unknownFields.map((field) => ({
            field: "profile." + field,
            message: "Profile field is not editable through this operation.",
          })),
        );
      }
      const displayName = requireDisplayName(patch.displayName);
      return serialize(accountId, async () => {
        const value = await requireUser(accountId);
        value.profile.displayName = displayName;
        value.profile.updatedAt = now();
        await writeUnlocked(accountId, value);
        return structuredClone(value.profile);
      });
    },

    async listHunts(accountId) {
      requireAccountId(accountId);
      const value = await requireUser(accountId);
      return structuredClone(value.hunts);
    },

    async getHunt(accountId, huntId) {
      requireAccountId(accountId);
      requireText(huntId, "huntId");
      const value = await requireUser(accountId);
      const hunt = value.hunts.find((candidate) => candidate.id === huntId);
      return hunt ? structuredClone(hunt) : null;
    },

    async createHunt(accountId, input) {
      requireAccountId(accountId);
      requireObject(input, "hunt");
      const allowed = new Set([
        "name",
        "description",
        "beginsAt",
        "endsAt",
        "taskOrderMode",
      ]);
      const unknown = Object.keys(input).filter((field) => !allowed.has(field));
      if (unknown.length) {
        throw new UserDataValidationError(
          unknown.map((field) => ({
            field: "hunt." + field,
            message: "Field is not accepted when creating a Hunt.",
          })),
        );
      }
      const name =
        typeof input.name === "string" ? input.name.trim() : input.name;
      const description =
        typeof input.description === "string"
          ? input.description.trim()
          : input.description;
      const timestampNow = now();
      const hunt = {
        id: idGenerator(),
        name,
        description,
        ownerId: accountId,
        beginsAt: input.beginsAt ?? timestampNow,
        endsAt: input.endsAt ?? null,
        status: "draft",
        createdAt: timestampNow,
        updatedAt: timestampNow,
        accessCode: null,
        taskOrderMode: input.taskOrderMode ?? "sequential",
        tasks: [],
      };
      const huntIssues = [];
      validateHunt(hunt, accountId, "hunt.", huntIssues, new Set());
      if (huntIssues.length) throw new UserDataValidationError(huntIssues);
      return serialize(accountId, async () => {
        const value = await requireUser(accountId);
        if (value.hunts.some((existing) => existing.id === hunt.id)) {
          throw new UserStoreError("The generated Hunt ID already exists.", "storage");
        }
        value.hunts.push(hunt);
        value.profile.updatedAt = timestampNow;
        await writeUnlocked(accountId, value);
        return structuredClone(hunt);
      });
    },

    async addTask(accountId, huntId, input) {
      requireAccountId(accountId);
      requireText(huntId, "huntId");
      requireObject(input, "task");
      const allowed = new Set([
        "displayLabel",
        "description",
        "requiredAnswer",
        "location",
        "order",
        "answerCaseSensitive",
        "hint",
        "points",
      ]);
      const unknown = Object.keys(input).filter((field) => !allowed.has(field));
      if (unknown.length) {
        throw new UserDataValidationError(
          unknown.map((field) => ({
            field: "task." + field,
            message: "Field is not accepted when creating a Task.",
          })),
        );
      }
      const task = {
        id: idGenerator(),
        displayLabel: input.displayLabel,
        description: input.description,
        requiredAnswer: input.requiredAnswer,
        location: input.location,
        order: input.order,
        answerCaseSensitive: input.answerCaseSensitive ?? false,
        hint: input.hint ?? null,
        points: input.points ?? 0,
      };
      return serialize(accountId, async () => {
        const value = await requireUser(accountId);
        const hunt = value.hunts.find((candidate) => candidate.id === huntId);
        if (!hunt) throw new HuntNotFoundError();
        const candidate = { ...hunt, tasks: [...hunt.tasks, task] };
        const taskIssues = [];
        validateHunt(candidate, accountId, "hunt.", taskIssues, new Set());
        if (taskIssues.length) throw new UserDataValidationError(taskIssues);
        hunt.tasks.push(task);
        const timestampNow = now();
        hunt.updatedAt = timestampNow;
        value.profile.updatedAt = timestampNow;
        await writeUnlocked(accountId, value);
        return structuredClone(task);
      });
    },
  };
}

