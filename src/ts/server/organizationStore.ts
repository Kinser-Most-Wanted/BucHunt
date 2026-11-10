import { randomUUID } from "node:crypto";
import { JsonFile, StoreError } from "./huntStore.js";
import type {
  OrganizationDefinition,
  OrganizationMember,
  OrganizationRole,
} from "../foundation/types.js";

interface StoredOrganization {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  members: OrganizationMember[];
}

interface OrganizationFile {
  schemaVersion: 1;
  organizations: StoredOrganization[];
}

function validateFile(value: unknown): OrganizationFile {
  if (
    !value ||
    typeof value !== "object" ||
    (value as OrganizationFile).schemaVersion !== 1 ||
    !Array.isArray((value as OrganizationFile).organizations)
  )
    throw new StoreError("storage", "Stored organization data is invalid.");
  return value as OrganizationFile;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function organizationName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120)
    throw new StoreError(
      "validation",
      "Organization name must be between 1 and 120 characters.",
    );
  return value.trim();
}

function roleFor(
  organization: StoredOrganization,
  accountId: string,
  email: string,
): OrganizationRole | undefined {
  return organization.members.find(
    (member) =>
      member.accountId === accountId ||
      (email && member.pending && member.email === email),
  )?.role;
}

export class OrganizationStore {
  private readonly file: JsonFile<OrganizationFile>;

  constructor(path: string) {
    this.file = new JsonFile(
      path,
      () => ({ schemaVersion: 1, organizations: [] }),
      validateFile,
    );
  }

  async listForAccount(
    accountId: string,
    email: string,
  ): Promise<OrganizationDefinition[]> {
    const normalized = normalizeEmail(email);
    const snapshot = await this.file.get();
    const hasInvitation = snapshot.organizations.some((organization) =>
      organization.members.some(
        (member) => member.pending && member.email === normalized,
      ),
    );
    if (!hasInvitation)
      return this.viewsForAccount(snapshot, accountId, normalized);
    return this.file.update((file) => {
      for (const organization of file.organizations)
        for (const member of organization.members)
          if (member.pending && member.email === normalized) {
            member.accountId = accountId;
            member.pending = false;
          }
      return this.viewsForAccount(file, accountId, normalized);
    });
  }

  private viewsForAccount(
    file: OrganizationFile,
    accountId: string,
    email: string,
  ): OrganizationDefinition[] {
    return file.organizations.flatMap((organization) => {
      const role = roleFor(organization, accountId, email);
      return role
        ? [
            {
              ...organization,
              role,
              members: organization.members.map((member) => ({
                ...member,
                isSelf: member.accountId === accountId,
              })),
            },
          ]
        : [];
    });
  }

  create(
    accountId: string,
    email: string,
    input: unknown,
  ): Promise<OrganizationDefinition> {
    const name = organizationName(
      input && typeof input === "object"
        ? (input as Record<string, unknown>).name
        : undefined,
    );
    const normalized = normalizeEmail(email);
    if (!normalized)
      throw new StoreError(
        "validation",
        "A verified account email is required.",
      );
    return this.file.update((file) => {
      const now = new Date().toISOString();
      const organization: StoredOrganization = {
        id: randomUUID(),
        name,
        createdAt: now,
        updatedAt: now,
        members: [
          {
            accountId,
            email: normalized,
            role: "owner",
            originalOwner: true,
            pending: false,
          },
        ],
      };
      file.organizations.push(organization);
      return { ...organization, role: "owner" };
    });
  }

  async isMemberOfName(
    accountId: string,
    email: string,
    name: string,
  ): Promise<boolean> {
    const normalized = normalizeEmail(email);
    return this.file.query((file) =>
      file.organizations.some(
        (organization) =>
          organization.name.toLocaleLowerCase() ===
            name.trim().toLocaleLowerCase() &&
          roleFor(organization, accountId, normalized) !== undefined,
      ),
    );
  }

  rename(
    organizationId: string,
    accountId: string,
    email: string,
    input: unknown,
  ): Promise<OrganizationDefinition> {
    const name = organizationName(
      input && typeof input === "object"
        ? (input as Record<string, unknown>).name
        : undefined,
    );
    return this.file.update((file) => {
      const organization = file.organizations.find(
        (item) => item.id === organizationId,
      );
      if (!organization)
        throw new StoreError("not-found", "Organization not found.");
      const role = roleFor(organization, accountId, normalizeEmail(email));
      if (role !== "owner" && role !== "officer")
        throw new StoreError(
          "forbidden",
          "Only Organization Owners and Officers can edit its name.",
        );
      organization.name = name;
      organization.updatedAt = new Date().toISOString();
      return { ...organization, role };
    });
  }

  invite(
    organizationId: string,
    accountId: string,
    actorEmail: string,
    input: unknown,
  ): Promise<OrganizationDefinition> {
    const fields =
      input && typeof input === "object"
        ? (input as Record<string, unknown>)
        : {};
    const email =
      typeof fields.email === "string" ? normalizeEmail(fields.email) : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new StoreError("validation", "Enter a valid email address.");
    if (email === normalizeEmail(actorEmail))
      throw new StoreError(
        "validation",
        "You are already in this organization.",
      );
    return this.file.update((file) => {
      const organization = file.organizations.find(
        (item) => item.id === organizationId,
      );
      if (!organization)
        throw new StoreError("not-found", "Organization not found.");
      if (
        roleFor(organization, accountId, normalizeEmail(actorEmail)) !== "owner"
      )
        throw new StoreError(
          "forbidden",
          "Only Organization Owners can invite people.",
        );
      if (organization.members.some((member) => member.email === email))
        throw new StoreError(
          "validation",
          "This email is already part of the organization.",
        );
      organization.members.push({
        accountId: null,
        email,
        role: "contributor",
        originalOwner: false,
        pending: true,
      });
      organization.updatedAt = new Date().toISOString();
      return {
        ...organization,
        role: "owner",
        members: organization.members.map((member) => ({ ...member })),
      };
    });
  }

  setRole(
    organizationId: string,
    accountId: string,
    actorEmail: string,
    memberKey: string,
    role: unknown,
  ): Promise<OrganizationDefinition> {
    if (!["owner", "officer", "contributor"].includes(String(role)))
      throw new StoreError("validation", "Choose a valid Organization role.");
    return this.file.update((file) => {
      const organization = file.organizations.find(
        (item) => item.id === organizationId,
      );
      if (!organization)
        throw new StoreError("not-found", "Organization not found.");
      if (
        roleFor(organization, accountId, normalizeEmail(actorEmail)) !== "owner"
      )
        throw new StoreError(
          "forbidden",
          "Only Organization Owners can change member roles.",
        );
      const member = organization.members.find(
        (item) =>
          item.accountId === memberKey ||
          (item.pending && `invite:${item.email}` === memberKey),
      );
      if (!member)
        throw new StoreError("not-found", "Organization member not found.");
      if (member.originalOwner || member.accountId === accountId)
        throw new StoreError(
          "forbidden",
          "The original Owner cannot be demoted, and members cannot change their own role.",
        );
      member.role = role as OrganizationRole;
      organization.updatedAt = new Date().toISOString();
      return {
        ...organization,
        role: "owner",
        members: organization.members.map((item) => ({ ...item })),
      };
    });
  }

  removeMember(
    organizationId: string,
    accountId: string,
    actorEmail: string,
    memberKey: string,
  ): Promise<OrganizationDefinition> {
    return this.file.update((file) => {
      const organization = file.organizations.find(
        (item) => item.id === organizationId,
      );
      if (!organization)
        throw new StoreError("not-found", "Organization not found.");
      if (
        roleFor(organization, accountId, normalizeEmail(actorEmail)) !== "owner"
      )
        throw new StoreError(
          "forbidden",
          "Only Organization Owners can remove members.",
        );
      const index = organization.members.findIndex(
        (item) =>
          item.accountId === memberKey ||
          (item.pending && `invite:${item.email}` === memberKey),
      );
      if (index < 0)
        throw new StoreError("not-found", "Organization member not found.");
      const member = organization.members[index];
      if (!member)
        throw new StoreError("not-found", "Organization member not found.");
      if (member.originalOwner || member.accountId === accountId)
        throw new StoreError(
          "forbidden",
          "The original Owner cannot be removed, and Owners cannot remove themselves.",
        );
      organization.members.splice(index, 1);
      organization.updatedAt = new Date().toISOString();
      return {
        ...organization,
        role: "owner",
        members: organization.members.map((member) => ({ ...member })),
      };
    });
  }
}
