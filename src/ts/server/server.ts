import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { HuntStore, StoreError } from "./huntStore.js";
import { PlayerProgressStore } from "./playerProgressStore.js";

interface ServerOptions {
  dataDirectory?: string;
  staticDirectory?: string;
  adminToken: string;
  ownerId?: string;
  originToken?: string;
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
export function createApplication(options: ServerOptions) {
  if (options.adminToken.length < 16)
    throw new Error("ADMIN_TOKEN must contain at least 16 characters.");
  const directory = resolve(options.dataDirectory ?? "data");
  const staticDirectory = resolve(options.staticDirectory ?? "src");
  const hunts = new HuntStore(resolve(directory, "hunts.json"));
  const progress = new PlayerProgressStore(
    resolve(directory, "player-progress.json"),
  );
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
      if (path.startsWith("/api/admin/")) {
        const provided = Buffer.from(
          request.headers.authorization?.replace(/^Bearer /, "") ?? "",
        );
        const expected = Buffer.from(options.adminToken);
        if (
          provided.length !== expected.length ||
          !timingSafeEqual(provided, expected)
        ) {
          json(response, 401, {
            ok: false,
            code: "unauthorized",
            message: "Enter a valid administrator API token.",
          });
          return;
        }
        // Browser writes must be same-origin. Tokens are never sent in URLs.
        const origin = request.headers.origin;
        if (origin && new URL(origin).host !== request.headers.host) {
          json(response, 403, {
            ok: false,
            code: "unauthorized",
            message: "Cross-origin writes are not allowed.",
          });
          return;
        }
        if (path === "/api/admin/hunts" && method === "POST") {
          json(response, 201, {
            ok: true,
            value: await hunts.create(
              await body(request),
              options.ownerId ?? "sprint-admin",
            ),
          });
          return;
        }
        const match = /^\/api\/admin\/hunts\/([a-zA-Z0-9-]+)(\/tasks)?$/.exec(
          path,
        );
        if (match && !match[2] && method === "GET") {
          json(response, 200, { ok: true, value: await hunts.get(match[1]) });
          return;
        }
        if (match && match[2] && method === "POST") {
          json(response, 201, {
            ok: true,
            value: await hunts.addTask(match[1], await body(request)),
          });
          return;
        }
      }
      const match =
        /^\/api\/player\/hunts\/([a-zA-Z0-9-]+)(?:\/tasks\/([a-zA-Z0-9-]+)\/answer)?$/.exec(
          path,
        );
      if (match) {
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
  const token =
    process.env.ADMIN_TOKEN ??
    (host === "127.0.0.1" ? "local-development-only" : "");
  const app = createApplication({
    adminToken: token,
    dataDirectory: process.env.DATA_DIRECTORY,
    ownerId: process.env.ADMIN_OWNER_ID,
    originToken: process.env.ORIGIN_TOKEN,
  });
  app.listen(Number(process.env.PORT ?? 3000), host, () =>
    console.log("BucHunt server ready"),
  );
}
