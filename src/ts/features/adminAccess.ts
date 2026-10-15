import type { AuthenticationService } from "../foundation/contracts.js";
import type { OperationResult } from "../foundation/types.js";

const pending = <T>(): Promise<OperationResult<T>> =>
  Promise.resolve({
    ok: false,
    code: "not-implemented",
    message: "Administrative authentication is not implemented (#43).",
  });

export function createAuthenticationService(): AuthenticationService {
  return {
    signIn: () => pending(),
    getSession: () => pending(),
    signOut: () => pending(),
  };
}
export function mountAdminAccess(
  root: HTMLElement,
  service: AuthenticationService,
): void {
  void service;
  root.dataset.feature = "admin-access";
  // #43 owns authentication behavior. No credentials are accepted by this shell.
}
