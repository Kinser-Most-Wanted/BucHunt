import type { HuntRepository } from "../foundation/contracts.js";
import type { OperationResult } from "../foundation/types.js";

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
  };
}
