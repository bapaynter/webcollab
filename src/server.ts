import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { initDb, type Database } from "./db.js";

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
  return {
    fastify,
    db,
    async close() {
      await fastify.close();
      db.close();
    },
  };
}
