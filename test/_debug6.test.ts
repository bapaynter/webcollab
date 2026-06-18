import { it } from "node:test";
import { sanitizeHTML } from "../src/sanitize.js";

void it("debug sanitize", () => {
  const out = sanitizeHTML('<!DOCTYPE html><html><body><a href="/foo/gallery">Gallery</a></body></html>');
  console.log("SANITIZER OUT:", JSON.stringify(out));
});
