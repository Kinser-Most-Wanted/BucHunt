import type { HuntRepository } from "../foundation/contracts.js";

export function mountDefineTask(
  root: HTMLElement,
  repository: HuntRepository,
): void {
  void repository;
  root.dataset.feature = "defineTask";
  // #32 owns this region. Add behavior here using the injected repository.
}
