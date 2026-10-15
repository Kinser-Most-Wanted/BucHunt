import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { HuntDefinition } from "../src/ts/foundation/types.js";
import { validateHunt } from "../src/ts/validation/huntValidation.js";

function fixture(): HuntDefinition {
  return JSON.parse(readFileSync("data/hunts.example.json", "utf8")).hunts[0];
}

function expectInvalid(input: unknown, field: string): void {
  const result = validateHunt(input);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected validation failure.");
  expect(result.code).toBe("validation");
  expect(result.issues?.some((issue) => issue.field === field)).toBe(true);
}

test("accepts the stored example without changing input", () => {
  const hunt = fixture();
  const before = JSON.stringify(hunt);
  const result = validateHunt(hunt);
  expect(result).toEqual({ ok: true, value: hunt });
  expect(JSON.stringify(hunt)).toBe(before);
});

test("accepts empty tasks, nullable fields, bounds, and independent Hunt ownership", () => {
  const hunt = fixture();
  hunt.endsAt = null;
  hunt.updatedAt = hunt.createdAt;
  hunt.taskOrderMode = "any";
  hunt.tasks[0].location = { latitude: -90, longitude: 180 };
  hunt.tasks[0].points = 0;
  hunt.tasks[0].hint = null;
  expect(validateHunt(hunt).ok).toBe(true);
  const other = fixture();
  other.id = "another-hunt";
  expect(validateHunt(other).ok).toBe(true);
  hunt.tasks = [];
  expect(validateHunt(hunt).ok).toBe(true);
});

for (const input of [null, undefined, [], "{}", 1, false]) {
  test(`rejects a non-object Hunt: ${String(input)}`, () =>
    expectInvalid(input, "$"));
}

test("requires every persisted Hunt and Task field; does not fill defaults", () => {
  for (const field of Object.keys(fixture())) {
    const hunt = fixture();
    Reflect.deleteProperty(hunt, field);
    expectInvalid(hunt, field);
  }
  for (const field of Object.keys(fixture().tasks[0])) {
    const hunt = fixture();
    Reflect.deleteProperty(hunt.tasks[0], field);
    expectInvalid(hunt, `tasks[0].${field}`);
  }
});

test("rejects unknown properties at every level", () => {
  const hunt = fixture();
  Object.assign(hunt, { typo: true });
  Object.assign(hunt.tasks[0], { huntId: hunt.id });
  Object.assign(hunt.tasks[0].location, { accuracy: 1 });
  expectInvalid(hunt, "typo");
  expectInvalid(hunt, "tasks[0].huntId");
  expectInvalid(hunt, "tasks[0].location.accuracy");
});

test("rejects blank text and incorrect scalar types", () => {
  for (const field of ["id", "name", "description", "ownerId"]) {
    expectInvalid({ ...fixture(), [field]: " \t\n" }, field);
  }
  for (const [field, value] of Object.entries({
    id: " ",
    displayLabel: "",
    description: 3,
    requiredAnswer: null,
    hint: " ",
    answerCaseSensitive: "false",
    points: -1,
    order: 0,
  })) {
    const hunt = fixture();
    Object.assign(hunt.tasks[0], { [field]: value });
    expectInvalid(hunt, `tasks[0].${field}`);
  }
  for (const [field, value] of Object.entries({
    status: "active",
    taskOrderMode: "random",
    accessCode: "ABC",
    tasks: {},
  })) {
    expectInvalid({ ...fixture(), [field]: value }, field);
  }
});

test("rejects malformed Tasks and locations", () => {
  for (const value of [null, [], "task"]) {
    expectInvalid({ ...fixture(), tasks: [value] }, "tasks[0]");
    const hunt = fixture();
    Object.assign(hunt.tasks[0], { location: value });
    expectInvalid(hunt, "tasks[0].location");
  }
  const hunt = fixture();
  hunt.tasks = new Array(1);
  expectInvalid(hunt, "tasks[0]");
});

test("rejects invalid coordinates and fractional or nonfinite numeric values", () => {
  for (const [field, values] of [
    ["latitude", [90.1, -90.1, NaN, Infinity, "36"]],
    ["longitude", [180.1, -180.1, NaN, -Infinity, null]],
  ] as const) {
    for (const value of values) {
      const hunt = fixture();
      Object.assign(hunt.tasks[0].location, { [field]: value });
      expectInvalid(hunt, `tasks[0].location.${field}`);
    }
  }
  for (const field of ["order", "points"]) {
    for (const value of [1.5, Infinity, NaN, "1"]) {
      const hunt = fixture();
      Object.assign(hunt.tasks[0], { [field]: value });
      expectInvalid(hunt, `tasks[0].${field}`);
    }
  }
});

test("checks UTC syntax and actual calendar dates", () => {
  for (const value of [
    "2026-02-29T12:00:00Z",
    "2026-04-31T12:00:00Z",
    "2026-10-08",
    "2026-10-08T24:00:00Z",
    "2026-10-08T12:00:00+00:00",
    "invalid",
    null,
  ]) {
    expectInvalid({ ...fixture(), beginsAt: value }, "beginsAt");
  }
  const hunt = fixture();
  hunt.beginsAt = "2028-02-29T12:00:00.123Z";
  hunt.endsAt = null;
  expect(validateHunt(hunt).ok).toBe(true);
});

test("checks timestamp relationships", () => {
  const hunt = fixture();
  hunt.endsAt = hunt.beginsAt;
  expectInvalid(hunt, "endsAt");
  hunt.endsAt = "2026-10-01T00:00:00Z";
  expectInvalid(hunt, "endsAt");
  hunt.updatedAt = "2026-10-01T00:00:00Z";
  expectInvalid(hunt, "updatedAt");
});

test("rejects repeated task IDs and orders in either ordering mode", () => {
  for (const mode of ["sequential", "any"] as const) {
    const hunt = fixture();
    hunt.taskOrderMode = mode;
    hunt.tasks[1].id = hunt.tasks[0].id;
    hunt.tasks[1].order = hunt.tasks[0].order;
    expectInvalid(hunt, "tasks[1].id");
    expectInvalid(hunt, "tasks[1].order");
  }
});

test("collects errors across Hunt and embedded Tasks without revealing answers", () => {
  const hunt = fixture();
  hunt.name = "";
  hunt.tasks[0].points = -1;
  hunt.tasks[1].description = "";
  const result = validateHunt(hunt);
  expectInvalid(hunt, "name");
  expectInvalid(hunt, "tasks[0].points");
  expectInvalid(hunt, "tasks[1].description");
  expect(JSON.stringify(result)).not.toContain(hunt.tasks[0].requiredAnswer);
});
