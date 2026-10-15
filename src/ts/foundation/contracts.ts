import type {
  AdminCredentials,
  AdminSession,
  HuntDefinition,
  HuntInput,
  OperationResult,
  PlayerHunt,
  TaskDefinition,
  TaskInput,
} from "./types.js";

export interface AuthenticationService {
  signIn(credentials: AdminCredentials): Promise<OperationResult<AdminSession>>;
  getSession(): Promise<OperationResult<AdminSession>>;
  signOut(): Promise<OperationResult<void>>;
}
export interface DefinitionValidator {
  // Validate a complete persisted Hunt, including all embedded Tasks.
  validateHunt(input: unknown): OperationResult<HuntDefinition>;
}
// All administrative operations must be authorized by the future server.
export interface HuntRepository {
  createHunt(input: HuntInput): Promise<OperationResult<HuntDefinition>>;
  addTask(
    huntId: string,
    input: TaskInput,
  ): Promise<OperationResult<TaskDefinition>>;
  getAdminHunt(huntId: string): Promise<OperationResult<HuntDefinition>>;
  getPlayerHunt(huntId: string): Promise<OperationResult<PlayerHunt>>;
}
export interface FoundationServices {
  authentication: AuthenticationService;
  repository: HuntRepository;
}
