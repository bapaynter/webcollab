import DOMPurify from "isomorphic-dompurify";

export const MAX_ELEMENTS_ADDED = 50;
export const MIN_BODY_CHILDREN = 1;

const ALLOWED_TAGS: ReadonlyArray<string> = [
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "span", "div", "section", "article", "main", "header", "footer", "nav", "aside",
  "ul", "ol", "li",
  "a", "img", "figure", "figcaption",
  "blockquote", "pre", "code", "em", "strong", "b", "i", "u", "br", "hr",
  "table", "thead", "tbody", "tr", "th", "td",
  "head", "title", "meta", "link",
];

const ALLOWED_ATTR: ReadonlyArray<string> = [
  "href", "src", "alt", "title", "class", "id", "style",
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
  if (stripped.toLowerCase().startsWith("<html")) {
    return DOCTYPE_TAG + stripped;
  }
  return stripped;
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
