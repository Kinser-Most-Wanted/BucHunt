import type { HuntRepository } from "../foundation/contracts.js";
import type {
  OperationResult,
  PlayerHunt,
  PlayerIdentity,
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
    getAccountHunt: (id, identity) =>
      accountRequest(
        `/api/player/account/hunts/${encodeURIComponent(id)}`,
        identity,
      ),
    answerAccountTask: (id, taskId, answer, identity) =>
      accountRequest(
        `/api/player/account/hunts/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/answer`,
        identity,
        { answer },
      ),
    async listActiveHunts(identity) {
      const result = await accountRequest<unknown[]>(
        "/api/player/account/hunts",
        identity,
      );
      if (!result.ok) return result;
      try {
        return { ok: true, value: result.value.map(toPlayerHunt) };
      } catch {
        return {
          ok: false,
          code: "network",
          message: "The hunt service returned invalid saved progress.",
        };
      }
    },
  };
}

async function accountRequest<T>(
  path: string,
  identity: PlayerIdentity,
  input?: unknown,
): Promise<OperationResult<T>> {
  try {
    const response = await fetch(path, {
      method: input === undefined ? "GET" : "POST",
      credentials: "omit",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${identity.idToken}`,
        "Content-Type": "application/json",
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    const result = await response.json();
    if (!result || typeof result.ok !== "boolean" || result.ok !== response.ok)
      throw new Error("Invalid service response");
    return result as OperationResult<T>;
  } catch {
    return {
      ok: false,
      code: "network",
      message: "Saved hunt progress could not be retrieved. Try again.",
    };
  }
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
      ...(typeof item.description === "string"
        ? { description: item.description }
        : {}),
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
