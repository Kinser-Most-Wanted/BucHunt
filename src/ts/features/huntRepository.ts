import type { HuntRepository } from "../foundation/contracts.js";
import type { OperationResult } from "../foundation/types.js";

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
  };
}
