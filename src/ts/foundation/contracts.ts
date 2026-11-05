import type {
  AdminSession,
  GoogleAuthConfig,
  HuntDefinition,
  HuntInput,
  HuntParticipantProgress,
  OperationResult,
  PlayerIdentity,
  PlayerProfile,
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
  updateTask(
    huntId: string,
    taskId: string,
    input: TaskInput,
  ): Promise<OperationResult<TaskDefinition>>;
  deleteTask(
    huntId: string,
    taskId: string,
  ): Promise<OperationResult<{ deleted: true }>>;
  deleteHunt(
    huntId: string,
    confirmationName: string,
  ): Promise<OperationResult<{ deleted: true }>>;
  getAdminHunt(huntId: string): Promise<OperationResult<HuntDefinition>>;
  getHuntParticipants(
    huntId: string,
  ): Promise<OperationResult<HuntParticipantProgress[]>>;
  getPlayerHunt(huntId: string): Promise<OperationResult<PlayerHunt>>;
  getAccountProfile(
    identity: PlayerIdentity,
  ): Promise<OperationResult<PlayerProfile>>;
  saveAccountProfile(
    displayName: string,
    identity: PlayerIdentity,
  ): Promise<OperationResult<PlayerProfile>>;
  joinHunt(
    accessCode: string,
    identity: PlayerIdentity,
  ): Promise<OperationResult<{ huntId: string }>>;
  getAccountHunt(
    huntId: string,
    identity: PlayerIdentity,
  ): Promise<OperationResult<PlayerHunt>>;
  leaveHunt(
    huntId: string,
    identity: PlayerIdentity,
  ): Promise<OperationResult<{ left: true }>>;
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
