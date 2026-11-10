import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createApplication } from "../src/ts/server/server.js";
import { OrganizationStore } from "../src/ts/server/organizationStore.js";

function accountId(subject: string): string {
  return "google-" + createHash("sha256").update(subject).digest("hex");
}

test("organization membership, roles, invitations, and saved data are protected", async () => {
  const directory = await mkdtemp(join(tmpdir(), "buchunt-organizations-"));
  const app = createApplication({
    dataDirectory: directory,
    verifyPlayerToken: async (token) => token,
    verifyGoogleIdentity: async (token) => ({
      subject: token,
      email: `${token}@example.com`,
      emailVerified: true,
    }),
  });
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  const api = async (
    token: string,
    path: string,
    input?: unknown,
    method?: string,
  ) => {
    const response = await fetch(base + path, {
      method: method ?? (input === undefined ? "GET" : "POST"),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    return { status: response.status, data: await response.json() };
  };
  try {
    const created = await api("owner", "/api/player/account/organizations", {
      name: "Campus Explorers",
    });
    expect(created.status).toBe(201);
    const organizationId = created.data.value.id as string;
    const owner = accountId("owner");
    const huntInput = {
      name: "Organization membership check",
      organizationName: "Campus Explorers",
      description: "A hunt for organization members.",
      ownerId: "ignored",
      beginsAt: "2030-01-01T12:00:00.000Z",
      endsAt: null,
      taskOrderMode: "sequential",
    };
    expect((await api("stranger", "/api/admin/hunts", huntInput)).status).toBe(
      403,
    );
    expect((await api("owner", "/api/admin/hunts", huntInput)).status).toBe(
      201,
    );

    await api(
      "owner",
      `/api/player/account/organizations/${organizationId}/members`,
      { email: "member@example.com" },
    );
    const pending = await api(
      "member",
      "/api/player/account/organization-invitations",
    );
    expect(pending.data.value).toEqual([
      {
        organizationId,
        organizationName: "Campus Explorers",
        role: "contributor",
      },
    ]);
    expect(
      (await api("member", "/api/player/account/organizations")).data.value,
    ).toEqual([]);
    expect(
      (
        await api(
          "stranger",
          `/api/player/account/organization-invitations/${organizationId}`,
          { action: "accept" },
        )
      ).status,
    ).toBe(404);
    const accepted = await api(
      "member",
      `/api/player/account/organization-invitations/${organizationId}`,
      { action: "accept" },
    );
    expect(accepted.data.value).toEqual({
      organizationId,
      accepted: true,
    });
    const memberList = await api("member", "/api/player/account/organizations");
    const organization = memberList.data.value[0];
    expect(organization.role).toBe("contributor");
    expect(organization.members).toContainEqual(
      expect.objectContaining({
        email: "member@example.com",
        role: "contributor",
        pending: false,
      }),
    );
    const member = organization.members.find(
      (entry: { email: string }) => entry.email === "member@example.com",
    );
    const memberId = member.accountId as string;
    const organizationPath = `/api/player/account/organizations/${organizationId}`;

    expect(
      (await api("member", organizationPath, { name: "Renamed" }, "PATCH"))
        .status,
    ).toBe(403);
    expect(
      (
        await api("member", organizationPath + "/members", {
          email: "other@example.com",
        })
      ).status,
    ).toBe(403);
    await api(
      "owner",
      `/api/player/account/organizations/${organizationId}/members`,
      { email: "other@example.com" },
    );
    expect(
      (await api("other", "/api/player/account/organization-invitations")).data
        .value,
    ).toHaveLength(1);
    const declined = await api(
      "other",
      `/api/player/account/organization-invitations/${organizationId}`,
      { action: "decline" },
    );
    expect(declined.data.value).toEqual({
      organizationId,
      accepted: false,
    });
    expect(
      (await api("other", "/api/player/account/organization-invitations")).data
        .value,
    ).toEqual([]);

    await api(
      "owner",
      organizationPath + `/members/${memberId}`,
      { role: "officer" },
      "PATCH",
    );
    expect(
      (await api("member", organizationPath, { name: "Campus Tech" }, "PATCH"))
        .status,
    ).toBe(200);
    expect(
      (
        await api("member", organizationPath + "/members", {
          email: "other@example.com",
        })
      ).status,
    ).toBe(403);

    await api(
      "owner",
      organizationPath + `/members/${memberId}`,
      { role: "owner" },
      "PATCH",
    );
    expect(
      (
        await api(
          "member",
          organizationPath + `/members/${owner}`,
          { role: "contributor" },
          "PATCH",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await api(
          "member",
          organizationPath + `/members/${owner}`,
          undefined,
          "DELETE",
        )
      ).status,
    ).toBe(403);

    const reopened = await new OrganizationStore(
      join(directory, "organizations.json"),
    ).listForAccount(owner);
    expect(reopened[0]).toMatchObject({
      id: organizationId,
      name: "Campus Tech",
      role: "owner",
    });
  } finally {
    app.closeAllConnections();
    await new Promise<void>((resolve) => app.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
