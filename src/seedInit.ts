import type { Database } from "./db.js";
import { createPage, pageExists } from "./pages.js";
import { SEED_ROOT_HTML } from "./seed.js";

export function ensureSeed(db: Database, path: string): void {
  if (pageExists(db, path)) {
    return;
  }
  createPage(db, path, SEED_ROOT_HTML);
}
