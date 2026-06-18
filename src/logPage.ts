import type { Database } from "./db.js";
import { listPages, type Page } from "./pages.js";
import { listAllEdits, type FullEdit } from "./edits.js";
import { listAllLLMFailures, type LLMFailureRecord } from "./llmFailures.js";

const DOCTYPE_TAG = "<!DOCTYPE html>";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function renderPagesTable(pages: ReadonlyArray<Page>): string {
  if (pages.length === 0) {
    return "<p>No pages yet.</p>";
  }
  const rows = pages
    .map(
      (p) =>
        `<tr><td><a href="${escapeHtml(p.path)}">${escapeHtml(p.path)}</a></td><td>${p.version}</td><td>${escapeHtml(formatTimestamp(p.updated_at))}</td></tr>`,
    )
    .join("");
  return `<table class="log-table"><thead><tr><th>Path</th><th>Version</th><th>Updated</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderEditsTable(edits: ReadonlyArray<FullEdit>): string {
  if (edits.length === 0) {
    return "<p>No edits yet.</p>";
  }
  const rows = edits
    .map(
      (e) =>
        `<tr><td>${escapeHtml(formatTimestamp(e.created_at))}</td><td><a href="${escapeHtml(e.path)}">${escapeHtml(e.path)}</a></td><td>${e.version}</td><td>${escapeHtml(e.summary ?? "")}</td><td>${escapeHtml(e.user_suggestion)}</td></tr>`,
    )
    .join("");
  return `<table class="log-table"><thead><tr><th>When</th><th>Page</th><th>Ver</th><th>Summary</th><th>Suggestion</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderLLMFailuresTable(failures: ReadonlyArray<LLMFailureRecord>): string {
  if (failures.length === 0) {
    return "<p>No LLM failures yet.</p>";
  }
  const rows = failures
    .map(
      (failure) =>
        `<tr><td>${escapeHtml(formatTimestamp(failure.created_at))}</td><td>${escapeHtml(failure.stage)}</td><td>${escapeHtml(failure.model)}</td><td><a href="${escapeHtml(failure.path)}">${escapeHtml(failure.path)}</a></td><td>${escapeHtml(failure.reason)}</td><td>${escapeHtml(failure.user_suggestion)}</td><td>${escapeHtml(failure.detail ?? "")}</td></tr>`,
    )
    .join("");
  return `<table class="log-table"><thead><tr><th>When</th><th>Stage</th><th>Model</th><th>Path</th><th>Reason</th><th>Suggestion</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function renderLogPage(db: Database): string {
  const pages = listPages(db);
  const edits = listAllEdits(db);
  const llmFailures = listAllLLMFailures(db);
  return `${DOCTYPE_TAG}
<html lang="en">
<head>
<meta charset="utf-8">
<title>Site Log</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/paper.min.css">
<style>
.log-table{border-collapse:collapse;width:100%;margin-bottom:1.5rem}
.log-table th,.log-table td{border:1px solid #cdcccb;padding:0.4rem 0.6rem;text-align:left;vertical-align:top}
.log-table th{background:#f2f0ea;font-weight:600}
.log-section{margin-bottom:2rem}
.log-section h2{margin-bottom:0.5rem}
</style>
</head>
<body>
<main>
<h1>Site Log</h1>
<p>Read-only history of pages and edits. This page is not editable.</p>
<div class="log-section">
<h2>Pages (${pages.length})</h2>
${renderPagesTable(pages)}
</div>
<div class="log-section">
<h2>Edits (${edits.length})</h2>
${renderEditsTable(edits)}
</div>
<div class="log-section">
<h2>LLM Failures (${llmFailures.length})</h2>
${renderLLMFailuresTable(llmFailures)}
</div>
</main>
</body>
</html>`;
}
