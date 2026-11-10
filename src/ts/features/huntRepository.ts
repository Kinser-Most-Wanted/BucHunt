import type { HuntRepository } from "../foundation/contracts.js";
import type {
  HuntParticipationResult,
  HuntParticipantProgress,
  HuntStatus,
  OperationResult,
  PlayerHunt,
  PlayerIdentity,
} from "../foundation/types.js";

export interface CreatorIdentity {
  id: string;
  identityType: "temporary-browser" | "google-account";
}
let creatorSession: Promise<OperationResult<CreatorIdentity>> | undefined;
let creatorSessionToken: string | null | undefined;
const PLAYER_SESSION_KEY = "buchunt.player-session";
function storedGoogleToken(): string | null {
  try {
    const session = JSON.parse(
      localStorage.getItem(PLAYER_SESSION_KEY) ??
        sessionStorage.getItem(PLAYER_SESSION_KEY) ??
        "null",
    ) as { provider?: unknown; idToken?: unknown; expiresAt?: unknown } | null;
    return session?.provider === "google" &&
      (typeof session.expiresAt !== "number" ||
        session.expiresAt * 1000 > Date.now()) &&
      typeof session.idToken === "string" &&
      session.idToken !== "verified-server-session"
      ? session.idToken
      : null;
  } catch {
    return null;
  }
}
export function getCreatorSession(): Promise<OperationResult<CreatorIdentity>> {
  const token = storedGoogleToken();
  if (token !== creatorSessionToken) {
    creatorSession = undefined;
    creatorSessionToken = token;
  }
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
    const token = path.startsWith("/api/admin/") ? storedGoogleToken() : null;
    const response = await fetch(path, {
      method: method ?? (input === undefined ? "GET" : "POST"),
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
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
    method?: string,
  ): Promise<OperationResult<T>> {
    const session = await getCreatorSession();
    if (!session.ok) return session;
    return request(path, input, method);
  }
  return {
    getAccountProfile: (identity) =>
      accountRequest("/api/player/account/profile", identity),
    saveAccountProfile: (displayName, identity) =>
      accountRequest(
        "/api/player/account/profile",
        identity,
        { displayName },
        "PUT",
      ),
    createHunt: (input) => creatorRequest("/api/admin/hunts", input),
    addTask: (id, input) =>
      creatorRequest(`/api/admin/hunts/${encodeURIComponent(id)}/tasks`, input),
    updateTask: (id, taskId, input) =>
      creatorRequest(
        `/api/admin/hunts/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}`,
        input,
        "PATCH",
      ),
    deleteTask: (id, taskId) =>
      creatorRequest(
        `/api/admin/hunts/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}`,
        undefined,
        "DELETE",
      ),
    deleteHunt: (id, confirmationName) =>
      creatorRequest(
        `/api/admin/hunts/${encodeURIComponent(id)}`,
        { confirmationName },
        "DELETE",
      ),
    getAdminHunt: (id) =>
      creatorRequest(`/api/admin/hunts/${encodeURIComponent(id)}`),
    getHuntParticipationProgress: async (id) => {
      const result = await creatorRequest<HuntParticipantProgress[]>(
        `/api/admin/hunts/${encodeURIComponent(id)}/participants`,
      );
      return result.ok ? (result as HuntParticipationResult) : result;
    },
    moderateHuntParticipant: (id, participantId, action) =>
      creatorRequest(
        `/api/admin/hunts/${encodeURIComponent(id)}/participants/actions`,
        { participantId, action },
      ),
    getPlayerHunt: (id) =>
      request(`/api/player/hunts/${encodeURIComponent(id)}`),
    joinHunt: (accessCode, identity) =>
      accountRequest("/api/player/account/join", identity, { accessCode }),
    getAccountHunt: (id, identity) =>
      accountRequest(
        `/api/player/account/hunts/${encodeURIComponent(id)}`,
        identity,
      ),
    leaveHunt: (id, identity) =>
      accountRequest(
        `/api/player/account/hunts/${encodeURIComponent(id)}`,
        identity,
        undefined,
        "DELETE",
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
  method?: string,
): Promise<OperationResult<T>> {
  try {
    const response = await fetch(path, {
      method: method ?? (input === undefined ? "GET" : "POST"),
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
    typeof candidate.beginsAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.beginsAt)) ||
    !(
      candidate.endsAt === null ||
      (typeof candidate.endsAt === "string" &&
        Number.isFinite(Date.parse(candidate.endsAt)))
    ) ||
    (candidate.status !== "draft" &&
      candidate.status !== "published" &&
      candidate.status !== "archived") ||
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
      ...(item.hint === null || typeof item.hint === "string"
        ? { hint: item.hint }
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
    beginsAt: candidate.beginsAt as string,
    endsAt: candidate.endsAt as string | null,
    status: candidate.status as HuntStatus,
    ...(candidate.huntType === "kahoot"
      ? {
          huntType: "kahoot" as const,
          kahoot: candidate.kahoot as PlayerHunt["kahoot"],
        }
      : {}),
    tasks,
  };
}

export async function downloadHuntResults(
  huntId: string,
  format: "pdf" | "csv",
): Promise<OperationResult<{ downloaded: true }>> {
  const session = await getCreatorSession();
  if (!session.ok) return session;
  try {
    const token = storedGoogleToken();
    const response = await fetch(
      `/api/admin/hunts/${encodeURIComponent(huntId)}/results/${format}`,
      {
        credentials: "same-origin",
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    );
    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        typeof error.message === "string"
          ? error.message
          : "The export could not be downloaded.",
      );
    }
    const contentType = response.headers.get("Content-Type") ?? "";
    if (
      !contentType.startsWith(format === "pdf" ? "application/pdf" : "text/csv")
    )
      throw new Error("The service returned an invalid export.");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `hunt-${huntId}-results.${format}`;
    document.body.append(link);
    link.click();
    link.remove();
    // Give the browser time to start reading the object URL before releasing it.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return { ok: true, value: { downloaded: true } };
  } catch (error) {
    return {
      ok: false,
      code: "network",
      message:
        error instanceof Error
          ? error.message
          : "The export could not be downloaded. Try again.",
    };
  }
}
