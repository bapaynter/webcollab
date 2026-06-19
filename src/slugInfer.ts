import { MAX_PAGE_DEPTH, countSegments } from "./pathPolicy.js";

export const MAX_SLUG_LENGTH = 32;

export type SlugResult = { ok: true; value: { slug: string; path: string } } | { ok: false; reason: string };

const EXPLICIT_SLUG_PATTERN = /\/([a-z0-9-]+)/i;
const VERB_PHRASE_PATTERN = /(?:make|create|add)\s+(?:a\s+(?:page\s+(?:for|about|called)?|thing\s+called|gallery\s+called)?\s*)?["']?([a-z0-9][a-z0-9\s-]*?)["']?\s*(?:page|section|tab|gallery|widget|thing)?\s*$/i;

export function extract(message: string, currentPath: string, maxPageDepth: number = MAX_PAGE_DEPTH): SlugResult {
  const explicitMatch = message.match(EXPLICIT_SLUG_PATTERN);
  let rawSlug: string;
  if (explicitMatch) {
    rawSlug = explicitMatch[1] ?? "";
  } else {
    const phraseMatch = message.match(VERB_PHRASE_PATTERN);
    if (phraseMatch) {
      rawSlug = phraseMatch[1] ?? "";
    } else {
      return { ok: false, reason: "no slug could be inferred" };
    }
  }
  const slug = slugify(rawSlug);
  if (slug === "") {
    return { ok: false, reason: "no slug could be inferred" };
  }
  const targetPath = buildPath(currentPath, slug);
  if (countSegments(targetPath) > maxPageDepth) {
    return { ok: false, reason: `depth cap exceeded: ${targetPath}` };
  }
  return { ok: true, value: { slug, path: targetPath } };
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .join("-")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/g, "");
}

function buildPath(currentPath: string, slug: string): string {
  if (currentPath === "/") {
    return `/${slug}`;
  }
  return `${currentPath}/${slug}`;
}
