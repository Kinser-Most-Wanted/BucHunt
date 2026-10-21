import { JsonFile, StoreError } from "./huntStore.js";
interface ProgressFile {
  schemaVersion: 1;
  players: Record<string, Record<string, string[]>>;
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
  return data;
}
export class PlayerProgressStore {
  private file: JsonFile<ProgressFile>;
  constructor(path: string) {
    this.file = new JsonFile(
      path,
      () => ({ schemaVersion: 1, players: {} }),
      progress,
    );
  }
  async huntsWithProgress(player: string): Promise<string[]> {
    const data = await this.file.get();
    return Object.hasOwn(data.players, player)
      ? Object.keys(data.players[player])
      : [];
  }
  async completed(player: string, hunt: string): Promise<string[]> {
    const data = await this.file.get();
    return Object.hasOwn(data.players, player) &&
      Object.hasOwn(data.players[player], hunt)
      ? data.players[player][hunt]
      : [];
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
