import type {
  HuntDefinition,
  OperationResult,
  ValidationIssue,
} from "../foundation/types.js";

type JsonObject = Record<string, unknown>;
const huntFields = [
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
const taskFields = [
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

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkFields(
  value: JsonObject,
  fields: string[],
  prefix: string,
  issues: ValidationIssue[],
): void {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      issues.push({
        field: prefix + field,
        message: "Required field is missing.",
      });
    }
  }
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) {
      issues.push({
        field: prefix + field,
        message: "Unknown field is not allowed.",
      });
    }
  }
}

function checkText(
  value: unknown,
  field: string,
  issues: ValidationIssue[],
): void {
  if (typeof value !== "string" || !/\S/.test(value)) {
    issues.push({ field, message: "Must be a nonblank string." });
  }
}

// Check calendar components explicitly: Date.parse normalizes invalid days.
function timestamp(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/.exec(
      value,
    );
  if (!match) return undefined;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
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
  )
    return undefined;
  const result = Date.parse(value.replace("t", "T"));
  return Number.isFinite(result) ? result : undefined;
}

function checkTimestamp(
  value: unknown,
  field: string,
  issues: ValidationIssue[],
): number | undefined {
  const result = timestamp(value);
  if (result === undefined)
    issues.push({
      field,
      message: "Must be a valid UTC date-time ending in Z.",
    });
  return result;
}

function checkTask(
  value: unknown,
  prefix: string,
  issues: ValidationIssue[],
): void {
  if (!isObject(value)) {
    issues.push({
      field: prefix.slice(0, -1),
      message: "Task must be an object.",
    });
    return;
  }
  checkFields(value, taskFields, prefix, issues);
  for (const field of ["id", "displayLabel", "description", "requiredAnswer"])
    checkText(value[field], prefix + field, issues);
  if (value.hint !== null) checkText(value.hint, prefix + "hint", issues);
  if (typeof value.answerCaseSensitive !== "boolean")
    issues.push({
      field: prefix + "answerCaseSensitive",
      message: "Must be a boolean.",
    });
  for (const [field, minimum] of [
    ["order", 1],
    ["points", 0],
  ] as const) {
    const number = value[field];
    if (
      typeof number !== "number" ||
      !Number.isInteger(number) ||
      number < minimum
    )
      issues.push({
        field: prefix + field,
        message: `Must be an integer of at least ${minimum}.`,
      });
  }
  if (!isObject(value.location)) {
    issues.push({
      field: prefix + "location",
      message: "Must be a coordinate object.",
    });
    return;
  }
  checkFields(
    value.location,
    ["latitude", "longitude"],
    prefix + "location.",
    issues,
  );
  for (const [field, limit] of [
    ["latitude", 90],
    ["longitude", 180],
  ] as const) {
    const coordinate = value.location[field];
    if (
      typeof coordinate !== "number" ||
      !Number.isFinite(coordinate) ||
      Math.abs(coordinate) > limit
    )
      issues.push({
        field: prefix + "location." + field,
        message: `Must be a finite number between -${limit} and ${limit}.`,
      });
  }
}

/** Validate a complete persisted Hunt, including its owned Tasks, without mutation.
 * Callers must supply IDs, timestamps, and all defaults before validation.
 * Cross-Hunt ID uniqueness and authorization belong to the storage boundary.
 * Keep structural rules aligned with data/hunts.schema.json (schema version 1).
 */
export function validateHunt(input: unknown): OperationResult<HuntDefinition> {
  const issues: ValidationIssue[] = [];
  if (!isObject(input)) {
    return {
      ok: false,
      code: "validation",
      message: "Hunt definition is invalid.",
      issues: [{ field: "$", message: "Hunt must be an object." }],
    };
  }
  checkFields(input, huntFields, "", issues);
  for (const field of ["id", "name", "description", "ownerId"])
    checkText(input[field], field, issues);
  if (
    typeof input.status !== "string" ||
    !["draft", "published", "archived"].includes(input.status)
  )
    issues.push({
      field: "status",
      message: "Must be draft, published, or archived.",
    });
  if (input.taskOrderMode !== "sequential" && input.taskOrderMode !== "any")
    issues.push({
      field: "taskOrderMode",
      message: "Must be sequential or any.",
    });
  if (input.accessCode !== null)
    issues.push({
      field: "accessCode",
      message: "Must be null until access codes are implemented.",
    });
  const beginsAt = checkTimestamp(input.beginsAt, "beginsAt", issues);
  const endsAt =
    input.endsAt === null
      ? undefined
      : checkTimestamp(input.endsAt, "endsAt", issues);
  const createdAt = checkTimestamp(input.createdAt, "createdAt", issues);
  const updatedAt = checkTimestamp(input.updatedAt, "updatedAt", issues);
  if (beginsAt !== undefined && endsAt !== undefined && endsAt <= beginsAt)
    issues.push({ field: "endsAt", message: "Must be later than beginsAt." });
  if (
    createdAt !== undefined &&
    updatedAt !== undefined &&
    updatedAt < createdAt
  )
    issues.push({ field: "updatedAt", message: "Must not precede createdAt." });
  if (!Array.isArray(input.tasks)) {
    issues.push({ field: "tasks", message: "Must be an array." });
  } else {
    const ids = new Set<string>();
    const orders = new Set<number>();
    // Index iteration also rejects holes in arrays supplied directly by callers.
    for (let index = 0; index < input.tasks.length; index++) {
      const task: unknown = input.tasks[index];
      const prefix = `tasks[${index}].`;
      checkTask(task, prefix, issues);
      if (!isObject(task)) continue;
      if (typeof task.id === "string") {
        if (ids.has(task.id))
          issues.push({
            field: prefix + "id",
            message: "Task ID must be unique within this Hunt.",
          });
        ids.add(task.id);
      }
      if (typeof task.order === "number") {
        if (orders.has(task.order))
          issues.push({
            field: prefix + "order",
            message: "Task order must be unique within this Hunt.",
          });
        orders.add(task.order);
      }
    }
  }
  if (issues.length)
    return {
      ok: false,
      code: "validation",
      message: "Hunt definition is invalid.",
      issues,
    };
  return { ok: true, value: input as unknown as HuntDefinition };
}
