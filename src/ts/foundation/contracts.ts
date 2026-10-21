import type {
  AdminSession,
  GoogleAuthConfig,
  HuntDefinition,
  HuntInput,
  OperationResult,
  PlayerIdentity,
  PlayerHunt,
  TaskDefinition,
  TaskInput,
} from "./types.js";

export interface AuthenticationService {
  getGoogleConfig(): Promise<OperationResult<GoogleAuthConfig>>;
  signIn(credential: string): Promise<OperationResult<AdminSession>>;
  getSession(): Promise<OperationResult<AdminSession>>;
  getCapabilities(): Promise<OperationResult<void>>;
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
  getAccountHunt(
    huntId: string,
    identity: PlayerIdentity,
  ): Promise<OperationResult<PlayerHunt>>;
  answerAccountTask(
    huntId: string,
    taskId: string,
    answer: string,
    identity: PlayerIdentity,
  ): Promise<OperationResult<{ completed: boolean }>>;
  listActiveHunts(
    identity: PlayerIdentity,
  ): Promise<OperationResult<PlayerHunt[]>>;
}
export interface FoundationServices {
  authentication: AuthenticationService;
  repository: HuntRepository;
}
