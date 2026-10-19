import type { HuntRepository } from "../foundation/contracts.js";
import type {
  OperationResult,
  PlayerHunt,
  PlayerIdentity,
} from "../foundation/types.js";

const pending = <T>(): Promise<OperationResult<T>> =>
  Promise.resolve({
    ok: false,
    code: "not-implemented",
    message: "Server-side JSON file persistence is not implemented (#34).",
  });

// Replace this adapter with calls to the server that owns the JSON files.
export function createHuntRepository(): HuntRepository {
  return {
    createHunt: () => pending(),
    addTask: () => pending(),
    getAdminHunt: () => pending(),
    getPlayerHunt: () => pending(),
    async listActiveHunts(
      identity: PlayerIdentity,
    ): Promise<OperationResult<PlayerHunt[]>> {
      try {
        const response = await fetch(
          "/api/player/hunts",
          {
            headers: { Authorization: `Bearer ${identity.idToken}` },
          },
        );
        if (response.status === 404 || response.status === 405) {
          return {
            ok: false,
            code: "not-implemented",
            message: "The active-hunts API is not part of the Sprint 2 static site yet.",
          };
        }
        if (!response.ok) {
          return {
            ok: false,
            code: "network",
            message: "Active Hunts could not be loaded. Try again later.",
          };
        }
        const payload: unknown = await response.json();
        const hunts = Array.isArray(payload)
          ? payload
          : typeof payload === "object" && payload !== null && "hunts" in payload
            ? (payload as { hunts: unknown }).hunts
            : null;
        if (!Array.isArray(hunts)) {
          return {
            ok: false,
            code: "network",
            message: "The active-hunts service returned an invalid response.",
          };
        }
        return { ok: true, value: hunts.map(toPlayerHunt) };
      } catch {
        return {
          ok: false,
          code: "not-implemented",
          message: "The active-hunts API is not available in this static-site prototype.",
        };
      }
    },
  };
}

function toPlayerHunt(value: unknown): PlayerHunt {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Invalid Player Hunt response.");
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.description !== "string" ||
    !Array.isArray(candidate.tasks)
  ) {
    throw new TypeError("Invalid Player Hunt response.");
  }
  const tasks = candidate.tasks.map((task): PlayerHunt["tasks"][number] => {
    if (typeof task !== "object" || task === null) {
      throw new TypeError("Invalid Player Task response.");
    }
    const item = task as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      typeof item.displayLabel !== "string" ||
      typeof item.completed !== "boolean"
    ) {
      throw new TypeError("Invalid Player Task response.");
    }
    return {
      id: item.id,
      huntId: typeof item.huntId === "string" ? item.huntId : candidate.id as string,
      displayLabel: item.displayLabel,
      completed: item.completed,
    };
  });
  return {
    id: candidate.id,
    name: candidate.name,
    description: candidate.description,
    tasks,
  };
}

