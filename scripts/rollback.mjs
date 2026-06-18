#!/usr/bin/env node
import { initDb } from "../dist/db.js";
import { rollbackPage, rollbackToSeed } from "../dist/rollback.js";

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error("usage: rollback.mjs <path> [edits-to-undo]");
  console.error("  pass 999 to reset to seed");
  process.exit(1);
}
const pagePath = args[0];
const editsToUndo = args[1] !== undefined ? Number.parseInt(args[1], 10) : 1;

if (Number.isNaN(editsToUndo)) {
  console.error("edits-to-undo must be a number");
  process.exit(1);
}

const dbPath = process.env["CANVAS_DATA_DIR"] ? `${process.env["CANVAS_DATA_DIR"]}/canvas.db` : "./data/canvas.db";
const db = initDb(dbPath);

try {
  if (editsToUndo === 999) {
    rollbackToSeed(db, pagePath);
    console.log(`reset ${pagePath} to seed`);
  } else {
    rollbackPage(db, pagePath, editsToUndo);
    console.log(`rolled back ${editsToUndo} edit(s) on ${pagePath}`);
  }
} finally {
  db.close();
}
