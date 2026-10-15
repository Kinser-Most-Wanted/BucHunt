import type { DefinitionValidator } from "../foundation/contracts.js";
import { validateHunt } from "../validation/huntValidation.js";

export type { DefinitionValidator };
export const definitionValidator: DefinitionValidator = { validateHunt };
