import type { FoundationServices } from "./contracts.js";
import { createAuthenticationService } from "../features/adminAccess.js";
import { createHuntRepository } from "../features/huntRepository.js";

// Tests can inject service doubles into individual feature mount functions.
export function createFoundationServices(): FoundationServices {
  return {
    authentication: createAuthenticationService(),
    repository: createHuntRepository(),
  };
}
