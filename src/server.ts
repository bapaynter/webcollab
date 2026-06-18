import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { initDb, type Database } from "./db.js";
import { getPageByPath, listPages } from "./pages.js";
import { listRecentEdits, listRecentEditsForPage } from "./edits.js";
import { injectWidgetScript, SECURITY_HEADERS } from "./seed.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");

export interface ServerOptions {
  readonly dbPath: string;
}

export interface ServerHandle {
  readonly fastify: FastifyInstance;
  readonly db: Database;
  readonly close: () => Promise<void>;
}

export interface BroadcastEvent {
  readonly type: "edit";
  readonly path: string;
  readonly version: number;
  readonly summary: string;
}

export function buildServer(options: ServerOptions): ServerHandle {
  const db = initDb(options.dbPath);
  const fastify = Fastify({ logger: false });
  void fastify.register(websocket);

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

  fastify.get<{ Params: { path: string } }>("/:path", async (request, reply) => {
    const requested = request.params.path;
    const pagePath = requested === "" ? "/" : `/${requested}`;
    const page = getPageByPath(db, pagePath);
    if (page === null) {
      reply.code(404);
      reply.type("text/plain");
      return "Not Found";
    }
    const html = injectWidgetScript(page.current_html);
    for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
      reply.header(header, value);
    }
    reply.type("text/html; charset=utf-8");
    return html;
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

  return {
    fastify,
    db,
    async close() {
      await fastify.close();
      db.close();
    },
  };
}

export async function readPublicFile(name: string): Promise<string> {
  return readFile(join(PUBLIC_DIR, name), "utf-8");
}
