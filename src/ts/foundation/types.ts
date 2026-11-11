export type HuntStatus = "draft" | "published" | "archived";
export type TaskOrderMode = "sequential" | "any";
export type HuntRole = "owner" | "officer" | "contributor";
export type OrganizationRole = "owner" | "officer" | "contributor";

export interface OrganizationMember {
  accountId: string | null;
  email: string;
  role: OrganizationRole;
  originalOwner: boolean;
  pending: boolean;
  isSelf?: boolean;
}

export interface OrganizationDefinition {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  role: OrganizationRole;
  members: OrganizationMember[];
}

export interface OrganizationInvitationDefinition {
  organizationId: string;
  organizationName: string;
  role: OrganizationRole;
}

export interface OrganizationInvitationResponse {
  organizationId: string;
  accepted: boolean;
}

export interface OrganizationHuntSummary {
  id: string;
  name: string;
  description: string;
  organizationId: string;
  organizationName: string;
  role: OrganizationRole;
  beginsAt: string;
  endsAt: string | null;
  status: HuntStatus;
}

export interface HuntInput {
  huntType?: "traditional" | "kahoot";
  organizationName?: string;
  organizationId?: string | null;
  maxParticipants?: number | null;
  participationClosed?: boolean;
  name: string;
  description: string;
  ownerId: string;
  beginsAt: string;
  endsAt: string | null;
  taskOrderMode: TaskOrderMode;
}
export interface TaskLocation {
  latitude: number;
  longitude: number;
}
export type TaskType = "single-word-trivia" | "multiple-choice";
export interface TaskInput {
  timeLimitSeconds?: number | null;
  taskType?: TaskType;
  choices?: string[];
  displayLabel: string;
  description: string;
  requiredAnswer: string;
  location: TaskLocation;
  order: number;
  answerCaseSensitive: boolean;
  hint: string | null;
  points: number;
}
export interface HuntDefinition extends HuntInput {
  id: string;
  status: HuntStatus;
  createdAt: string;
  updatedAt: string;
  // Null remains supported for hunts saved before access-code joining.
  accessCode: string | null;
  tasks: TaskDefinition[];
}
export interface HuntParticipantProgress {
  participantId: string;
  displayName: string | null;
  tasks: {
    id: string;
    displayLabel: string;
    completed: boolean;
  }[];
}
export type ParticipantAction = "kick" | "ban" | "unban";
export interface HuntBannedParticipant {
  participantId: string;
  displayName: string | null;
}
export interface HuntParticipationSummary {
  activeCount: number;
  leftCompletedCount: number;
  leftIncompleteCount: number;
}
export type HuntParticipationResult =
  | {
      ok: true;
      value: HuntParticipantProgress[];
      summary: HuntParticipationSummary;
      bannedParticipants: HuntBannedParticipant[];
    }
  | Extract<OperationResult<never>, { ok: false }>;
export interface TaskDefinition extends TaskInput {
  id: string;
}
export interface PlayerTask {
  taskType?: TaskType;
  choices?: string[];
  incorrectChoices?: string[];
  description?: string;
  hint?: string | null;
  id: string;
  huntId: string;
  displayLabel: string;
  completed: boolean;
  location?: TaskLocation;
}
export interface PlayerHunt {
  huntType?: "traditional" | "kahoot";
  kahoot?: KahootView;
  organizationName?: string;
  organizationId?: string | null;
  maxParticipants?: number | null;
  participationClosed?: boolean;
  id: string;
  name: string;
  description: string;
  beginsAt: string;
  endsAt: string | null;
  status: HuntStatus;
  tasks: PlayerTask[];
}
export interface PlayerProfile {
  displayName: string | null;
}
export interface PlayerIdentity {
  email: string;
  accountId: string;
  provider: "google";
  idToken: string;
}
export interface GoogleAuthConfig {
  clientId: string;
  nonce: string;
}
export interface AdminSession {
  subject: string;
  email: string;
  expiresAt: number;
  role: "administrator" | "user";
}
export interface ValidationIssue {
  field: string;
  message: string;
}
export type OperationResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code:
        | "not-implemented"
        | "validation"
        | "unauthorized"
        | "forbidden"
        | "not-found"
        | "storage"
        | "network";
      message: string;
      issues?: ValidationIssue[];
    };
export interface HuntConfigurationFile {
  schemaVersion: 1;
  hunts: HuntDefinition[];
}

export interface KahootView {
  phase: "lobby" | "question" | "results" | "finished";
  questionNumber: number;
  totalQuestions: number;
  serverNow: number;
  startedAt: number | null;
  deadline: number | null;
  submitted: boolean;
  correct?: boolean;
  pointsAwarded?: number;
  question?: {
    id: string;
    displayLabel: string;
    description: string;
    taskType: TaskType;
    choices?: string[];
  };
  leaderboard: {
    participantId: string;
    displayName: string;
    score: number;
    submitted: boolean;
    active: boolean;
    connected: boolean;
  }[];
}
