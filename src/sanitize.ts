import DOMPurify from "isomorphic-dompurify";

export const MAX_ELEMENTS_ADDED = 50;
export const MIN_BODY_CHILDREN = 1;
export const MAX_CANVAS_SIZE_PX = 1024;

const ALLOWED_TAGS: ReadonlyArray<string> = [
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "span", "div", "section", "article", "main", "header", "footer", "nav", "aside",
  "ul", "ol", "li",
  "a", "img", "figure", "figcaption",
  "canvas",
  "blockquote", "pre", "code", "em", "strong", "b", "i", "u", "br", "hr",
  "table", "thead", "tbody", "tr", "th", "td",
  "head", "title", "meta", "link",
];

const ALLOWED_ATTR: ReadonlyArray<string> = [
  "href", "src", "alt", "title", "class", "id", "style",
  "width", "height",
  "aria-label", "aria-describedby", "aria-hidden", "role",
  "colspan", "rowspan",
  "charset", "name", "content", "rel", "media", "type", "sizes",
];

const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto):|#|\/)/i;
const DATA_TEXT_HTML_PATTERN = /(<(?:a|img|source|video|audio|iframe)[^>]*?\s(?:href|src)\s*=\s*["']?)\s*data:text\/html[^"' >]*/gi;
const STYLE_ATTR_PATTERN = /(<[^>]*?\sstyle\s*=\s*["'])([^"']*)(["'][^>]*>)/gi;
const DANGEROUS_STYLE_TOKENS = /(?:javascript\s*:|expression\s*\(|@import|behavior\s*:|-moz-binding\s*:|-webkit-binding\s*:|url\s*\(\s*["']?\s*javascript\s*:)/gi;

function sanitizeStyleValues(html: string): string {
  return html.replace(STYLE_ATTR_PATTERN, (_match, prefix: string, value: string, suffix: string) => {
    const cleaned = value.replace(DANGEROUS_STYLE_TOKENS, "");
    return prefix + cleaned + suffix;
  });
}

function enforceCanvasCaps(html: string): string {
  return html.replace(/<canvas\b([^>]*)>/gi, (_match: string, attrs: string) => {
    let nextAttrs = attrs;
    nextAttrs = upsertCanvasDimension(nextAttrs, "width");
    nextAttrs = upsertCanvasDimension(nextAttrs, "height");
    nextAttrs = upsertCanvasStyle(nextAttrs);
    return `<canvas${nextAttrs}>`;
  });
}

function upsertCanvasDimension(attrs: string, name: "width" | "height"): string {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(["'])([^"']*)\\1|\\b${name}\\s*=\\s*([^\\s>]+)`, "i");
  const match = attrs.match(pattern);
  if (match === null) {
    return attrs;
  }
  const raw = (match[2] ?? match[3] ?? "").trim();
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= MAX_CANVAS_SIZE_PX) {
    return attrs;
  }
  const replacement = `${name}="${MAX_CANVAS_SIZE_PX}"`;
  return attrs.replace(pattern, replacement);
}

function upsertCanvasStyle(attrs: string): string {
  const styleMatch = attrs.match(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i);
  const existingStyle = styleMatch?.[2] ?? "";
  const normalized = normalizeCanvasStyle(existingStyle);
  const serialized = normalized.join(";");
  if (styleMatch === null) {
    return `${attrs} style="${serialized}"`;
  }
  return attrs.replace(/\bstyle\s*=\s*(["'])[\s\S]*?\1/i, `style="${serialized}"`);
}

function normalizeCanvasStyle(style: string): string[] {
  const map = new Map<string, string>();
  const declarations = style
    .split(";")
    .map((part: string) => part.trim())
    .filter((part: string) => part !== "");

  for (const declaration of declarations) {
    const index = declaration.indexOf(":");
    if (index <= 0) {
      continue;
    }
    const property = declaration.slice(0, index).trim().toLowerCase();
    const value = declaration.slice(index + 1).trim();
    if (value === "") {
      continue;
    }
    if (property === "width" || property === "height" || property === "max-width" || property === "max-height") {
      map.set(property, capSizeValue(value));
      continue;
    }
    map.set(property, value);
  }

  map.set("max-width", `${MAX_CANVAS_SIZE_PX}px`);
  map.set("max-height", `${MAX_CANVAS_SIZE_PX}px`);

  return Array.from(map.entries()).map(([property, value]) => `${property}:${value}`);
}

function capSizeValue(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const pxMatch = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)px$/);
  if (pxMatch !== null) {
    const parsed = Number.parseFloat(pxMatch[1] ?? "0");
    if (parsed > MAX_CANVAS_SIZE_PX) {
      return `${MAX_CANVAS_SIZE_PX}px`;
    }
    return `${parsed}px`;
  }

  const unitlessMatch = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)$/);
  if (unitlessMatch !== null) {
    const parsed = Number.parseFloat(unitlessMatch[1] ?? "0");
    if (parsed > MAX_CANVAS_SIZE_PX) {
      return `${MAX_CANVAS_SIZE_PX}px`;
    }
    return `${parsed}px`;
  }

  return value;
}

const DOCTYPE_TAG = "<!DOCTYPE html>";

export function sanitizeHTML(html: string): string {
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [...ALLOWED_ATTR],
    ALLOWED_URI_REGEXP,
    ADD_URI_SAFE_ATTR: ["charset", "name", "content", "rel", "media", "type", "sizes"],
    FORBID_TAGS: ["script", "style", "form", "iframe", "object", "embed", "base", "input", "button", "textarea", "select"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur", "onchange", "onsubmit", "onkeydown", "onkeyup", "onkeypress", "http-equiv"],
    WHOLE_DOCUMENT: true,
  });
  const styleStripped = sanitizeStyleValues(sanitized);
  const stripped = styleStripped.replace(DATA_TEXT_HTML_PATTERN, "$1");
  const cappedCanvas = enforceCanvasCaps(stripped);
  if (cappedCanvas.toLowerCase().startsWith("<html")) {
    return DOCTYPE_TAG + cappedCanvas;
  }
  return cappedCanvas;
}

export function countElements(html: string): number {
  const matches = html.match(/<[a-zA-Z][^>]*>/g);
  return matches ? matches.length : 0;
}

const BODY_RE = /<body[^>]*>([\s\S]*?)<\/body>/i;

export function countBodyChildren(html: string): number {
  const match = html.match(BODY_RE);
  if (match === null) {
    return countElements(html);
  }
  return countElements(match[1] ?? "");
}

export function checkStructuralDelta(priorCount: number, newCount: number): { ok: true } | { ok: false; reason: string } {
  const added = newCount - priorCount;
  if (added > MAX_ELEMENTS_ADDED) {
    return { ok: false, reason: `edit adds ${added} elements (max ${MAX_ELEMENTS_ADDED})` };
  }
  if (newCount < MIN_BODY_CHILDREN) {
    return { ok: false, reason: `edit would leave page with no content` };
  }
  return { ok: true };
}
