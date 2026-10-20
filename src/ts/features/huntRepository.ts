import type { HuntRepository } from "../foundation/contracts.js";
import type {
  OperationResult,
  PlayerHunt,
} from "../foundation/types.js";

export interface CreatorIdentity {
  id: string;
  identityType: "temporary-browser";
}
let creatorSession: Promise<OperationResult<CreatorIdentity>> | undefined;
export function getCreatorSession(): Promise<OperationResult<CreatorIdentity>> {
  creatorSession ??= request<CreatorIdentity>("/api/admin/session");
  return creatorSession.then((result) => {
    if (!result.ok) creatorSession = undefined;
    return result;
  });
}
export async function request<T>(
  path: string,
  input?: unknown,
  method?: string,
): Promise<OperationResult<T>> {
  try {
    const response = await fetch(path, {
      method: method ?? (input === undefined ? "GET" : "POST"),
      headers: { "Content-Type": "application/json" },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    const result = await response.json();
    if (!result || typeof result.ok !== "boolean" || response.ok !== result.ok)
      throw new Error("Invalid service response");
    return result as OperationResult<T>;
  } catch {
    return {
      ok: false,
      code: "network",
      message: "The hunt service could not be reached. Try again.",
    };
  }
}
export function createHuntRepository(): HuntRepository {
  async function creatorRequest<T>(
    path: string,
    input?: unknown,
  ): Promise<OperationResult<T>> {
    const session = await getCreatorSession();
    if (!session.ok) return session;
    return request(path, input);
  }
  return {
    createHunt: (input) => creatorRequest("/api/admin/hunts", input),
    addTask: (id, input) =>
      creatorRequest(`/api/admin/hunts/${encodeURIComponent(id)}/tasks`, input),
    getAdminHunt: (id) =>
      creatorRequest(`/api/admin/hunts/${encodeURIComponent(id)}`),
    getPlayerHunt: (id) =>
      request(`/api/player/hunts/${encodeURIComponent(id)}`),
    async listActiveHunts(): Promise<OperationResult<PlayerHunt[]>> {
      try {
        const response = await fetch("/api/player/hunts", {
          credentials: "same-origin",
        });
        if (response.status === 404 || response.status === 405) {
          return {
            ok: false,
            code: "not-implemented",
            message:
              "The active-hunts API is not part of the Sprint 2 static site yet.",
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
          : typeof payload === "object" &&
              payload !== null &&
              "hunts" in payload
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
          message:
            "The active-hunts API is not available in this static-site prototype.",
        };
      }
    },
  };
}

function parseTaskLocation(
  value: unknown,
): NonNullable<PlayerHunt["tasks"][number]["location"]> {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Invalid Player Task location.");
  }
  const location = value as Record<string, unknown>;
  if (
    typeof location.latitude !== "number" ||
    !Number.isFinite(location.latitude) ||
    location.latitude < -90 ||
    location.latitude > 90 ||
    typeof location.longitude !== "number" ||
    !Number.isFinite(location.longitude) ||
    location.longitude < -180 ||
    location.longitude > 180
  ) {
    throw new TypeError("Invalid Player Task location.");
  }
  return {
    latitude: location.latitude,
    longitude: location.longitude,
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
      huntId:
        typeof item.huntId === "string"
          ? item.huntId
          : (candidate.id as string),
      displayLabel: item.displayLabel,
      completed: item.completed,
      ...(item.location !== undefined
        ? { location: parseTaskLocation(item.location) }
        : {}),
    };
  });
  return {
    id: candidate.id,
    name: candidate.name,
    description: candidate.description,
    tasks,
  };
}
