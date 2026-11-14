import { test, expect } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KahootStore } from "../src/ts/server/kahootStore.js";
import { HuntStore } from "../src/ts/server/huntStore.js";

const input = {
  name: "Live",
  description: "A live quiz",
  beginsAt: "2020-01-01T00:00:00Z",
  endsAt: null,
  taskOrderMode: "sequential",
  huntType: "kahoot",
};
const question = {
  displayLabel: "First",
  description: "Name the mascot",
  requiredAnswer: "Bucky",
  location: { latitude: 0, longitude: 0 },
  order: 1,
  answerCaseSensitive: false,
  hint: null,
  points: 1000,
  timeLimitSeconds: 10,
};
const participants = [
  { id: "one", displayName: "One" },
  { id: "two", displayName: "Two" },
];

test("Kahoot state is synchronized, answers are immutable, scoring uses server time, and restart retains progress", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kahoot-"));
  try {
    const hunts = new HuntStore(join(directory, "hunts.json"));
    const hunt = await hunts.create(input, "owner");
    const first = await hunts.addTask(hunt.id, question);
    const second = await hunts.addTask(hunt.id, {
      ...question,
      order: 2,
      displayLabel: "Second",
      timeLimitSeconds: null,
    });
    const definition = await hunts.get(hunt.id);
    const path = join(directory, "games.json");
    const game = new KahootStore(path);
    const active = participants.map((p) => p.id);
    expect(
      (await game.state(hunt.id, active, participants[0], 1000)).phase,
    ).toBe("lobby");
    await expect(
      game.answer(hunt.id, "one", first.id, "Bucky", active, 1000),
    ).rejects.toThrow("not accepting");
    await game.control(definition, "start", participants, 2000);
    await expect(
      game.control(definition, "start", participants, 2100),
    ).rejects.toThrow("already started");
    const a = await game.state(hunt.id, active, participants[0], 2200);
    const b = await game.state(hunt.id, active, participants[1], 2200);
    expect(a.question?.id).toBe(first.id);
    expect(b.question).toEqual(a.question);
    expect(JSON.stringify(a)).not.toContain("requiredAnswer");
    expect(JSON.stringify(a)).not.toContain(second.id);
    await expect(
      game.answer(hunt.id, "one", second.id, "Bucky", active, 2300),
    ).rejects.toThrow("current question");
    await expect(
      game.control(definition, "next", participants, 2300),
    ).rejects.toThrow("Wait for answers");
    await game.answer(hunt.id, "one", first.id, "bucky", active, 3000);
    await expect(
      game.answer(hunt.id, "one", first.id, "wrong", active, 3100),
    ).rejects.toThrow("already been submitted");
    const restarted = new KahootStore(path);
    expect(
      (await restarted.state(hunt.id, active, participants[0], 4000)).submitted,
    ).toBe(true);
    await restarted.answer(hunt.id, "two", first.id, "Bucky", active, 7000);
    const results = await restarted.state(
      hunt.id,
      active,
      participants[0],
      7001,
    );
    expect(results.phase).toBe("results");
    expect(results.leaderboard.map((p) => p.score)).toEqual([950, 750]);
    expect(await restarted.completed(hunt.id, "one")).toEqual([first.id]);
    await restarted.control(definition, "next", participants, 8000);
    await restarted.answer(hunt.id, "one", second.id, "wrong", active, 8500);
    await restarted.answer(hunt.id, "two", second.id, "wrong", active, 8600);
    expect(
      (await restarted.state(hunt.id, active, participants[0], 9000)).phase,
    ).toBe("finished");
    expect(await restarted.completed(hunt.id, "one")).toEqual([first.id]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("deadline rejects late answers and host can finish an untimed question", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kahoot-time-"));
  try {
    const hunts = new HuntStore(join(directory, "hunts.json"));
    const hunt = await hunts.create(input, "owner");
    const task = await hunts.addTask(hunt.id, question);
    const definition = await hunts.get(hunt.id);
    const game = new KahootStore(join(directory, "game.json"));
    await game.control(definition, "start", participants, 1000);
    await expect(
      game.answer(hunt.id, "one", task.id, "Bucky", ["one", "two"], 11000),
    ).rejects.toThrow("not accepting");
    expect(
      (await game.state(hunt.id, ["one", "two"], undefined, 11000)).phase,
    ).toBe("finished");
    const other = await hunts.create(input, "owner");
    await hunts.addTask(other.id, { ...question, timeLimitSeconds: null });
    const updated = await hunts.get(other.id);
    await game.control(updated, "start", participants, 20000);
    expect((await game.state(other.id, ["one"], undefined, 100000)).phase).toBe(
      "question",
    );
    await game.control(updated, "end-question", participants, 100001);
    expect((await game.state(other.id, ["one"], undefined, 100002)).phase).toBe(
      "finished",
    );
    await writeFile(join(directory, "game.json"), "broken");
    await expect(
      new KahootStore(join(directory, "game.json")).state(other.id, []),
    ).rejects.toThrow("not been overwritten");
    expect(await readFile(join(directory, "game.json"), "utf8")).toBe("broken");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
