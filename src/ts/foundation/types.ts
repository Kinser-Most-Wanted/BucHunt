export interface HuntInput {
  name: string;
  description: string;
}
export interface TaskLocation {
  latitude: number;
  longitude: number;
}
export interface TaskInput {
  displayLabel: string;
  requiredAnswer: string;
  location?: TaskLocation;
}
export interface HuntDefinition extends HuntInput {
  id: string;
  tasks: TaskDefinition[];
}
export interface TaskDefinition extends TaskInput {
  id: string;
  huntId: string;
}
export interface PlayerTask {
  id: string;
  huntId: string;
  displayLabel: string;
  completed: boolean;
  location?: TaskLocation;
}
export interface PlayerHunt {
  id: string;
  name: string;
  description: string;
  tasks: PlayerTask[];
}
export interface AdminCredentials {
  username: string;
  password: string;
}
export interface AdminSession {
  authenticated: boolean;
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
