import { JsonFile, StoreError } from "./huntStore.js";
import type {
  HuntDefinition,
  KahootView,
  TaskDefinition,
} from "../foundation/types.js";

interface Answer {
  correct: boolean;
  points: number;
  submittedAt: number;
}
interface Game {
  phase: "lobby" | "question" | "results" | "finished";
  index: number;
  startedAt: number | null;
  deadline: number | null;
  questions: TaskDefinition[];
  players: {
    id: string;
    displayName: string;
    lastSeen: number;
    answers: Record<string, Answer>;
  }[];
}
interface Games {
  schemaVersion: 1;
  games: Record<string, Game>;
}
function validate(value: unknown): Games {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid games");
  const data = value as Games;
  if (
    data.schemaVersion !== 1 ||
    !data.games ||
    typeof data.games !== "object" ||
    Array.isArray(data.games)
  )
    throw new Error("Invalid games");
  for (const game of Object.values(data.games)) {
    if (
      !game ||
      !["lobby", "question", "results", "finished"].includes(game.phase) ||
      !Number.isInteger(game.index) ||
      !Array.isArray(game.questions) ||
      !Array.isArray(game.players) ||
      !(game.startedAt === null || Number.isFinite(game.startedAt)) ||
      !(game.deadline === null || Number.isFinite(game.deadline))
    )
      throw new Error("Invalid game");
    for (const task of game.questions)
      if (
        !task ||
        typeof task.id !== "string" ||
        typeof task.requiredAnswer !== "string" ||
        typeof task.displayLabel !== "string" ||
        typeof task.description !== "string" ||
        !Number.isFinite(task.points)
      )
        throw new Error("Invalid game question");
    for (const player of game.players) {
      if (
        !player ||
        typeof player.id !== "string" ||
        typeof player.displayName !== "string" ||
        !Number.isFinite(player.lastSeen) ||
        !player.answers ||
        typeof player.answers !== "object" ||
        Array.isArray(player.answers)
      )
        throw new Error("Invalid game player");
      for (const answer of Object.values(player.answers))
        if (
          !answer ||
          typeof answer.correct !== "boolean" ||
          !Number.isFinite(answer.points) ||
          answer.points < 0 ||
          !Number.isFinite(answer.submittedAt)
        )
          throw new Error("Invalid game answer");
    }
    if (
      game.phase !== "lobby" &&
      !(
        game.phase === "finished" &&
        game.questions.length === 0 &&
        game.index === -1
      ) &&
      (game.index < 0 || game.index >= game.questions.length)
    )
      throw new Error("Invalid question index");
  }
  return data;
}
function initial(): Game {
  return {
    phase: "lobby",
    index: -1,
    startedAt: null,
    deadline: null,
    questions: [],
    players: [],
  };
}
function ensure(data: Games, id: string): Game {
  if (
    !/^[a-zA-Z0-9-]{1,100}$/.test(id) ||
    ["__proto__", "constructor", "prototype"].includes(id)
  )
    throw new StoreError("validation", "Invalid hunt identifier.");
  return (data.games[id] ??= initial());
}
function beginQuestion(game: Game, now: number): void {
  game.phase = "question";
  game.startedAt = now;
  const seconds = game.questions[game.index].timeLimitSeconds;
  game.deadline = seconds ? now + seconds * 1000 : null;
}
function finishQuestion(game: Game): void {
  game.phase =
    game.index === game.questions.length - 1 ? "finished" : "results";
}
function synchronize(game: Game, active: string[], now: number): void {
  if (game.phase !== "question") return;
  const eligible = game.players.filter((player) => active.includes(player.id));
  const task = game.questions[game.index];
  if (
    (game.deadline !== null && now >= game.deadline) ||
    (eligible.length > 0 &&
      eligible.every((player) => Object.hasOwn(player.answers, task.id)))
  )
    finishQuestion(game);
}
function view(
  game: Game,
  playerId: string | undefined,
  active: string[],
  now: number,
): KahootView {
  const task = game.questions[game.index];
  const player = game.players.find((player) => player.id === playerId);
  const answer = task && player?.answers[task.id];
  return {
    phase: game.phase,
    questionNumber: game.index + 1,
    totalQuestions: game.questions.length,
    serverNow: now,
    startedAt: game.startedAt,
    deadline: game.deadline,
    submitted: !!answer,
    ...(answer && game.phase !== "question"
      ? { correct: answer.correct, pointsAwarded: answer.points }
      : {}),
    ...(task && game.phase === "question"
      ? {
          question: {
            id: task.id,
            displayLabel: task.displayLabel,
            description: task.description,
            taskType: task.taskType ?? "single-word-trivia",
            ...(task.choices ? { choices: [...task.choices].sort() } : {}),
          },
        }
      : {}),
    leaderboard: game.players
      .map((player) => ({
        participantId: player.id,
        displayName: player.displayName,
        score: Object.values(player.answers).reduce(
          (sum, answer) => sum + answer.points,
          0,
        ),
        submitted: !!(task && player.answers[task.id]),
        active: active.includes(player.id),
        connected: active.includes(player.id) && now - player.lastSeen < 15000,
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.displayName.localeCompare(b.displayName) ||
          a.participantId.localeCompare(b.participantId),
      ),
  };
}
export class KahootStore {
  private file: JsonFile<Games>;
  constructor(path: string) {
    this.file = new JsonFile(
      path,
      () => ({ schemaVersion: 1, games: {} }),
      validate,
    );
  }
  async hasStarted(huntId: string): Promise<boolean> {
    const game = (await this.file.get()).games[huntId];
    return !!game && game.phase !== "lobby";
  }
  async state(
    huntId: string,
    active: string[],
    identity?: { id: string; displayName: string },
    now = Date.now(),
    unavailable = false,
  ): Promise<KahootView> {
    return this.file.update((data) => {
      const game = ensure(data, huntId);
      if (unavailable) game.phase = "finished";
      if (identity) {
        let player = game.players.find((player) => player.id === identity.id);
        if (!player && game.phase === "lobby") {
          player = { ...identity, lastSeen: now, answers: {} };
          game.players.push(player);
        }
        if (player) {
          player.lastSeen = now;
          player.displayName = identity.displayName;
        }
      }
      synchronize(game, active, now);
      return view(game, identity?.id, active, now);
    });
  }
  async control(
    hunt: HuntDefinition,
    action: unknown,
    participants: { id: string; displayName: string }[],
    now = Date.now(),
  ): Promise<KahootView> {
    return this.file.update((data) => {
      const game = ensure(data, hunt.id);
      const active = participants.map((player) => player.id);
      synchronize(game, active, now);
      if (action === "start") {
        if (game.phase !== "lobby")
          throw new StoreError("validation", "This hunt has already started.");
        if (!hunt.tasks.length)
          throw new StoreError(
            "validation",
            "Add at least one question before starting.",
          );
        if (!participants.length)
          throw new StoreError(
            "validation",
            "Wait for at least one player to join.",
          );
        game.questions = structuredClone(
          [...hunt.tasks].sort((a, b) => a.order - b.order),
        );
        game.players = participants.map((person) => ({
          ...person,
          lastSeen: game.players.find((p) => p.id === person.id)?.lastSeen ?? 0,
          answers: {},
        }));
        game.index = 0;
        beginQuestion(game, now);
      } else if (action === "next") {
        if (game.phase !== "results")
          throw new StoreError(
            "validation",
            "Wait for answers or end the current question first.",
          );
        game.index++;
        beginQuestion(game, now);
      } else if (action === "end-question") {
        if (game.phase !== "question")
          throw new StoreError(
            "validation",
            "There is no open question to end.",
          );
        finishQuestion(game);
      } else if (action === "end") {
        if (game.phase === "lobby")
          throw new StoreError("validation", "Start the hunt first.");
        game.phase = "finished";
      } else
        throw new StoreError(
          "validation",
          "Choose start, next, end-question, or end.",
        );
      return view(game, undefined, active, now);
    });
  }
  async answer(
    huntId: string,
    playerId: string,
    taskId: string,
    answer: unknown,
    active: string[],
    now = Date.now(),
  ): Promise<{ completed: boolean }> {
    return this.file.update((data) => {
      const game = ensure(data, huntId);
      synchronize(game, active, now);
      if (game.phase !== "question")
        throw new StoreError(
          "validation",
          "This question is not accepting answers.",
        );
      const task = game.questions[game.index];
      if (task.id !== taskId)
        throw new StoreError(
          "forbidden",
          "Only the current question can be answered.",
        );
      const player = game.players.find((player) => player.id === playerId);
      if (!player || !active.includes(playerId))
        throw new StoreError(
          "forbidden",
          "You are not participating in this game.",
        );
      if (Object.hasOwn(player.answers, task.id))
        throw new StoreError(
          "validation",
          "Your answer has already been submitted.",
        );
      if (typeof answer !== "string" || !answer.trim() || answer.length > 4000)
        throw new StoreError(
          "validation",
          "Enter an answer of 1–4000 characters.",
        );
      if (
        task.taskType === "multiple-choice" &&
        !task.choices?.includes(answer)
      )
        throw new StoreError("validation", "Select an available answer.");
      const normalize = (text: string) =>
        task.answerCaseSensitive ? text.trim() : text.trim().toLowerCase();
      const correct = normalize(answer) === normalize(task.requiredAnswer);
      const elapsed = Math.max(0, now - game.startedAt!);
      const windowMs = (task.timeLimitSeconds ?? 60) * 1000;
      const points = correct
        ? Math.round(
            (task.points || 1000) * (1 - 0.5 * Math.min(1, elapsed / windowMs)),
          )
        : 0;
      player.answers[task.id] = { correct, points, submittedAt: now };
      player.lastSeen = now;
      synchronize(game, active, now);
      return { completed: correct };
    });
  }
  async completed(huntId: string, playerId: string): Promise<string[]> {
    const player = (await this.file.get()).games[huntId]?.players.find(
      (player) => player.id === playerId,
    );
    return Object.entries(player?.answers ?? {})
      .filter(([, answer]) => answer.correct)
      .map(([id]) => id);
  }
  async reportableTasks(hunt: HuntDefinition): Promise<TaskDefinition[]> {
    const game = (await this.file.get()).games[hunt.id];
    return game && game.phase !== "lobby"
      ? game.questions.slice(0, game.index + 1)
      : [];
  }
  async removeHunt(id: string): Promise<void> {
    await this.file.update((data) => {
      delete data.games[id];
    });
  }
}
