import { OAuth2Client } from "google-auth-library";
import type { HuntDefinition, PlayerHunt } from "../foundation/types.js";
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
import { PlayerProgressStore } from "./playerProgressStore.js";

interface ServerOptions {
  dataDirectory?: string;
  staticDirectory?: string;
  originToken?: string;
  googleClientId?: string;
  // Tests inject the identity verifier; production always uses Google's verifier.
  verifyPlayerToken?: (token: string) => Promise<string>;
}
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
export function createApplication(options: ServerOptions = {}) {
  const directory = resolve(options.dataDirectory ?? "data");
  const staticDirectory = resolve(options.staticDirectory ?? "src");
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
  async function playerHunt(
    player: string,
    hunt: HuntDefinition,
  ): Promise<PlayerHunt> {
    const completed = await accountProgress.completed(player, hunt.id);
    return {
      id: hunt.id,
      name: hunt.name,
      description: hunt.description,
      beginsAt: hunt.beginsAt,
      endsAt: hunt.endsAt,
      status: hunt.status,
      tasks: [...hunt.tasks]
        .sort((a, b) => a.order - b.order)
        .map((task) => ({
          id: task.id,
          huntId: hunt.id,
          displayLabel: task.displayLabel,
          description: task.description,
          location: task.location,
          completed: completed.includes(task.id),
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
          await accountProgress.join(player, hunt.id);
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
          if (method === "POST" && accountMatch[2]) {
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
            const input = await body(request);
            const answer =
              input && typeof input === "object"
                ? (input as Record<string, unknown>).answer
                : undefined;
            if (typeof answer !== "string" || !answer.trim())
              throw new StoreError("validation", "Enter an answer.");
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
        // Google identity will replace this temporary browser identity. The
        // opaque cookie is private; its public hash can safely identify owners.
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
        if (path === "/api/admin/session" && method === "GET") {
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
          json(response, 401, {
            ok: false,
            code: "unauthorized",
            message: "Open Hunt Studio to start your creator session.",
          });
          return;
        }
        const creatorId =
          "browser:" + createHash("sha256").update(secret).digest("hex");
        if (path === "/api/admin/hunts" && method === "POST") {
          json(response, 201, {
            ok: true,
            value: await hunts.create(await body(request), creatorId),
          });
          return;
        }
        if (path === "/api/admin/hunts" && method === "GET") {
          const membership = await contributors.all();
          const accessible = (await hunts.list()).filter(
            (hunt) =>
              hunt.ownerId === creatorId ||
              membership[hunt.id]?.includes(creatorId),
          );
          json(response, 200, {
            ok: true,
            value: accessible.map((hunt) => ({
              id: hunt.id,
              name: hunt.name,
              role: hunt.ownerId === creatorId ? "owner" : "contributor",
            })),
          });
          return;
        }
        const taskMatch =
          /^\/api\/admin\/hunts\/([a-zA-Z0-9-]+)\/tasks\/([a-zA-Z0-9-]+)$/.exec(
            path,
          );
        const match =
          /^\/api\/admin\/hunts\/([a-zA-Z0-9-]+)(?:\/(tasks|contributors)(?:\/(browser:[a-f0-9]{64}))?)?$/.exec(
            path,
          );
        if (match || taskMatch) {
          const hunt = await hunts.get(match?.[1] ?? taskMatch![1]);
          const owner = hunt.ownerId === creatorId;
          if (
            !owner &&
            !(await contributors.members(hunt.id)).includes(creatorId)
          ) {
            json(response, 403, {
              ok: false,
              code: "unauthorized",
              message:
                "Only this hunt's owner and contributors can access its configuration.",
            });
            return;
          }
          if (taskMatch && method === "PATCH") {
            json(response, 200, {
              ok: true,
              value: await hunts.updateTask(
                hunt.id,
                taskMatch[2],
                await body(request),
              ),
            });
            return;
          }
          if (taskMatch && method === "DELETE") {
            json(response, 200, {
              ok: true,
              value: await hunts.deleteTask(hunt.id, taskMatch[2]),
            });
            return;
          }
          if (match && !match[2] && method === "GET") {
            json(response, 200, {
              ok: true,
              value: await hunts.getWithAccessCode(hunt.id),
            });
            return;
          }
          if (match && match[2] === "tasks" && !match[3] && method === "POST") {
            json(response, 201, {
              ok: true,
              value: await hunts.addTask(hunt.id, await body(request)),
            });
            return;
          }
          if (match && match[2] === "contributors") {
            if (!owner) {
              json(response, 403, {
                ok: false,
                code: "unauthorized",
                message: "Only the hunt owner can manage contributors.",
              });
              return;
            }
            if (method === "GET" && !match[3]) {
              json(response, 200, {
                ok: true,
                value: await contributors.members(hunt.id),
              });
              return;
            }
            if (method === "POST" && !match[3]) {
              const input = await body(request);
              const id =
                input && typeof input === "object"
                  ? (input as Record<string, unknown>).creatorId
                  : undefined;
              await contributors.add(hunt.id, id);
              json(response, 200, {
                ok: true,
                value: await contributors.members(hunt.id),
              });
              return;
            }
            if (method === "DELETE" && match[3]) {
              await contributors.remove(hunt.id, match[3]);
              json(response, 200, {
                ok: true,
                value: await contributors.members(hunt.id),
              });
              return;
            }
          }
        }
      }
      const match =
        /^\/api\/player\/hunts\/([a-zA-Z0-9-]+)(?:\/tasks\/([a-zA-Z0-9-]+)\/answer)?$/.exec(
          path,
        );
      if (match) {
        if ((await hunts.get(match[1])).accessCode !== null) {
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
        if (method === "POST" && match[2]) {
          const task = hunt.tasks.find((item) => item.id === match[2]);
          if (!task) throw new StoreError("not-found", "Task not found.");
          const input = await body(request);
          const answer =
            input && typeof input === "object"
              ? (input as Record<string, unknown>).answer
              : undefined;
          if (typeof answer !== "string" || !answer.trim())
            throw new StoreError("validation", "Enter an answer.");
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
          json(response, 200, {
            ok: true,
            value: {
              id: hunt.id,
              name: hunt.name,
              description: hunt.description,
              beginsAt: hunt.beginsAt,
              endsAt: hunt.endsAt,
              status: hunt.status,
              tasks: [...hunt.tasks]
                .sort((a, b) => a.order - b.order)
                .map((task) => ({
                  id: task.id,
                  huntId: hunt.id,
                  displayLabel: task.displayLabel,
                  description: task.description,
                  location: task.location,
                  completed: completed.includes(task.id),
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
        code === "not-found" ? 404 : code === "validation" ? 400 : 500,
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
