import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { initDb, type Database } from "./db.js";
import { getPageByPath, listPages } from "./pages.js";
import { listRecentEdits, listRecentEditsForPage } from "./edits.js";
import { injectPaperCss, injectWidgetScript, SECURITY_HEADERS } from "./seed.js";
import { ensureSeed } from "./seedInit.js";
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

  fastify.get("/api/state", async (request) => {
    const query = request.query as { path?: string };
    if (typeof query.path === "string" && query.path !== "") {
      const page = getPageByPath(db, query.path);
      if (page === null) {
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
    if (
      result.reason === "empty message" ||
      result.reason === "message too long (>500 chars)" ||
      result.reason.startsWith("invalid path")
    ) {
      reply.code(400);
      return result;
    }
    if (result.reason === "cooldown active") {
      reply.code(429);
      return result;
    }
    reply.code(422);
    return result;
  });

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
  const html = injectWidgetScript(injectPaperCss(page.current_html));
  for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
    reply.header(header, value);
  }
  reply.type("text/html; charset=utf-8");
  return html;
}
