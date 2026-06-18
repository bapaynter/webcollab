export const MAX_PAGE_DEPTH = 4;
export const RESERVED_PATHS: ReadonlySet<string> = new Set(["/log"]);

const PATH_PATTERN = /^\/([a-z0-9]+(-[a-z0-9]+)*)(\/[a-z0-9]+(-[a-z0-9]+)*)*$/;

export type PolicyResult = { ok: true } | { ok: false; reason: string };

export function checkDepth(path: string): PolicyResult {
  const segments = countSegments(path);
  if (segments > MAX_PAGE_DEPTH) {
    return { ok: false, reason: `depth cap exceeded: ${path} has ${segments} segments (max ${MAX_PAGE_DEPTH})` };
  }
  return { ok: true };
}

export function validatePathFormat(path: string): PolicyResult {
  if (path === "") {
    return { ok: false, reason: "empty path" };
  }
  if (RESERVED_PATHS.has(path)) {
    return { ok: false, reason: `path is reserved (read-only): ${path}` };
  }
  if (path !== "/" && !PATH_PATTERN.test(path)) {
    return { ok: false, reason: `invalid path format: ${path}` };
  }
  if (path !== "/" && path.endsWith("/")) {
    return { ok: false, reason: "trailing slash not allowed" };
  }
  if (path.includes("//")) {
    return { ok: false, reason: "consecutive slashes not allowed" };
  }
  return { ok: true };
}

export function countSegments(path: string): number {
  if (path === "/") {
    return 0;
  }
  return path.slice(1).split("/").length;
}
