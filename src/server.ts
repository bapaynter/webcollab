import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { initDb, type Database } from "./db.js";
import { getPageByPath, listPages } from "./pages.js";
import { listRecentEdits, listRecentEditsForPage } from "./edits.js";
import { rollbackPage, rollbackToSeed } from "./rollback.js";
import { injectBodyMargin, injectPaperCss, injectWidgetScript, SECURITY_HEADERS } from "./seed.js";
import { ensureSeed } from "./seedInit.js";
import { renderLogPage } from "./logPage.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { callChat, type CallOptions } from "./llm.js";
import { runSuggest, type SuggestDeps } from "./suggest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");

export interface ServerOptions {
  readonly dbPath: string;
  readonly apiKey?: string;
  readonly validatorModel?: string;
  readonly executorModel?: string;
  readonly maxEditDelta?: number;
  readonly cooldownMinutes?: number;
  readonly ipHashSalt?: string;
  readonly maxPageDepth?: number;
  readonly rateLimitEnabled?: boolean;
  readonly callLLM?: (options: CallOptions) => Promise<string>;
  readonly callExecutor?: (options: CallOptions) => Promise<string>;
}

export interface ServerHandle {
  readonly fastify: FastifyInstance;
  readonly db: Database;
  readonly close: () => Promise<void>;
  readonly broadcast: (event: { type: "edit"; path: string; version: number; summary: string }) => void;
}

export interface BroadcastEvent {
  readonly type: "edit";
  readonly path: string;
  readonly version: number;
  readonly summary: string;
}

interface SuggestRejectedResult {
  readonly status: "rejected";
  readonly reason: string;
  readonly until?: string;
}

interface SuggestErrorPayload {
  readonly status: "rejected";
  readonly reason: string;
  readonly until?: string;
  readonly code: string;
  readonly user_message: string;
  readonly hint?: string;
  readonly retryable: boolean;
  readonly retry_after_seconds?: number;
}

export function buildServer(options: ServerOptions): ServerHandle {
  const db = initDb(options.dbPath);
  ensureSeed(db, "/");
  const fastify = Fastify({ logger: true });
  void fastify.register(websocket);

  const wsClients = new Set<unknown>();
  const broadcast: ServerHandle["broadcast"] = (event) => {
    const json = JSON.stringify(event);
    for (const client of wsClients) {
      const c = client as { send?: (data: string) => void; readyState?: number };
      if (typeof c.send === "function" && c.readyState === 1) {
        c.send(json);
      }
    }
  };
  void broadcast;

  const callLLM = options.callLLM ?? ((opts) => callChat(opts));
  const callExecutor = options.callExecutor ?? ((opts) => callChat(opts));

  const suggestDeps: SuggestDeps = {
    db,
    apiKey: options.apiKey ?? "test-key",
    validatorModel: options.validatorModel ?? "test-model",
    executorModel: options.executorModel ?? "test-model",
    maxEditDelta: options.maxEditDelta ?? 20,
    cooldownMinutes: options.cooldownMinutes ?? 60,
    ipHashSalt: options.ipHashSalt ?? "a".repeat(64),
    maxPageDepth: options.maxPageDepth ?? 4,
    rateLimitEnabled: options.rateLimitEnabled ?? false,
    callLLM,
    callExecutor,
    broadcast,
  };

  fastify.get("/healthz", async () => ({ status: "ok" }));

  fastify.get("/paper.min.css", async (_request, reply) => {
    const css = await readPublicFile("paper.min.css");
    reply.type("text/css; charset=utf-8");
    reply.header("Cache-Control", "public, max-age=3600");
    return css;
  });

  fastify.get("/widget.js", async (_request, reply) => {
    const js = await readPublicFile("widget.js");
    reply.type("application/javascript; charset=utf-8");
    reply.header("Cache-Control", "no-cache");
    return js;
  });

  fastify.get("/api/state", async (request, reply) => {
    const query = request.query as { path?: string };
    if (typeof query.path === "string" && query.path !== "") {
      const page = getPageByPath(db, query.path);
      if (page === null) {
        reply.code(404);
        return { error: "not found" };
      }
      return {
        path: page.path,
        version: page.version,
        updated_at: page.updated_at,
        recent_edits: listRecentEditsForPage(db, page.id, 10),
      };
    }
    return {
      pages: listPages(db).map((p) => ({ path: p.path, version: p.version, updated_at: p.updated_at })),
      recent_edits: listRecentEdits(db, 10),
    };
  });

  fastify.get("/api/page", async (request, reply) => {
    const query = request.query as { path?: string };
    if (typeof query.path !== "string" || query.path === "") {
      reply.code(400);
      return { error: "path required" };
    }
    const page = getPageByPath(db, query.path);
    if (page === null) {
      reply.code(404);
      return { error: "not found" };
    }
    return {
      path: page.path,
      version: page.version,
      updated_at: page.updated_at,
      html: page.current_html,
    };
  });

  fastify.post<{ Body: { message?: string; path?: string } }>("/api/suggest", async (request, reply) => {
    const body = request.body ?? {};
    const ip = request.ip;
    const result = await runSuggest(suggestDeps, {
      message: body.message ?? "",
      path: body.path,
      ip,
    });
    if (result.status === "accepted") {
      return result;
    }
    const payload = buildSuggestErrorPayload(result);
    if (
      result.reason === "empty message" ||
      result.reason === "message too long (>500 chars)" ||
      result.reason.startsWith("invalid path")
    ) {
      reply.code(400);
      return payload;
    }
    if (result.reason === "cooldown active") {
      reply.code(429);
      return payload;
    }
    reply.code(422);
    return payload;
  });

  fastify.post<{ Body: { path?: string; versions?: number; toSeed?: boolean } }>(
    "/api/rollback",
    async (request, reply) => {
      const body = request.body ?? {};
      const adminToken = process.env["CANVAS_ADMIN_TOKEN"];
      if (typeof adminToken === "string" && adminToken.length > 0) {
        const auth = request.headers.authorization ?? "";
        const presented = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
        if (presented !== adminToken) {
          reply.code(401);
          return { error: "unauthorized" };
        }
      }
      const pagePath = body.path ?? "";
      if (pagePath === "") {
        reply.code(400);
        return { error: "path required" };
      }
      const page = getPageByPath(db, pagePath);
      if (page === null) {
        reply.code(404);
        return { error: "page not found" };
      }
      try {
        if (body.toSeed === true) {
          rollbackToSeed(db, pagePath);
        } else {
          const editsToUndo = parseRollbackVersions(body.versions);
          if (editsToUndo === null) {
            reply.code(400);
            return { error: "versions must be a positive integer" };
          }
          rollbackPage(db, pagePath, editsToUndo);
        }
      } catch (err) {
        reply.code(422);
        return { error: (err as Error).message };
      }
      const after = getPageByPath(db, pagePath);
      if (after !== null) {
        broadcast({ type: "edit", path: pagePath, version: after.version, summary: "rollback" });
      }
      return { status: "ok", path: pagePath, version: after?.version ?? null };
    },
  );

  fastify.register(async (scope) => {
    scope.get("/ws", { websocket: true }, (socket, _request) => {
      void _request;
      wsClients.add(socket as unknown as { send: (d: string) => void; readyState?: number });
      (socket as unknown as { on: (e: string, fn: () => void) => void }).on("close", () => {
        wsClients.delete(socket);
      });
    });
  });

  fastify.get("/", async (_request, reply) => {
    return await servePage(db, "/", reply);
  });

  fastify.get("/log", async (_request, reply) => {
    for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
      reply.header(header, value);
    }
    reply.type("text/html; charset=utf-8");
    return renderLogPage(db);
  });

  fastify.get<{ Params: { "*": string } }>("/*", async (request, reply) => {
    const requested = request.params["*"];
    const pagePath = requested === undefined || requested === "" ? "/" : `/${requested}`;
    return await servePage(db, pagePath, reply);
  });

  return {
    fastify,
    db,
    broadcast,
    async close() {
      await fastify.close();
      db.close();
    },
  };
}

function buildSuggestErrorPayload(rejected: SuggestRejectedResult): SuggestErrorPayload {
  const base = {
    status: "rejected" as const,
    reason: rejected.reason,
    until: rejected.until,
  };

  if (rejected.reason === "empty message") {
    return {
      ...base,
      code: "EMPTY_MESSAGE",
      user_message: "Message is empty.",
      hint: "Type what you want to change, then send.",
      retryable: false,
    };
  }

  if (rejected.reason === "message too long (>500 chars)") {
    return {
      ...base,
      code: "MESSAGE_TOO_LONG",
      user_message: "Message is too long.",
      hint: "Keep request under 500 characters.",
      retryable: false,
    };
  }

  if (rejected.reason.startsWith("invalid path")) {
    return {
      ...base,
      code: "INVALID_PATH",
      user_message: "This page path cannot be edited.",
      hint: "Try editing a normal page path like / or /foo.",
      retryable: false,
    };
  }

  if (rejected.reason === "cooldown active") {
    const retryAfterSeconds = computeRetryAfterSeconds(rejected.until);
    return {
      ...base,
      code: "COOLDOWN_ACTIVE",
      user_message: "Too many requests right now.",
      hint: "Wait for cooldown, then try again.",
      retryable: true,
      retry_after_seconds: retryAfterSeconds,
    };
  }

  if (rejected.reason === "blocked by content policy") {
    return {
      ...base,
      code: "BLOCKED_BY_POLICY",
      user_message: "Request blocked by safety policy.",
      hint: "Remove script-like or unsafe instructions and retry.",
      retryable: false,
    };
  }

  if (rejected.reason === "page not found") {
    return {
      ...base,
      code: "PAGE_NOT_FOUND",
      user_message: "Page not found.",
      hint: "Open an existing page path and try again.",
      retryable: false,
    };
  }

  if (rejected.reason === "path already exists") {
    return {
      ...base,
      code: "PATH_ALREADY_EXISTS",
      user_message: "That page path already exists.",
      hint: "Try a different page name.",
      retryable: false,
    };
  }

  if (rejected.reason.startsWith("depth cap exceeded")) {
    return {
      ...base,
      code: "DEPTH_CAP_EXCEEDED",
      user_message: "That path is too deep.",
      hint: "Create the new page closer to the site root.",
      retryable: false,
    };
  }

  if (rejected.reason.startsWith("could not determine new page path")) {
    return {
      ...base,
      code: "NEW_PAGE_PATH_UNCLEAR",
      user_message: "Could not determine new page path.",
      hint: "Name the page directly, like 'create page /gallery'.",
      retryable: false,
    };
  }

  if (rejected.reason.startsWith("patch conflict:")) {
    return {
      ...base,
      code: "PATCH_CONFLICT",
      user_message: "Page changed before edit could be applied.",
      hint: "Refresh page and retry the request.",
      retryable: true,
    };
  }

  if (rejected.reason === "validator unavailable" || rejected.reason === "executor unavailable") {
    return {
      ...base,
      code: "UPSTREAM_UNAVAILABLE",
      user_message: "Edit service is temporarily unavailable.",
      hint: "Try again in a moment.",
      retryable: true,
    };
  }

  if (rejected.reason === "validator returned malformed response" || rejected.reason === "executor returned malformed response") {
    return {
      ...base,
      code: "UPSTREAM_MALFORMED_RESPONSE",
      user_message: "Edit service returned invalid output.",
      hint: "Try again shortly.",
      retryable: true,
    };
  }

  if (rejected.reason === "executor returned CREATE payload for EDIT request") {
    return {
      ...base,
      code: "EXECUTOR_MODE_MISMATCH",
      user_message: "Edit output format was invalid.",
      hint: "Try the request again.",
      retryable: true,
    };
  }

  if (rejected.reason === "executor returned non-HTML content") {
    return {
      ...base,
      code: "EXECUTOR_NON_HTML",
      user_message: "Edit output was not valid HTML.",
      hint: "Try a smaller, clearer request.",
      retryable: true,
    };
  }

  if (rejected.reason.startsWith("edit adds ")) {
    return {
      ...base,
      code: "EDIT_TOO_LARGE",
      user_message: "Requested edit is too large.",
      hint: "Split change into smaller steps.",
      retryable: false,
    };
  }

  if (rejected.reason === "edit would leave page with no content") {
    return {
      ...base,
      code: "EDIT_WOULD_EMPTY_PAGE",
      user_message: "Edit would remove all page content.",
      hint: "Keep at least one visible element in the page body.",
      retryable: false,
    };
  }

  if (rejected.reason.includes("no anchor to ")) {
    return {
      ...base,
      code: "MISSING_LINK_TO_NEW_PAGE",
      user_message: "New page must be linked from current page.",
      hint: "Include a link to the new page in the same request.",
      retryable: false,
    };
  }

  if (isClassifierRejectReason(rejected.reason)) {
    return {
      ...base,
      code: "VALIDATOR_REJECTED",
      user_message: "Request rejected by classifier.",
      hint: rejected.reason,
      retryable: false,
    };
  }

  if (
    rejected.reason.startsWith("internal:") ||
    rejected.reason.startsWith("commit failed:") ||
    rejected.reason === "parent page not found"
  ) {
    return {
      ...base,
      code: "INTERNAL_ERROR",
      user_message: "Server failed to apply edit.",
      hint: "Try again in a moment.",
      retryable: true,
    };
  }

  return {
    ...base,
    code: "REQUEST_REJECTED",
    user_message: "Edit request was rejected.",
    hint: "Try a smaller or clearer request.",
    retryable: false,
  };
}

function isClassifierRejectReason(reason: string): boolean {
  if (reason === "empty message") {
    return false;
  }
  if (reason === "message too long (>500 chars)") {
    return false;
  }
  if (reason.startsWith("invalid path")) {
    return false;
  }
  if (reason === "cooldown active") {
    return false;
  }
  if (reason === "blocked by content policy") {
    return false;
  }
  if (reason === "page not found") {
    return false;
  }
  if (reason === "path already exists") {
    return false;
  }
  if (reason.startsWith("depth cap exceeded")) {
    return false;
  }
  if (reason.startsWith("could not determine new page path")) {
    return false;
  }
  if (reason.startsWith("patch conflict:")) {
    return false;
  }
  if (reason === "validator unavailable" || reason === "executor unavailable") {
    return false;
  }
  if (reason === "validator returned malformed response" || reason === "executor returned malformed response") {
    return false;
  }
  if (reason === "executor returned CREATE payload for EDIT request") {
    return false;
  }
  if (reason === "executor returned non-HTML content") {
    return false;
  }
  if (reason.startsWith("edit adds ")) {
    return false;
  }
  if (reason === "edit would leave page with no content") {
    return false;
  }
  if (reason.includes("no anchor to ")) {
    return false;
  }
  if (reason.startsWith("internal:") || reason.startsWith("commit failed:") || reason === "parent page not found") {
    return false;
  }
  return true;
}

function computeRetryAfterSeconds(until?: string): number | undefined {
  if (until === undefined || until === "") {
    return undefined;
  }
  const untilMs = Date.parse(until);
  if (Number.isNaN(untilMs)) {
    return undefined;
  }
  const remainingMs = untilMs - Date.now();
  if (remainingMs <= 0) {
    return 0;
  }
  return Math.ceil(remainingMs / 1000);
}

function parseRollbackVersions(value: unknown): number | null {
  if (value === undefined) {
    return 1;
  }
  if (typeof value !== "number") {
    return null;
  }
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

export async function readPublicFile(name: string): Promise<string> {
  return readFile(join(PUBLIC_DIR, name), "utf-8");
}

async function servePage(
  db: Database,
  pagePath: string,
  reply: import("fastify").FastifyReply,
): Promise<string> {
  const page = getPageByPath(db, pagePath);
  if (page === null) {
    reply.code(404);
    reply.type("text/plain");
    return "Not Found";
  }
  const html = injectWidgetScript(injectPaperCss(injectBodyMargin(page.current_html)));
  for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
    reply.header(header, value);
  }
  reply.type("text/html; charset=utf-8");
  return html;
}
