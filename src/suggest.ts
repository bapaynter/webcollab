import { isBlocked } from "./preLLMBlocklist.js";
import { checkCooldown, hashIp, recordAttempt } from "./rateLimit.js";
import { validate } from "./validator.js";
import { applyEdit, applyCreate, isCreatePayload } from "./executor.js";
import { sanitizeHTML, checkStructuralDelta, countBodyChildren } from "./sanitize.js";
import { extract as extractSlug } from "./slugInfer.js";
import { checkDepth, validatePathFormat } from "./pathPolicy.js";
import { createPage, getPageByPath, pageExists, updatePageHtml } from "./pages.js";
import { recordEdit } from "./edits.js";
import { verify as verifyLink } from "./linkGuard.js";

export interface SuggestDeps {
  readonly db: import("./db.js").Database;
  readonly apiKey: string;
  readonly validatorModel: string;
  readonly executorModel: string;
  readonly maxEditDelta: number;
  readonly cooldownMinutes: number;
  readonly ipHashSalt: string;
  readonly maxPageDepth: number;
  readonly rateLimitEnabled: boolean;
  readonly callLLM: (options: import("./llm.js").CallOptions) => Promise<string>;
  readonly callExecutor: (options: import("./llm.js").CallOptions) => Promise<string>;
  readonly broadcast?: (event: { type: "edit"; path: string; version: number; summary: string }) => void;
}

export type SuggestResponse =
  | { status: "accepted"; path: string; version: number; summary: string }
  | { status: "rejected"; reason: string; until?: string };

export interface SuggestInput {
  readonly message: string;
  readonly path?: string;
  readonly ip: string;
}

const MAX_MESSAGE_LENGTH = 500;

export async function runSuggest(deps: SuggestDeps, input: SuggestInput): Promise<SuggestResponse> {
  const message = input.message.trim();
  if (message.length === 0) {
    return { status: "rejected", reason: "empty message" };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { status: "rejected", reason: "message too long (>500 chars)" };
  }
  const targetPath = normalizePath(input.path ?? "/");
  const format = validatePathFormat(targetPath);
  if (!format.ok) {
    return { status: "rejected", reason: `invalid path: ${format.reason}` };
  }

  const ipHash = hashIp(deps.ipHashSalt, input.ip);

  if (isBlocked(message)) {
    if (deps.rateLimitEnabled) {
      recordAttempt(deps.db, ipHash, deps.cooldownMinutes);
    }
    return { status: "rejected", reason: "blocked by content policy" };
  }

  if (deps.rateLimitEnabled) {
    const cooldown = checkCooldown(deps.db, ipHash);
    if (!cooldown.ok) {
      return { status: "rejected", reason: "cooldown active", until: cooldown.until };
    }
    recordAttempt(deps.db, ipHash, deps.cooldownMinutes);
  }

  const page = getPageByPath(deps.db, targetPath);
  if (page === null) {
    return { status: "rejected", reason: "page not found" };
  }

  const validatorResult = await validate(
    {
      apiKey: deps.apiKey,
      model: deps.validatorModel,
      maxEditDelta: deps.maxEditDelta,
      callLLM: deps.callLLM,
    },
    message,
    page.current_html,
    targetPath,
  );
  if (!validatorResult.ok) {
    return { status: "rejected", reason: validatorResult.reason };
  }
  if (!validatorResult.allowed) {
    return { status: "rejected", reason: validatorResult.reason };
  }

  if (validatorResult.is_new_page) {
    const slugResolution = resolveNewPagePath(validatorResult.new_page_slug, message, targetPath);
    if (!slugResolution.ok) {
      return { status: "rejected", reason: slugResolution.reason };
    }
    return await runCreatePipeline(deps, message, targetPath, slugResolution.path, validatorResult.change_summary, ipHash);
  }

  return await runEditPipeline(deps, message, page, targetPath, validatorResult.change_summary, ipHash);
}

function resolveNewPagePath(
  llmSlug: string | null,
  message: string,
  targetPath: string,
): { ok: true; path: string } | { ok: false; reason: string } {
  if (llmSlug !== null && llmSlug.trim() !== "") {
    const cleanSlug = llmSlug.replace(/^\/+/, "").trim();
    if (cleanSlug !== "" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(cleanSlug)) {
      const candidate = targetPath === "/" ? `/${cleanSlug}` : `${targetPath}/${cleanSlug}`;
      const depthCheck = checkDepth(candidate);
      if (!depthCheck.ok) {
        return { ok: false, reason: depthCheck.reason };
      }
      return { ok: true, path: candidate };
    }
  }
  const fallback = extractSlug(message, targetPath);
  if (!fallback.ok) {
    return { ok: false, reason: `could not determine new page path: ${fallback.reason}` };
  }
  return { ok: true, path: fallback.value.path };
}

async function runEditPipeline(
  deps: SuggestDeps,
  message: string,
  page: import("./pages.js").Page,
  targetPath: string,
  changeSummary: string,
  ipHash: string,
): Promise<SuggestResponse> {
  const executorResult = await applyEdit(
    {
      apiKey: deps.apiKey,
      model: deps.executorModel,
      maxTokens: 8192,
      callLLM: deps.callExecutor,
    },
    message,
    page.current_html,
    targetPath,
  );
  if (!executorResult.ok) {
    return { status: "rejected", reason: executorResult.reason };
  }
  if (isCreatePayload(executorResult.html)) {
    console.error("runEditPipeline: executor returned CREATE payload (defense-in-depth)", { targetPath });
    return { status: "rejected", reason: "executor returned CREATE payload for EDIT request" };
  }
  const sanitized = sanitizeHTML(executorResult.html);
  if (isCreatePayload(sanitized)) {
    console.error("runEditPipeline: sanitized output still contains CREATE payload", { targetPath });
    return { status: "rejected", reason: "executor returned CREATE payload for EDIT request" };
  }
  if (!looksLikeHtmlDocument(sanitized)) {
    console.error("runEditPipeline: sanitized output is not an HTML document", { targetPath, sanitized });
    return { status: "rejected", reason: "executor returned non-HTML content" };
  }
  const sanitizedPrior = sanitizeHTML(page.current_html);
  const structuralCheck = checkStructuralDelta(
    countBodyChildren(sanitizedPrior),
    countBodyChildren(sanitized),
  );
  if (!structuralCheck.ok) {
    return { status: "rejected", reason: structuralCheck.reason };
  }
  return await commitEdit(deps, targetPath, page.id, page.current_html, sanitized, message, changeSummary, ipHash);
}

async function runCreatePipeline(
  deps: SuggestDeps,
  message: string,
  parentPath: string,
  newPath: string,
  changeSummary: string,
  ipHash: string,
): Promise<SuggestResponse> {
  if (pageExists(deps.db, newPath)) {
    return { status: "rejected", reason: "path already exists" };
  }
  const parent = getPageByPath(deps.db, parentPath);
  if (parent === null) {
    return { status: "rejected", reason: "parent page not found" };
  }
  const createResult = await applyCreate(
    {
      apiKey: deps.apiKey,
      model: deps.executorModel,
      maxTokens: 8192,
      callLLM: deps.callExecutor,
    },
    message,
    parent.current_html,
    parentPath,
    newPath,
  );
  if (!createResult.ok) {
    return { status: "rejected", reason: createResult.reason };
  }
  const sanitizedParent = sanitizeHTML(createResult.parent_html);
  const sanitizedNew = sanitizeHTML(createResult.new_html);
  const linkCheck = verifyLink(sanitizedParent, parentPath, newPath);
  if (!linkCheck.ok) {
    console.error("runCreatePipeline: link-guard failed", { parentPath, newPath, sanitizedParent, reason: linkCheck.reason });
    return { status: "rejected", reason: linkCheck.reason };
  }
  return await commitCreate(
    deps,
    parentPath,
    newPath,
    parent.id,
    parent.current_html,
    sanitizedParent,
    sanitizedNew,
    message,
    changeSummary,
    ipHash,
  );
}

async function commitEdit(
  deps: SuggestDeps,
  targetPath: string,
  pageId: number,
  previousHtml: string,
  newHtml: string,
  message: string,
  summary: string,
  ipHash: string,
): Promise<SuggestResponse> {
  updatePageHtml(deps.db, pageId, newHtml);
  const page = getPageByPath(deps.db, targetPath);
  if (page === null) {
    return { status: "rejected", reason: "internal: page vanished after update" };
  }
  recordEdit(deps.db, {
    page_id: pageId,
    version: page.version,
    user_suggestion: message,
    validator_reasoning: null,
    validator_change_summary: summary,
    previous_html: previousHtml,
    new_html: newHtml,
    ip_hash: ipHash,
  });
  deps.broadcast?.({ type: "edit", path: targetPath, version: page.version, summary });
  return { status: "accepted", path: targetPath, version: page.version, summary };
}

async function commitCreate(
  deps: SuggestDeps,
  parentPath: string,
  newPath: string,
  parentId: number,
  previousParentHtml: string,
  newParentHtml: string,
  newPageHtml: string,
  message: string,
  summary: string,
  ipHash: string,
): Promise<SuggestResponse> {
  const writeAll = deps.db.transaction(() => {
    updatePageHtml(deps.db, parentId, newParentHtml);
    createPage(deps.db, newPath, newPageHtml);
    const updatedParent = getPageByPath(deps.db, parentPath);
    const newPage = getPageByPath(deps.db, newPath);
    if (updatedParent === null || newPage === null) {
      throw new Error("internal: page vanished after create");
    }
    recordEdit(deps.db, {
      page_id: parentId,
      version: updatedParent.version,
      user_suggestion: message,
      validator_reasoning: null,
      validator_change_summary: summary,
      previous_html: previousParentHtml,
      new_html: newParentHtml,
      ip_hash: ipHash,
    });
    recordEdit(deps.db, {
      page_id: newPage.id,
      version: newPage.version,
      user_suggestion: message,
      validator_reasoning: null,
      validator_change_summary: summary,
      previous_html: newPageHtml,
      new_html: newPageHtml,
      ip_hash: ipHash,
    });
    return { updatedParent, newPage };
  });
  let result: { updatedParent: import("./pages.js").Page; newPage: import("./pages.js").Page };
  try {
    result = writeAll();
  } catch (err) {
    console.error("commitCreate: write failed", { parentPath, newPath, err });
    return { status: "rejected", reason: `commit failed: ${(err as Error).message}` };
  }
  deps.broadcast?.({ type: "edit", path: parentPath, version: result.updatedParent.version, summary });
  deps.broadcast?.({ type: "edit", path: newPath, version: result.newPage.version, summary });
  return { status: "accepted", path: parentPath, version: result.updatedParent.version, summary };
}

function normalizePath(raw: string): string {
  if (raw === "") {
    return "/";
  }
  if (!raw.startsWith("/")) {
    return `/${raw}`;
  }
  return raw;
}

function looksLikeHtmlDocument(content: string): boolean {
  const lower = content.toLowerCase();
  return lower.includes("<html") && lower.includes("<body");
}