import type { HuntRepository } from "../foundation/contracts.js";

export function mountDisplayTasks(
  root: HTMLElement,
  repository: HuntRepository,
): void {
  void repository;
  root.dataset.feature = "displayTasks";
  // #38 owns this region. Add behavior here using the injected repository.
}
