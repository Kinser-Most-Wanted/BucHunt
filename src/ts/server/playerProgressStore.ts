import { JsonFile, StoreError } from "./huntStore.js";
interface ProgressFile {
  schemaVersion: 1;
  // Completed task IDs remain after leaving so progress can be restored and
  // counted against the hunt's task list for a future progress indicator.
  players: Record<string, Record<string, string[]>>;
  // Active membership is separate from durable completion history.
  activeHunts?: Record<string, string[]>;
  // Completed IDs for accounts that explicitly left; active player records
  // remain the source used by participant exports.
  savedProgress?: Record<string, Record<string, string[]>>;
  incorrectChoices?: Record<string, Record<string, Record<string, string[]>>>;
  bannedPlayers?: Record<string, string[]>;
}
function progress(value: unknown): ProgressFile {
  if (!value || typeof value !== "object") throw new Error("Invalid progress");
  const data = value as ProgressFile;
  if (
    data.schemaVersion !== 1 ||
    !data.players ||
    typeof data.players !== "object" ||
    Array.isArray(data.players)
  )
    throw new Error("Invalid progress");
  for (const hunts of Object.values(data.players)) {
    if (!hunts || typeof hunts !== "object" || Array.isArray(hunts))
      throw new Error("Invalid progress");
    for (const ids of Object.values(hunts))
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string"))
        throw new Error("Invalid progress");
  }
  if (data.activeHunts !== undefined) {
    if (
      !data.activeHunts ||
      typeof data.activeHunts !== "object" ||
      Array.isArray(data.activeHunts)
    )
      throw new Error("Invalid memberships");
    for (const hunts of Object.values(data.activeHunts))
      if (!Array.isArray(hunts) || hunts.some((id) => typeof id !== "string"))
        throw new Error("Invalid memberships");
  }
  if (data.savedProgress !== undefined) {
    if (
      !data.savedProgress ||
      typeof data.savedProgress !== "object" ||
      Array.isArray(data.savedProgress)
    )
      throw new Error("Invalid saved progress");
    for (const hunts of Object.values(data.savedProgress)) {
      if (!hunts || typeof hunts !== "object" || Array.isArray(hunts))
        throw new Error("Invalid saved progress");
      for (const ids of Object.values(hunts))
        if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string"))
          throw new Error("Invalid saved progress");
    }
  }
  if (data.incorrectChoices !== undefined) {
    const object = (value: unknown): value is Record<string, unknown> =>
      !!value && typeof value === "object" && !Array.isArray(value);
    if (!object(data.incorrectChoices)) throw new Error("Invalid attempts");
    for (const hunts of Object.values(data.incorrectChoices)) {
      if (!object(hunts)) throw new Error("Invalid attempts");
      for (const tasks of Object.values(hunts)) {
        if (!object(tasks)) throw new Error("Invalid attempts");
        for (const choices of Object.values(tasks))
          if (
            !Array.isArray(choices) ||
            choices.some((choice) => typeof choice !== "string")
          )
            throw new Error("Invalid attempts");
      }
    }
  }
  if (data.bannedPlayers !== undefined) {
    if (
      !data.bannedPlayers ||
      typeof data.bannedPlayers !== "object" ||
      Array.isArray(data.bannedPlayers)
    )
      throw new Error("Invalid bans");
    for (const players of Object.values(data.bannedPlayers))
      if (
        !Array.isArray(players) ||
        players.some((id) => typeof id !== "string")
      )
        throw new Error("Invalid bans");
  }
  return data;
}
function memberships(data: ProgressFile): Record<string, string[]> {
  // Older schema-1 files used the presence of a progress record as membership.
  // On the first update, migrate that meaning without discarding completions.
  return (data.activeHunts ??= Object.fromEntries(
    Object.entries(data.players).map(([player, hunts]) => [
      player,
      Object.keys(hunts),
    ]),
  ));
}
export class PlayerProgressStore {
  private file: JsonFile<ProgressFile>;
  constructor(path: string) {
    this.file = new JsonFile<ProgressFile>(
      path,
      () => ({ schemaVersion: 1, players: {}, activeHunts: {} }),
      progress,
    );
  }
  async huntsWithProgress(player: string): Promise<string[]> {
    const data = await this.file.get();
    return data.activeHunts
      ? [...(data.activeHunts[player] ?? [])]
      : Object.hasOwn(data.players, player)
        ? Object.keys(data.players[player])
        : [];
  }
  async participants(
    hunt: string,
  ): Promise<{ playerId: string; completedTaskIds: string[] }[]> {
    const data = await this.file.get();
    return Object.entries(data.players)
      .filter(([, hunts]) => Object.hasOwn(hunts, hunt))
      .map(([playerId, hunts]) => ({
        playerId,
        completedTaskIds: [...hunts[hunt]],
      }));
  }
  async departedParticipants(
    hunt: string,
  ): Promise<{ playerId: string; completedTaskIds: string[] }[]> {
    const data = await this.file.get();
    return Object.entries(data.savedProgress ?? {})
      .filter(([, hunts]) => Object.hasOwn(hunts, hunt))
      .map(([playerId, hunts]) => ({
        playerId,
        completedTaskIds: [...hunts[hunt]],
      }));
  }
  async completed(player: string, hunt: string): Promise<string[]> {
    const data = await this.file.get();
    if (
      Object.hasOwn(data.players, player) &&
      Object.hasOwn(data.players[player], hunt)
    )
      return [...data.players[player][hunt]];
    return [...(data.savedProgress?.[player]?.[hunt] ?? [])];
  }
  async incorrect(
    player: string,
    hunt: string,
  ): Promise<Record<string, string[]>> {
    const data = await this.file.get();
    return data.incorrectChoices?.[player]?.[hunt] ?? {};
  }
  async rejectChoice(
    player: string,
    hunt: string,
    task: string,
    choice: string,
  ): Promise<void> {
    if (
      ![player, hunt, task].every((id) => /^[a-zA-Z0-9-]{1,100}$/.test(id)) ||
      [player, hunt, task].some((id) =>
        ["__proto__", "constructor", "prototype"].includes(id),
      )
    )
      throw new StoreError("validation", "Invalid progress identifier.");
    await this.file.update((data) => {
      const players = (data.incorrectChoices ??= {});
      const hunts = (players[player] ??= {});
      const tasks = (hunts[hunt] ??= {});
      const choices = (tasks[task] ??= []);
      if (!choices.includes(choice)) choices.push(choice);
    });
  }
  async join(player: string, hunt: string): Promise<void> {
    if (![player, hunt].every((id) => /^[a-zA-Z0-9-]{1,100}$/.test(id)))
      throw new StoreError("validation", "Invalid participation identifier.");
    await this.file.update((data) => {
      if (data.bannedPlayers?.[hunt]?.includes(player))
        throw new StoreError("forbidden", "You are banned from this hunt.");
      const activeHunts = memberships(data);
      const active = (activeHunts[player] ??= []);
      if (!active.includes(hunt)) active.push(hunt);
      if (!Object.hasOwn(data.players, player)) data.players[player] = {};
      if (!Object.hasOwn(data.players[player], hunt))
        data.players[player][hunt] = [
          ...(data.savedProgress?.[player]?.[hunt] ?? []),
        ];
      if (data.savedProgress?.[player]) {
        delete data.savedProgress[player][hunt];
        if (Object.keys(data.savedProgress[player]).length === 0)
          delete data.savedProgress[player];
      }
    });
  }
  async leave(player: string, hunt: string): Promise<void> {
    await this.file.update((data) => {
      const activeHunts = memberships(data);
      if (Object.hasOwn(activeHunts, player)) {
        activeHunts[player] = activeHunts[player].filter((id) => id !== hunt);
      }
      if (Object.hasOwn(data.players, player)) {
        if (Object.hasOwn(data.players[player], hunt)) {
          const saved = (data.savedProgress ??= {});
          const savedHunts = (saved[player] ??= {});
          savedHunts[hunt] = [...data.players[player][hunt]];
          delete data.players[player][hunt];
        }
        if (Object.keys(data.players[player]).length === 0)
          delete data.players[player];
      }
      if (data.incorrectChoices?.[player]) {
        delete data.incorrectChoices[player][hunt];
        if (Object.keys(data.incorrectChoices[player]).length === 0)
          delete data.incorrectChoices[player];
      }
    });
  }
  async ban(player: string, hunt: string): Promise<void> {
    if (![player, hunt].every((id) => /^[a-zA-Z0-9-]{1,100}$/.test(id)))
      throw new StoreError("validation", "Invalid participation identifier.");
    await this.file.update((data) => {
      const banned = (data.bannedPlayers ??= {});
      const players = (banned[hunt] ??= []);
      if (!players.includes(player)) players.push(player);
      const activeHunts = memberships(data);
      if (Object.hasOwn(activeHunts, player))
        activeHunts[player] = activeHunts[player].filter((id) => id !== hunt);
      if (Object.hasOwn(data.players, player)) {
        if (Object.hasOwn(data.players[player], hunt)) {
          const saved = (data.savedProgress ??= {});
          const savedHunts = (saved[player] ??= {});
          savedHunts[hunt] = [...data.players[player][hunt]];
          delete data.players[player][hunt];
        }
        if (Object.keys(data.players[player]).length === 0)
          delete data.players[player];
      }
      if (data.incorrectChoices?.[player]) {
        delete data.incorrectChoices[player][hunt];
        if (Object.keys(data.incorrectChoices[player]).length === 0)
          delete data.incorrectChoices[player];
      }
    });
  }
  async isBanned(player: string, hunt: string): Promise<boolean> {
    const data = await this.file.get();
    return data.bannedPlayers?.[hunt]?.includes(player) ?? false;
  }
  async removeHunt(hunt: string): Promise<void> {
    await this.file.update((data) => {
      for (const [player, hunts] of Object.entries(data.players)) {
        delete hunts[hunt];
        if (Object.keys(hunts).length === 0) delete data.players[player];
      }
      for (const [player, hunts] of Object.entries(
        data.incorrectChoices ?? {},
      )) {
        delete hunts[hunt];
        if (Object.keys(hunts).length === 0)
          delete data.incorrectChoices![player];
      }
      for (const [player, hunts] of Object.entries(data.savedProgress ?? {})) {
        delete hunts[hunt];
        if (Object.keys(hunts).length === 0) delete data.savedProgress![player];
      }
      for (const [player, hunts] of Object.entries(memberships(data))) {
        const remaining = hunts.filter((id) => id !== hunt);
        if (remaining.length === 0) delete data.activeHunts![player];
        else data.activeHunts![player] = remaining;
      }
      delete data.bannedPlayers?.[hunt];
    });
  }
  async complete(player: string, hunt: string, task: string): Promise<void> {
    if (![player, hunt, task].every((id) => /^[a-zA-Z0-9-]{1,100}$/.test(id)))
      throw new StoreError("validation", "Invalid progress identifier.");
    await this.file.update((data) => {
      if (!Object.hasOwn(data.players, player)) data.players[player] = {};
      const hunts = data.players[player];
      if (!Object.hasOwn(hunts, hunt)) hunts[hunt] = [];
      if (!hunts[hunt].includes(task)) hunts[hunt].push(task);
    });
  }
}
