import { parse } from "parse5";

export type LinkGuardResult = { ok: true } | { ok: false; reason: string };

export function verify(parentHtml: string, parentPath: string, newPath: string): LinkGuardResult {
  const document = parse(parentHtml) as unknown as Record<string, unknown>;
  const target = normalize(newPath);
  const found = findAnchorToPath(document, parentPath, target);
  if (!found) {
    return { ok: false, reason: `no anchor to ${newPath} found in parent` };
  }
  return { ok: true };
}

function normalize(path: string): string {
  if (path.startsWith("/")) {
    return path;
  }
  return `/${path}`;
}

function findAnchorToPath(node: Record<string, unknown>, parentPath: string, target: string): boolean {
  const childNodes = (node as { childNodes?: unknown[] }).childNodes;
  if (Array.isArray(childNodes)) {
    for (const child of childNodes) {
      if (findAnchorToPath(child as Record<string, unknown>, parentPath, target)) {
        return true;
      }
    }
  }
  const nodeName = (node as { nodeName?: string }).nodeName;
  if (nodeName !== "a") {
    return false;
  }
  const attrs = (node as { attrs?: Array<{ name: string; value: string }> }).attrs ?? [];
  for (const attr of attrs) {
    if (attr.name !== "href") {
      continue;
    }
    const href = attr.value.trim();
    if (href === "") {
      continue;
    }
    if (href === target) {
      return true;
    }
    if (!href.startsWith("/") && !href.startsWith("http") && !href.includes(":")) {
      const resolved = resolveRelative(parentPath, href);
      if (resolved === target) {
        return true;
      }
    }
  }
  return false;
}

function resolveRelative(parentPath: string, href: string): string {
  if (parentPath === "/") {
    return `/${href}`;
  }
  return `${parentPath}/${href}`;
}
