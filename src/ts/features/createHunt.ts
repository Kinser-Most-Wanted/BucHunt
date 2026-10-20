import type { HuntRepository } from "../foundation/contracts.js";

export function mountCreateHunt(
  root: HTMLElement,
  repository: HuntRepository,
): void {
  void repository;
  root.dataset.feature = "createHunt";
  // #31 owns this region. Add behavior here using the injected repository.
}
