import { OAuth2Client } from "google-auth-library";
import type {
  HuntDefinition,
  HuntBannedParticipant,
  HuntParticipantProgress,
  ParticipantAction,
  PlayerHunt,
  TaskDefinition,
} from "../foundation/types.js";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HuntStore,
  StoreError,
  ContributorStore,
  isHuntActive,
  isHuntJoinable,
} from "./huntStore.js";
import { KahootStore } from "./kahootStore.js";
import { HuntIssueStore } from "./huntIssueStore.js";
import { PlayerProgressStore } from "./playerProgressStore.js";
import { PlayerProfileStore } from "./playerProfileStore.js";
import {
  buildHuntResults,
  resultsCsv,
  resultsPdf,
} from "./huntResultsExport.js";

interface ServerOptions {
  dataDirectory?: string;
  staticDirectory?: string;
  originToken?: string;
  googleClientId?: string;
  // Tests inject the identity verifier; production always uses Google's verifier.
  verifyPlayerToken?: (token: string) => Promise<string>;
  verifyGoogleIdentity?: (token: string) => Promise<{
    subject: string;
    email: string;
    emailVerified: boolean;
  }>;
}
const MIGRATION_OWNER_EMAIL = "codepro1012@gmail.com";
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
async function body(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new StoreError(
      "validation",
      "Content-Type must be application/json.",
    );
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65536)
      throw new StoreError("validation", "Request exceeds 64 KiB.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new StoreError("validation", "Request must contain valid JSON.");
  }
}
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}
function playerChoices(task: TaskDefinition, incorrectChoices: string[]) {
  return task.taskType === "multiple-choice"
    ? {
        taskType: task.taskType,
        choices: [...task.choices!].sort(),
        incorrectChoices,
      }
    : { taskType: "single-word-trivia" as const };
}
async function evaluateChoice(
  store: PlayerProgressStore,
  player: string,
  hunt: string,
  task: TaskDefinition,
  answer: string,
): Promise<boolean> {
  if (!task.choices?.includes(answer))
    throw new StoreError("validation", "Select one of the available choices.");
  if ((await store.incorrect(player, hunt))[task.id]?.includes(answer))
    return false;
  if (answer !== task.requiredAnswer) {
    await store.rejectChoice(player, hunt, task.id, answer);
    return false;
  }
  await store.complete(player, hunt, task.id);
  return true;
}
function availableTasks(
  hunt: HuntDefinition,
  completed: string[],
): TaskDefinition[] {
  const ordered = [...hunt.tasks].sort(
    (left, right) => left.order - right.order,
  );
  if (hunt.taskOrderMode !== "sequential") return ordered;
  const nextIndex = ordered.findIndex((task) => !completed.includes(task.id));
  return ordered.filter(
    (task, index) => completed.includes(task.id) || index === nextIndex,
  );
}
function rejectFutureTask(
  hunt: HuntDefinition,
  task: TaskDefinition,
  completed: string[],
): void {
  if (hunt.taskOrderMode !== "sequential" || completed.includes(task.id))
    return;
  const ordered = [...hunt.tasks].sort(
    (left, right) => left.order - right.order,
  );
  const nextIndex = ordered.findIndex((item) => !completed.includes(item.id));
  if (ordered.indexOf(task) !== nextIndex)
    throw new StoreError(
      "validation",
      "Complete the previous task before starting this one.",
    );
}
export function createApplication(options: ServerOptions = {}) {
  const directory = resolve(options.dataDirectory ?? "data");
  const staticDirectory = resolve(options.staticDirectory ?? "src");
  const kahoot = new KahootStore(resolve(directory, "kahoot-games.json"));
  const issueReports = new HuntIssueStore(
    resolve(directory, "hunt-issues.json"),
  );
  const hunts = new HuntStore(resolve(directory, "hunts.json"));
  const contributors = new ContributorStore(
    resolve(directory, "hunt-contributors.json"),
  );
  const progress = new PlayerProgressStore(
    resolve(directory, "player-progress.json"),
  );
  const accountProgress = new PlayerProgressStore(
    resolve(directory, "account-player-progress.json"),
  );
  const accountProfiles = new PlayerProfileStore(
    resolve(directory, "player-profiles.json"),
  );
  async function contributorEntries(huntId: string, ownerId: string) {
    const ownerProfile = await accountProfiles.get(ownerId);
    const entries = await contributors.entries(
      huntId,
      ownerId,
      ownerProfile.displayName ?? undefined,
    );
    return Promise.all(
      entries.map(async (entry) => {
        if (entry.originalOwner || entry.pending) return entry;
        const profile = await accountProfiles.get(entry.id);
        return {
          ...entry,
          ...(profile.displayName ? { displayName: profile.displayName } : {}),
        };
      }),
    );
  }
  // Admission and settings updates share a queue, so closing a hunt cannot race a join.
  const admissionQueues = new Map<string, Promise<unknown>>();
  function serializeAdmission<T>(
    id: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = admissionQueues.get(id) ?? Promise.resolve();
    const next = previous.then(operation);
    const settled = next.catch(() => undefined);
    admissionQueues.set(id, settled);
    void settled.then(() => {
      if (admissionQueues.get(id) === settled) admissionQueues.delete(id);
    });
    return next;
  }
  const google = new OAuth2Client(options.googleClientId);
  async function playerId(request: IncomingMessage): Promise<string | null> {
    const match = /^Bearer ([^\s]{1,16384})$/.exec(
      request.headers.authorization ?? "",
    );
    if (!match) return null;
    let subject: string;
    try {
      if (options.verifyPlayerToken)
        subject = await options.verifyPlayerToken(match[1]);
      else {
        if (!options.googleClientId) return null;
        const ticket = await google.verifyIdToken({
          idToken: match[1],
          audience: options.googleClientId,
        });
        const claims = ticket.getPayload();
        if (
          !claims?.sub ||
          claims.email_verified !== true ||
          (claims.azp && claims.azp !== options.googleClientId)
        )
          return null;
        subject = claims.sub;
      }
      if (!subject) return null;
    } catch {
      return null;
    }
    return "google-" + createHash("sha256").update(subject).digest("hex");
  }
  async function googleCreator(request: IncomingMessage): Promise<{
    id: string;
    email: string;
  } | null> {
    const match = /^Bearer ([^\s]{1,16384})$/.exec(
      request.headers.authorization ?? "",
    );
    if (!match) return null;
    try {
      let subject: string;
      let email: string;
      let emailVerified: boolean;
      if (options.verifyGoogleIdentity) {
        const identity = await options.verifyGoogleIdentity(match[1]);
        subject = identity.subject;
        email = identity.email;
        emailVerified = identity.emailVerified;
      } else {
        if (!options.googleClientId) return null;
        const ticket = await google.verifyIdToken({
          idToken: match[1],
          audience: options.googleClientId,
        });
        const claims = ticket.getPayload();
        if (!claims?.sub || typeof claims.email !== "string") return null;
        subject = claims.sub;
        email = claims.email;
        emailVerified = claims.email_verified === true;
        if (claims.azp && claims.azp !== options.googleClientId) return null;
      }
      if (!subject || !email || !emailVerified) return null;
      return {
        id: "google-" + createHash("sha256").update(subject).digest("hex"),
        email: email.toLowerCase(),
      };
    } catch {
      return null;
    }
  }
  async function playerHunt(
    player: string,
    hunt: HuntDefinition,
  ): Promise<PlayerHunt> {
    const completed = await accountProgress.completed(player, hunt.id);
    const incorrect = await accountProgress.incorrect(player, hunt.id);
    if (hunt.huntType === "kahoot") {
      for (const id of await kahoot.completed(hunt.id, player))
        if (!completed.includes(id))
          await accountProgress.complete(player, hunt.id, id);
      return {
        id: hunt.id,
        name: hunt.name,
        description: hunt.description,
        organizationName: hunt.organizationName,
        huntType: "kahoot",
        beginsAt: hunt.beginsAt,
        endsAt: hunt.endsAt,
        status: hunt.status,
        tasks: [],
        kahoot: await kahoot.state(
          hunt.id,
          (await accountProgress.participants(hunt.id)).map(
            (player) => player.playerId,
          ),
          {
            id: player,
            displayName:
              (await accountProfiles.get(player)).displayName ?? "Player",
          },
          Date.now(),
          !isHuntJoinable(hunt),
        ),
      };
    }
    return {
      id: hunt.id,
      name: hunt.name,
      organizationName: hunt.organizationName,
      huntType: hunt.huntType,
      description: hunt.description,
      beginsAt: hunt.beginsAt,
      endsAt: hunt.endsAt,
      status: hunt.status,
      tasks: availableTasks(hunt, completed).map((task) => ({
        id: task.id,
        huntId: hunt.id,
        displayLabel: task.displayLabel,
        description: task.description,
        hint: task.hint,
        location: task.location,
        completed: completed.includes(task.id),
        ...playerChoices(task, incorrect[task.id] ?? []),
      })),
    };
  }
  return createServer(async (request, response) => {
    if (
      options.originToken &&
      request.headers["x-origin-token"] !== options.originToken
    ) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    const requestId = randomUUID();
    response.setHeader("X-Request-Id", requestId);
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const path = decodeURIComponent(url.pathname);
      const method = request.method ?? "GET";
      if (path === "/api/health" && method === "GET") {
        json(response, 200, { ok: true, value: { status: "ready" } });
        return;
      }
      // This account flow uses only bearer tokens, never reads or sets cookies.
      if (path.startsWith("/api/player/account/")) {
        if (path === "/api/player/account/config" && method === "GET") {
          if (!options.googleClientId) {
            json(response, 503, {
              ok: false,
              code: "network",
              message: "Player Google sign-in is not configured.",
            });
          } else
            json(response, 200, {
              ok: true,
              value: { clientId: options.googleClientId },
            });
          return;
        }
        const player = await playerId(request);
        if (!player) {
          json(response, 401, {
            ok: false,
            code: "unauthorized",
            message: "Sign in with Google again to access saved progress.",
          });
          return;
        }
        if (path === "/api/player/account/profile" && method === "GET") {
          json(response, 200, {
            ok: true,
            value: await accountProfiles.get(player),
          });
          return;
        }
        if (path === "/api/player/account/profile" && method === "PUT") {
          json(response, 200, {
            ok: true,
            value: await accountProfiles.save(player, await body(request)),
          });
          return;
        }
        if (path === "/api/player/account/join" && method === "POST") {
          const input = await body(request);
          const code =
            input && typeof input === "object"
              ? (input as Record<string, unknown>).accessCode
              : undefined;
          const normalized =
            typeof code === "string" ? code.trim().toUpperCase() : "";
          const hunt = /^[A-F0-9]{8}$/.test(normalized)
            ? await hunts.findByAccessCode(normalized)
            : undefined;
          if (!hunt || !isHuntJoinable(hunt))
            throw new StoreError(
              "validation",
              "Invalid access code. The hunt may be unavailable.",
            );
          await serializeAdmission(hunt.id, async () => {
            const current = await hunts.get(hunt.id);
            if (
              current.huntType === "kahoot" &&
              (await kahoot.hasStarted(hunt.id)) &&
              !(await accountProgress.huntsWithProgress(player)).includes(
                hunt.id,
              )
            )
              throw new StoreError(
                "forbidden",
                "This Kahoot Hunt has already started. New players cannot join.",
              );
            await accountProgress.join(player, hunt.id, {
              closed: current.participationClosed,
              maximum: current.maxParticipants,
              otherCount: (await progress.participants(hunt.id)).length,
            });
          });
          if (hunt.huntType === "kahoot") await playerHunt(player, hunt);
          json(response, 200, { ok: true, value: { huntId: hunt.id } });
          return;
        }
        if (path === "/api/player/account/hunts" && method === "GET") {
          const savedHunts = await accountProgress.huntsWithProgress(player);
          const definitions = await hunts.list();
          // Read every hunt with saved progress before returning; storage failures must not
          // masquerade as an empty list or reset incomplete/completed states.
          const available = definitions.filter((hunt) =>
            savedHunts.includes(hunt.id),
          );
          if (available.length !== savedHunts.length)
            throw new StoreError(
              "storage",
              "A hunt with saved progress could not be restored. Contact the hunt creator.",
            );
          json(response, 200, {
            ok: true,
            value: await Promise.all(
              available.map((hunt) => playerHunt(player, hunt)),
            ),
          });
          return;
        }
        const issueMatch =
          /^\/api\/player\/account\/hunts\/([a-zA-Z0-9-]+)\/issues(?:\/(tasks))?$/.exec(
            path,
          );
        if (issueMatch) {
          const hunt = await hunts.get(issueMatch[1]);
          if (
            !(await accountProgress.huntsWithProgress(player)).includes(hunt.id)
          )
            throw new StoreError("forbidden", "Join this hunt first.");
          if (issueMatch[2] && method === "GET") {
            const tasks =
              hunt.huntType === "kahoot"
                ? await kahoot.reportableTasks(hunt)
                : hunt.tasks;
            json(response, 200, {
              ok: true,
              value: tasks.map(({ id, displayLabel }) => ({
                id,
                displayLabel,
              })),
            });
            return;
          }
          if (!issueMatch[2] && method === "POST") {
            json(response, 201, {
              ok: true,
              value: await issueReports.submit(
                hunt.huntType === "kahoot"
                  ? { ...hunt, tasks: await kahoot.reportableTasks(hunt) }
                  : hunt,
                await body(request),
              ),
            });
            return;
          }
        }
        const accountMatch =
          /^\/api\/player\/account\/hunts\/([a-zA-Z0-9-]+)(?:\/tasks\/([a-zA-Z0-9-]+)\/answer)?$/.exec(
            path,
          );
        if (accountMatch) {
          const hunt = await hunts.get(accountMatch[1]);
          if (
            !(await accountProgress.huntsWithProgress(player)).includes(hunt.id)
          ) {
            json(response, 403, {
              ok: false,
              code: "forbidden",
              message: "Join this hunt using its access code first.",
            });
            return;
          }
          if (method === "GET" && !accountMatch[2]) {
            json(response, 200, {
              ok: true,
              value: await playerHunt(player, hunt),
            });
            return;
          }
          if (method === "DELETE" && !accountMatch[2]) {
            await accountProgress.leave(player, hunt.id);
            json(response, 200, { ok: true, value: { left: true } });
            return;
          }
          if (method === "POST" && accountMatch[2]) {
            if (hunt.huntType === "kahoot") {
              if (!isHuntJoinable(hunt))
                throw new StoreError(
                  "forbidden",
                  "Hunt Ended. Answers can no longer be submitted.",
                );
              const input = await body(request);
              const answer =
                input && typeof input === "object"
                  ? (input as Record<string, unknown>).answer
                  : undefined;
              const result = await kahoot.answer(
                hunt.id,
                player,
                accountMatch[2],
                answer,
                (await accountProgress.participants(hunt.id)).map(
                  (item) => item.playerId,
                ),
              );
              // The game record is authoritative; repair completion mirrors on every answer.
              for (const id of await kahoot.completed(hunt.id, player))
                await accountProgress.complete(player, hunt.id, id);
              json(response, 200, { ok: true, value: result });
              return;
            }
            if (!isHuntActive(hunt)) {
              const message =
                hunt.status === "archived" ||
                (hunt.endsAt !== null && Date.parse(hunt.endsAt) <= Date.now())
                  ? "Hunt Ended. Answers can no longer be submitted."
                  : "This Hunt has not started yet.";
              throw new StoreError("validation", message);
            }
            const task = hunt.tasks.find((task) => task.id === accountMatch[2]);
            if (!task) throw new StoreError("not-found", "Task not found.");
            rejectFutureTask(
              hunt,
              task,
              await accountProgress.completed(player, hunt.id),
            );
            const input = await body(request);
            const answer =
              input && typeof input === "object"
                ? (input as Record<string, unknown>).answer
                : undefined;
            if (typeof answer !== "string" || !answer.trim())
              throw new StoreError("validation", "Enter an answer.");
            if (task.taskType === "multiple-choice") {
              const completed = await evaluateChoice(
                accountProgress,
                player,
                hunt.id,
                task,
                answer,
              );
              json(response, 200, { ok: true, value: { completed } });
              return;
            }
            const normalize = (answer: string) =>
              task.answerCaseSensitive
                ? answer.trim()
                : answer.trim().toLowerCase();
            if (normalize(answer) !== normalize(task.requiredAnswer))
              throw new StoreError(
                "validation",
                "That answer did not match. Try again.",
              );
            await accountProgress.complete(player, hunt.id, task.id);
            json(response, 200, { ok: true, value: { completed: true } });
            return;
          }
        }
        json(response, 404, {
          ok: false,
          code: "not-found",
          message: "Player account route not found.",
        });
        return;
      }
      if (path.startsWith("/api/admin/")) {
        const origin = request.headers.origin;
        if (
          request.headers["sec-fetch-site"] === "cross-site" ||
          (origin && new URL(origin).host !== request.headers.host)
        ) {
          json(response, 403, {
            ok: false,
            code: "unauthorized",
            message: "Cross-origin requests are not allowed.",
          });
          return;
        }
        let secret = /(?:^|;\s*)buchunt-creator=([a-f0-9]{64})(?:;|$)/.exec(
          request.headers.cookie ?? "",
        )?.[1];
        const account = await googleCreator(request);
        const legacyCreatorId = secret
          ? "browser:" + createHash("sha256").update(secret).digest("hex")
          : null;
        if (account)
          await contributors.acceptInvitations(account.email, account.id);
        if (path === "/api/admin/session" && method === "GET") {
          if (account) {
            if (legacyCreatorId)
              await contributors.linkLegacyCreator(legacyCreatorId, account.id);
            if (account.email === MIGRATION_OWNER_EMAIL)
              await hunts.migrateLegacyOwners(account.id);
            json(response, 200, {
              ok: true,
              value: { id: account.id, identityType: "google-account" },
            });
            return;
          }
          secret ??= randomBytes(32).toString("hex");
          response.setHeader(
            "Set-Cookie",
            `buchunt-creator=${secret}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=31536000${request.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""}`,
          );
          json(response, 200, {
            ok: true,
            value: {
              id:
                "browser:" + createHash("sha256").update(secret).digest("hex"),
              identityType: "temporary-browser",
            },
          });
          return;
        }
        if (!secret) {
          if (!account) {
            json(response, 401, {
              ok: false,
              code: "unauthorized",
              message: "Sign in with Google to manage hunts.",
            });
            return;
          }
        }
        const creatorId =
          account?.id ??
          "browser:" + createHash("sha256").update(secret!).digest("hex");
        if (path === "/api/admin/hunts" && method === "POST") {
          json(response, 201, {
            ok: true,
            value: await hunts.create(await body(request), creatorId),
          });
          return;
        }
        if (path === "/api/admin/hunts" && method === "GET") {
          const summaries = await hunts.listSummaries();
          const accessible = await Promise.all(
            summaries.map(async (hunt) => ({
              hunt,
              role: await contributors.roleFor(
                hunt.id,
                creatorId,
                hunt.ownerId,
              ),
            })),
          );
          json(response, 200, {
            ok: true,
            value: accessible
              .filter(({ role }) => role !== undefined)
              .map(({ hunt, role }) => ({
                id: hunt.id,
                name: hunt.name,
                role,
                createdAt: hunt.createdAt,
                updatedAt: hunt.updatedAt,
              })),
          });
          return;
        }
        const gameMatch = /^\/api\/admin\/hunts\/([a-zA-Z0-9-]+)\/kahoot$/.exec(
          path,
        );
        if (gameMatch) {
          const hunt = await hunts.get(gameMatch[1]);
          const role = await contributors.roleFor(
            hunt.id,
            creatorId,
            hunt.ownerId,
          );
          if (role !== "owner" && role !== "officer")
            throw new StoreError(
              "forbidden",
              "Only Owners and Officers can host this hunt.",
            );
          if (hunt.huntType !== "kahoot")
            throw new StoreError("validation", "This is a Traditional Hunt.");
          if (method === "GET" || method === "POST") {
            const input = method === "POST" ? await body(request) : undefined;
            const value = await serializeAdmission(hunt.id, async () => {
              const records = await accountProgress.participants(hunt.id);
              const participants = await Promise.all(
                records.map(async (person) => ({
                  id: person.playerId,
                  displayName:
                    (await accountProfiles.get(person.playerId)).displayName ??
                    "Player",
                })),
              );
              if (method === "GET")
                return kahoot.state(
                  hunt.id,
                  participants.map((person) => person.id),
                  undefined,
                  Date.now(),
                  !isHuntJoinable(hunt),
                );
              if (!isHuntJoinable(hunt))
                throw new StoreError("forbidden", "This hunt has ended.");
              return kahoot.control(
                await hunts.get(hunt.id),
                input && typeof input === "object"
                  ? (input as Record<string, unknown>).action
                  : undefined,
                participants,
              );
            });
            json(response, 200, { ok: true, value });
            return;
          }
        }
        const issueAdminMatch =
          /^\/api\/admin\/hunts\/([a-zA-Z0-9-]+)\/issues(?:\/(read))?$/.exec(
            path,
          );
        if (issueAdminMatch) {
          const hunt = await hunts.get(issueAdminMatch[1]);
          const role = await contributors.roleFor(
            hunt.id,
            creatorId,
            hunt.ownerId,
          );
          if (role !== "owner" && role !== "officer")
            throw new StoreError(
              "forbidden",
              "Only Owners and Officers can view hunt issues.",
            );
          if (method === "GET" && !issueAdminMatch[2]) {
            json(response, 200, {
              ok: true,
              value: await issueReports.list(hunt.id, creatorId),
            });
            return;
          }
          if (method === "POST" && issueAdminMatch[2]) {
            json(response, 200, {
              ok: true,
              value: await issueReports.markRead(
                hunt.id,
                creatorId,
                await body(request),
              ),
            });
            return;
          }
        }
        const exportMatch =
          /^\/api\/admin\/hunts\/([a-zA-Z0-9-]+)\/results\/(pdf|csv)$/.exec(
            path,
          );
        const participantMatch =
          /^\/api\/admin\/hunts\/([a-zA-Z0-9-]+)\/participants$/.exec(path);
        const participantActionMatch =
          /^\/api\/admin\/hunts\/([a-zA-Z0-9-]+)\/participants\/actions$/.exec(
            path,
          );
        const taskMatch =
          /^\/api\/admin\/hunts\/([a-zA-Z0-9-]+)\/tasks\/([a-zA-Z0-9-]+)$/.exec(
            path,
          );
        const match =
          /^\/api\/admin\/hunts\/([a-zA-Z0-9-]+)(?:\/(tasks|contributors)(?:\/((?:browser:[a-f0-9]{64}|google-[a-f0-9]{64}|invite:[^/]+)))?)?$/.exec(
            path,
          );
        const roleMatch =
          /^\/api\/admin\/hunts\/([a-zA-Z0-9-]+)\/contributors\/(browser:[a-f0-9]{64}|google-[a-f0-9]{64})\/role$/.exec(
            path,
          );
        if (
          match ||
          taskMatch ||
          roleMatch ||
          exportMatch ||
          participantMatch ||
          participantActionMatch
        ) {
          const hunt = await hunts.get(
            match?.[1] ??
              taskMatch?.[1] ??
              roleMatch?.[1] ??
              exportMatch?.[1] ??
              participantMatch?.[1] ??
              participantActionMatch![1],
          );
          const requesterRole = await contributors.roleFor(
            hunt.id,
            creatorId,
            hunt.ownerId,
          );
          if (!requesterRole) {
            json(response, 403, {
              ok: false,
              code: "forbidden",
              message: "You do not have access to this hunt.",
            });
            return;
          }
          const canEdit =
            requesterRole === "owner" || requesterRole === "officer";
          const canManage = requesterRole === "owner";
          if (participantMatch && method === "GET") {
            if (!canEdit) {
              json(response, 403, {
                ok: false,
                code: "forbidden",
                message:
                  "Only Owners and Officers can view participant progress.",
              });
              return;
            }
            const [
              accounts,
              legacy,
              departedAccounts,
              departedLegacy,
              bannedAccounts,
              bannedLegacy,
            ] = await Promise.all([
              accountProgress.participants(hunt.id),
              progress.participants(hunt.id),
              accountProgress.departedParticipants(hunt.id),
              progress.departedParticipants(hunt.id),
              accountProgress.banned(hunt.id),
              progress.banned(hunt.id),
            ]);
            const completedByParticipant = new Map<string, Set<string>>();
            for (const participant of [...legacy, ...accounts]) {
              const completed =
                completedByParticipant.get(participant.playerId) ?? new Set();
              for (const taskId of participant.completedTaskIds)
                completed.add(taskId);
              completedByParticipant.set(participant.playerId, completed);
            }
            const departedByParticipant = new Map<string, Set<string>>();
            for (const participant of [
              ...departedLegacy,
              ...departedAccounts,
            ]) {
              if (completedByParticipant.has(participant.playerId)) continue;
              const completed =
                departedByParticipant.get(participant.playerId) ?? new Set();
              for (const taskId of participant.completedTaskIds)
                completed.add(taskId);
              departedByParticipant.set(participant.playerId, completed);
            }
            const tasks = [...hunt.tasks].sort(
              (left, right) => left.order - right.order,
            );
            let leftCompletedCount = 0;
            let leftIncompleteCount = 0;
            for (const completed of departedByParticipant.values()) {
              if (
                tasks.length > 0 &&
                tasks.every((task) => completed.has(task.id))
              )
                leftCompletedCount++;
              else leftIncompleteCount++;
            }
            const participants: HuntParticipantProgress[] = await Promise.all(
              [...completedByParticipant.entries()]
                .sort(([left], [right]) => left.localeCompare(right))
                .map(async ([participantId, completed]) => {
                  const displayName = participantId.startsWith("google-")
                    ? (await accountProfiles.get(participantId)).displayName
                    : null;
                  return {
                    participantId,
                    displayName,
                    tasks: tasks.map((task) => ({
                      id: task.id,
                      displayLabel: task.displayLabel,
                      completed: completed.has(task.id),
                    })),
                  };
                }),
            );
            const bannedParticipants: HuntBannedParticipant[] =
              await Promise.all(
                [...new Set([...bannedAccounts, ...bannedLegacy])]
                  .sort((left, right) => left.localeCompare(right))
                  .map(async (participantId) => ({
                    participantId,
                    displayName: participantId.startsWith("google-")
                      ? (await accountProfiles.get(participantId)).displayName
                      : null,
                  })),
              );
            json(response, 200, {
              ok: true,
              value: participants,
              bannedParticipants,
              summary: {
                activeCount: participants.length,
                leftCompletedCount,
                leftIncompleteCount,
              },
            });
            return;
          }
          if (participantActionMatch && method === "POST") {
            if (!canEdit) {
              json(response, 403, {
                ok: false,
                code: "forbidden",
                message: "Only Owners and Officers can manage participants.",
              });
              return;
            }
            const input = await body(request);
            const participantId =
              input && typeof input === "object"
                ? (input as Record<string, unknown>).participantId
                : undefined;
            const action =
              input && typeof input === "object"
                ? (input as Record<string, unknown>).action
                : undefined;
            if (
              participantId === creatorId &&
              (action === "kick" || action === "ban")
            )
              throw new StoreError(
                "forbidden",
                "You cannot kick or ban yourself from this hunt.",
              );
            if (
              typeof participantId !== "string" ||
              !/^[a-zA-Z0-9-]{1,100}$/.test(participantId) ||
              !["kick", "ban", "unban"].includes(String(action))
            )
              throw new StoreError(
                "validation",
                "Choose a valid participant and action.",
              );
            const participantAction = action as ParticipantAction;
            const stores = [accountProgress, progress];
            if (participantAction === "unban") {
              const [accountBans, legacyBans] = await Promise.all([
                accountProgress.banned(hunt.id),
                progress.banned(hunt.id),
              ]);
              if (![...accountBans, ...legacyBans].includes(participantId))
                throw new StoreError("not-found", "This player is not banned.");
              await Promise.all(
                stores.map((store) => store.unban(participantId, hunt.id)),
              );
              json(response, 200, { ok: true, value: { removed: true } });
              return;
            }
            if (participantId === creatorId)
              throw new StoreError(
                "forbidden",
                "You cannot kick or ban yourself from this hunt.",
              );
            const [accountParticipants, legacyParticipants] = await Promise.all(
              [
                accountProgress.participants(hunt.id),
                progress.participants(hunt.id),
              ],
            );
            const isActive = [
              ...accountParticipants,
              ...legacyParticipants,
            ].some((participant) => participant.playerId === participantId);
            if (!isActive)
              throw new StoreError(
                "not-found",
                "This player is no longer active in the hunt.",
              );
            await Promise.all(
              stores.map((store) =>
                participantAction === "ban"
                  ? store.ban(participantId, hunt.id)
                  : store.leave(participantId, hunt.id),
              ),
            );
            json(response, 200, { ok: true, value: { removed: true } });
            return;
          }
          if (exportMatch && method === "GET") {
            if (!canEdit) {
              json(response, 403, {
                ok: false,
                code: "forbidden",
                message: "Only Owners and Officers can export hunt results.",
              });
              return;
            }
            const [accounts, legacy] = await Promise.all([
              accountProgress.participants(hunt.id),
              progress.participants(hunt.id),
            ]);
            const participants = await Promise.all(
              accounts.map(async (player) => ({
                ...player,
                displayName: (await accountProfiles.get(player.playerId))
                  .displayName,
              })),
            );
            const results = buildHuntResults(hunt, [
              ...participants,
              ...legacy,
            ]);
            const format = exportMatch[2];
            const content =
              format === "pdf"
                ? Buffer.from(await resultsPdf(results))
                : Buffer.from(resultsCsv(results), "utf8");
            response.writeHead(200, {
              "Content-Type":
                format === "pdf"
                  ? "application/pdf"
                  : "text/csv; charset=utf-8",
              "Content-Disposition": `attachment; filename="hunt-${hunt.id}-results.${format}"`,
              "Content-Length": content.length,
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            });
            response.end(content);
            return;
          }
          if (match && !match[2] && method === "DELETE") {
            if (!canManage) {
              json(response, 403, {
                ok: false,
                code: "forbidden",
                message: "Only hunt owners can delete this hunt.",
              });
              return;
            }
            const input = await body(request);
            const confirmationName =
              input && typeof input === "object"
                ? (input as Record<string, unknown>).confirmationName
                : undefined;
            if (confirmationName !== hunt.name)
              throw new StoreError(
                "validation",
                "Enter the exact hunt name to confirm deletion.",
              );
            await Promise.all([
              contributors.removeHunt(hunt.id),
              issueReports.removeHunt(hunt.id),
              kahoot.removeHunt(hunt.id),
              progress.removeHunt(hunt.id),
              accountProgress.removeHunt(hunt.id),
            ]);
            await hunts.delete(hunt.id);
            json(response, 200, { ok: true, value: { deleted: true } });
            return;
          }
          if (
            hunt.huntType === "kahoot" &&
            ((taskMatch && (method === "PATCH" || method === "DELETE")) ||
              (match?.[2] === "tasks" && method === "POST")) &&
            (await kahoot.hasStarted(hunt.id))
          )
            throw new StoreError(
              "forbidden",
              "Questions cannot be changed after a Kahoot Hunt starts.",
            );
          if (taskMatch && method === "PATCH") {
            if (!canEdit) {
              json(response, 403, {
                ok: false,
                code: "forbidden",
                message: "Contributors have view-only access to hunt details.",
              });
              return;
            }
            json(response, 200, {
              ok: true,
              value: await (async () => {
                const input = await body(request);
                return serializeAdmission(hunt.id, async () => {
                  if (
                    hunt.huntType === "kahoot" &&
                    (await kahoot.hasStarted(hunt.id))
                  )
                    throw new StoreError(
                      "forbidden",
                      "Questions cannot be changed after a Kahoot Hunt starts.",
                    );
                  return hunts.updateTask(hunt.id, taskMatch[2], input);
                });
              })(),
            });
            return;
          }
          if (taskMatch && method === "DELETE") {
            if (!canEdit) {
              json(response, 403, {
                ok: false,
                code: "forbidden",
                message: "Contributors have view-only access to hunt details.",
              });
              return;
            }
            json(response, 200, {
              ok: true,
              value: await serializeAdmission(hunt.id, async () => {
                if (
                  hunt.huntType === "kahoot" &&
                  (await kahoot.hasStarted(hunt.id))
                )
                  throw new StoreError(
                    "forbidden",
                    "Questions cannot be changed after a Kahoot Hunt starts.",
                  );
                return hunts.deleteTask(hunt.id, taskMatch[2]);
              }),
            });
            return;
          }
          if (match && !match[2] && method === "PATCH") {
            if (!canEdit)
              throw new StoreError(
                "forbidden",
                "Only Owners and Officers can edit hunt settings.",
              );
            json(response, 200, {
              ok: true,
              value: await (async () => {
                const input = await body(request);
                return serializeAdmission(hunt.id, () =>
                  hunts.updateSettings(hunt.id, input),
                );
              })(),
            });
            return;
          }
          if (match && !match[2] && method === "GET") {
            const configuration = await hunts.getWithAccessCode(hunt.id);
            json(response, 200, {
              ok: true,
              value:
                requesterRole === "contributor"
                  ? {
                      ...configuration,
                      ownerId: "",
                      accessCode: null,
                      tasks: [],
                    }
                  : configuration,
            });
            return;
          }
          if (match && match[2] === "tasks" && !match[3] && method === "POST") {
            if (!canEdit) {
              json(response, 403, {
                ok: false,
                code: "forbidden",
                message: "Contributors have view-only access to hunt details.",
              });
              return;
            }
            json(response, 201, {
              ok: true,
              value: await (async () => {
                const input = await body(request);
                return serializeAdmission(hunt.id, async () => {
                  if (
                    hunt.huntType === "kahoot" &&
                    (await kahoot.hasStarted(hunt.id))
                  )
                    throw new StoreError(
                      "forbidden",
                      "Questions cannot be changed after a Kahoot Hunt starts.",
                    );
                  return hunts.addTask(hunt.id, input);
                });
              })(),
            });
            return;
          }
          if (match && match[2] === "contributors") {
            if (!canManage) {
              json(response, 403, {
                ok: false,
                code: "forbidden",
                message: "Only hunt owners can manage contributors.",
              });
              return;
            }
            if (method === "GET" && !match[3]) {
              json(response, 200, {
                ok: true,
                value: await contributorEntries(hunt.id, hunt.ownerId),
              });
              return;
            }
            if (method === "POST" && !match[3]) {
              const input = await body(request);
              const fields =
                input && typeof input === "object"
                  ? (input as Record<string, unknown>)
                  : {};
              if (typeof fields.email === "string") {
                if (
                  account?.email &&
                  fields.email.trim().toLowerCase() === account.email
                )
                  throw new StoreError(
                    "validation",
                    "You cannot invite your own account as a collaborator.",
                  );
                await contributors.invite(hunt.id, fields.email);
              } else {
                if (fields.creatorId === hunt.ownerId)
                  throw new StoreError(
                    "validation",
                    "The original hunt owner already has full access.",
                  );
                await contributors.add(hunt.id, fields.creatorId);
              }
              json(response, 200, {
                ok: true,
                value: await contributorEntries(hunt.id, hunt.ownerId),
              });
              return;
            }
            if (method === "DELETE" && match[3]) {
              if (match[3] === hunt.ownerId)
                throw new StoreError(
                  "forbidden",
                  "The original hunt owner cannot be removed.",
                );
              await contributors.remove(
                hunt.id,
                match[3],
                creatorId,
                hunt.ownerId,
              );
              json(response, 200, {
                ok: true,
                value: await contributorEntries(hunt.id, hunt.ownerId),
              });
              return;
            }
          }
          if (roleMatch && method === "PATCH") {
            if (!canManage) {
              json(response, 403, {
                ok: false,
                code: "forbidden",
                message: "Only hunt owners can change contributor roles.",
              });
              return;
            }
            const input = await body(request);
            const role =
              input && typeof input === "object"
                ? (input as Record<string, unknown>).role
                : undefined;
            await contributors.setRole(
              hunt.id,
              roleMatch[2],
              role,
              hunt.ownerId,
              creatorId,
            );
            json(response, 200, {
              ok: true,
              value: await contributorEntries(hunt.id, hunt.ownerId),
            });
            return;
          }
        }
      }
      const match =
        /^\/api\/player\/hunts\/([a-zA-Z0-9-]+)(?:\/tasks\/([a-zA-Z0-9-]+)\/answer)?$/.exec(
          path,
        );
      if (match) {
        if (
          (await hunts.get(match[1])).accessCode !== null ||
          (await hunts.get(match[1])).huntType === "kahoot"
        ) {
          json(response, 403, {
            ok: false,
            code: "forbidden",
            message:
              "Sign in with Google and join this hunt using its access code.",
          });
          return;
        }
        const cookies = request.headers.cookie ?? "";
        let player = /(?:^|;\s*)buchunt-player=([a-f0-9-]{36})(?:;|$)/.exec(
          cookies,
        )?.[1];
        if (!player) {
          player = randomUUID();
          response.setHeader(
            "Set-Cookie",
            `buchunt-player=${player}; Path=/api/player; HttpOnly; SameSite=Strict; Max-Age=31536000${request.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""}`,
          );
        }
        const hunt = await hunts.get(match[1]);
        if (await progress.isBanned(player, hunt.id)) {
          json(response, 403, {
            ok: false,
            code: "forbidden",
            message: "You are banned from this hunt.",
          });
          return;
        }
        if (
          hunt.maxParticipants != null ||
          hunt.participationClosed !== undefined
        ) {
          await serializeAdmission(hunt.id, async () => {
            const current = await hunts.get(hunt.id);
            await progress.join(player, hunt.id, {
              closed: current.participationClosed,
              maximum: current.maxParticipants,
              otherCount: (await accountProgress.participants(hunt.id)).length,
            });
          });
        }
        if (method === "POST" && match[2]) {
          const task = hunt.tasks.find((item) => item.id === match[2]);
          if (!task) throw new StoreError("not-found", "Task not found.");
          rejectFutureTask(
            hunt,
            task,
            await progress.completed(player, hunt.id),
          );
          const input = await body(request);
          const answer =
            input && typeof input === "object"
              ? (input as Record<string, unknown>).answer
              : undefined;
          if (typeof answer !== "string" || !answer.trim())
            throw new StoreError("validation", "Enter an answer.");
          if (task.taskType === "multiple-choice") {
            const completed = await evaluateChoice(
              progress,
              player,
              hunt.id,
              task,
              answer,
            );
            json(response, 200, { ok: true, value: { completed } });
            return;
          }
          const normalize = (text: string) =>
            task.answerCaseSensitive ? text.trim() : text.trim().toLowerCase();
          if (normalize(answer) !== normalize(task.requiredAnswer))
            throw new StoreError(
              "validation",
              "That answer did not match. Try again.",
            );
          await progress.complete(player, hunt.id, task.id);
          json(response, 200, { ok: true, value: { completed: true } });
          return;
        }
        if (method === "GET" && !match[2]) {
          const completed = await progress.completed(player, hunt.id);
          const incorrect = await progress.incorrect(player, hunt.id);
          json(response, 200, {
            ok: true,
            value: {
              id: hunt.id,
              name: hunt.name,
              organizationName: hunt.organizationName,
              huntType: hunt.huntType,
              description: hunt.description,
              beginsAt: hunt.beginsAt,
              endsAt: hunt.endsAt,
              status: hunt.status,
              tasks: availableTasks(hunt, completed).map((task) => ({
                id: task.id,
                huntId: hunt.id,
                displayLabel: task.displayLabel,
                description: task.description,
                hint: task.hint,
                location: task.location,
                completed: completed.includes(task.id),
                ...playerChoices(task, incorrect[task.id] ?? []),
              })),
            },
          });
          return;
        }
      }
      if (path.startsWith("/api/")) {
        json(response, 404, {
          ok: false,
          code: "not-found",
          message: "API route not found.",
        });
        return;
      }
      if (method !== "GET" && method !== "HEAD") {
        response.writeHead(405);
        response.end();
        return;
      }
      const target = resolve(
        staticDirectory,
        `.${path === "/" ? "/index.html" : path}`,
      );
      if (
        !target.startsWith(staticDirectory + sep) ||
        !mime[extname(target)] ||
        target.startsWith(resolve(staticDirectory, "ts") + sep) ||
        target.startsWith(resolve(staticDirectory, "js/server") + sep)
      ) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      try {
        const content = await readFile(target);
        response.writeHead(200, {
          "Content-Type": mime[extname(target)],
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-cache",
        });
        response.end(method === "HEAD" ? undefined : content);
      } catch {
        response.writeHead(404);
        response.end("Not found");
      }
    } catch (error) {
      const known = error instanceof StoreError;
      const code = known ? error.code : "storage";
      if (code === "storage")
        console.error(
          JSON.stringify({ requestId, event: "request-failed", code }),
        );
      json(
        response,
        code === "not-found"
          ? 404
          : code === "validation"
            ? 400
            : code === "forbidden"
              ? 403
              : 500,
        {
          ok: false,
          code,
          message: known
            ? error.message
            : "The operation could not be saved. Try again or contact the administrator.",
          ...(known && error.issues ? { issues: error.issues } : {}),
        },
      );
    }
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const host = process.env.HOST ?? "127.0.0.1";
  const app = createApplication({
    dataDirectory: process.env.DATA_DIRECTORY,
    originToken: process.env.ORIGIN_TOKEN,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
  });
  app.listen(Number(process.env.PORT ?? 3000), host, () =>
    console.log("BucHunt server ready"),
  );
}
