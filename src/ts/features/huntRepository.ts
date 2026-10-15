import type { HuntRepository } from "../foundation/contracts.js";
import type { OperationResult } from "../foundation/types.js";

export function createHuntRepository(): HuntRepository {
  async function request<T>(
    path: string,
    input?: unknown,
  ): Promise<OperationResult<T>> {
    const token =
      document.querySelector<HTMLInputElement>("#admin-api-token")?.value ?? "";
    try {
      const response = await fetch(path, {
        method: input === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(path.startsWith("/api/admin/")
            ? { Authorization: `Bearer ${token}` }
            : {}),
        },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      });
      const result = await response.json();
      if (
        !result ||
        typeof result.ok !== "boolean" ||
        (response.ok && !result.ok) ||
        (!response.ok && result.ok)
      )
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
  return {
    createHunt: (input) => request("/api/admin/hunts", input),
    addTask: (id, input) =>
      request(`/api/admin/hunts/${encodeURIComponent(id)}/tasks`, input),
    getAdminHunt: (id) => request(`/api/admin/hunts/${encodeURIComponent(id)}`),
    getPlayerHunt: (id) =>
      request(`/api/player/hunts/${encodeURIComponent(id)}`),
  };
}
