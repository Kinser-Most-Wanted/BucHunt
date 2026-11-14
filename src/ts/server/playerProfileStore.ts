import { JsonFile, StoreError } from "./huntStore.js";

export interface PlayerProfile {
  displayName: string | null;
}

interface PlayerProfileFile {
  schemaVersion: 1;
  profiles: Record<string, PlayerProfile>;
}

function profileFile(value: unknown): PlayerProfileFile {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid player profile store");
  const data = value as PlayerProfileFile;
  if (
    data.schemaVersion !== 1 ||
    !data.profiles ||
    typeof data.profiles !== "object" ||
    Array.isArray(data.profiles)
  )
    throw new Error("Invalid player profile store");
  for (const [accountId, profile] of Object.entries(data.profiles)) {
    if (
      !/^google-[a-f0-9]{64}$/.test(accountId) ||
      !profile ||
      typeof profile !== "object" ||
      (profile.displayName !== null &&
        (typeof profile.displayName !== "string" ||
          !profile.displayName.trim() ||
          profile.displayName.length > 40))
    )
      throw new Error("Invalid player profile store");
  }
  return data;
}

export class PlayerProfileStore {
  private file: JsonFile<PlayerProfileFile>;
  constructor(path: string) {
    this.file = new JsonFile(
      path,
      () => ({ schemaVersion: 1, profiles: {} }),
      profileFile,
    );
  }

  async get(accountId: string): Promise<PlayerProfile> {
    const data = await this.file.get();
    return data.profiles[accountId] ?? { displayName: null };
  }

  async save(accountId: string, input: unknown): Promise<PlayerProfile> {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => key !== "displayName")
    )
      throw new StoreError("validation", "Submit a display name.");
    const displayName = (input as Record<string, unknown>).displayName;
    if (
      typeof displayName !== "string" ||
      !displayName.trim() ||
      displayName.trim().length > 40
    )
      throw new StoreError(
        "validation",
        "Display name must be between 1 and 40 characters.",
      );
    const profile = { displayName: displayName.trim() };
    return this.file.update((data) => {
      data.profiles[accountId] = profile;
      return profile;
    });
  }
}
