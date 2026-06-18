# Canvas — Plan

A public website where anyone can suggest small, LLM-mediated changes to a page through a chat widget. Approved edits are broadcast to all connected visitors in real time and applied in place — no full page reload. New pages are created on demand; the same edit must link to the new page from the page the user is on.

**Repo:** `/var/www/canvas/`
**Service:** PM2 process `canvas`
**Public URL:** `https://canvas.oopsallsharks.com`
**Local URL:** `http://127.0.0.1:3131`
**Version:** v1 (May 2026)

---

## 1. Goals & Non-Goals

### Goals

- Let visitors suggest changes to any page, and create new pages, via the chat widget.
- Auto-create pages on first mention. No link requirement, but the same accepted edit must add a working link from the user's current page to the new page.
- Mediate every change through an LLM that enforces a "small + nondestructive" policy.
- Broadcast accepted edits to all connected visitors in real time and update the DOM in place — no full page reload.
- Keep the attack surface small: no scripts, no forms, no event handlers, no remote code execution, ever.
- Be runnable by one person, on one VPS, on free-tier LLM spend.

### Non-Goals (v1)

- User accounts, authentication, signed-in suggestions.
- Admin dashboard, edit queue, moderation UI.
- Edit diffing on the wire (clients swap full HTML in place on edits).
- Edit history UI (history is queryable in the DB; not exposed to the web).
- Multi-language support.
- Mobile-optimized widget (works on mobile; not beautiful there).
- Page tree enforcement beyond a depth cap.

---

## 2. Edit Policy

### Allowed

- Adding new elements (text, images via `https:` URLs, headings, lists, links to existing `pages.path` values via relative or `/`-prefixed paths).
- Modifying text content, classes, ids, `alt`/`title`/`style`, ARIA attributes of existing elements.
- Reordering child elements within a single parent.
- Creating a new page by inferring a slug from the message. The same accepted edit must add a working `<a href="<new-path>">link text</a>` to the current page pointing at the new page. The new page's path is the current page's path plus `/` plus the inferred slug. An explicit `/<absolute>` slug in the message is treated as relative (leading `/` stripped).

### Not Allowed

- Adding `<script>`, `<style>`, `<form>`, `<iframe>`, `<object>`, `<embed>`, `<base>`, `<meta http-equiv>`, `<input>`, `<button>`, `<textarea>`, `<select>`.
- Adding event-handler attributes (`onclick`, `onload`, `onerror`, …).
- Setting `href`/`src` to `javascript:`, `data:text/html`, or any non-`https:`/non-`mailto:`/non-existent-`/`/non-existent-`#` URL. (Internal links must resolve to a path in `pages`.)
- Removing more than 3 sibling elements at once.
- Removing a top-level structural element (`<header>`, `<main>`, `<footer>`, or any direct child of `<body>`) if it would drop that page's body-children count below 50% of the prior state for that page.
- Replacing the page wholesale.
- Edit deltas that exceed `MAX_EDIT_DELTA` (default: 20 elements).
- Edits whose sanitized output drops below 50% of the prior element count.
- Edits whose sanitized output adds more than 50 elements to the prior count.
- Creating a page whose path would exceed `MAX_PAGE_DEPTH` (default: 4 segments; `/a/b/c/d` is the deepest allowed leaf; `/a/b/c/d/e` is rejected).
- Creating a new page without a same-edit link to it from the current page (link-guard verifies after sanitize).
- Any user message matching the pre-LLM blocklist (Section 4.1).
- Any user message containing a prompt-injection attempt.

---

## 3. Architecture

```
Browser
  ├─ GET  /                  → page at "/" (with widget script injected)
  ├─ GET  /<path>            → page at /<path> (404 if not in pages table)
  ├─ GET  /widget.js         → chat widget bundle
  ├─ GET  /api/state         → { pages: [{ path, version, updated_at }], recent_edits: [...] }
  ├─ GET  /api/state?path=X  → { path, version, updated_at, recent_edits: [...] }
  ├─ GET  /api/page?path=X   → { path, version, updated_at, html }
  ├─ POST /api/suggest       → { message, path? } → { status, reason?, path?, version?, summary? }
  └─ WS   /ws                → server pushes { type: 'edit', path, version, summary } events

Fastify server (Node 20)
  ├─ safety.preLLMBlocklist  (regex, runs first)
  ├─ rateLimit.checkCooldown (per-IP, env-tunable)
  ├─ pathPolicy.checkDepth   (cap; rejects over-depth before any LLM call)
  ├─ pageResolver.resolve    (load current page HTML; for new-page suggestions, load parent HTML)
  ├─ slugInfer.extract       (deterministic, LLM-free; see Section 8.1)
  ├─ validator.validate      (cheap LLM, JSON-mode; confirms new page + same-edit link if applicable)
  ├─ executor.apply          (capable LLM; returns full HTML; for creates, returns parent + new)
  ├─ sanitize.sanitizeHTML   (DOMPurify, hard allowlist; runs on every page touched)
  ├─ linkGuard.verify        (post-sanitize: confirm <a> to new path exists in parent)
  └─ db.recordEdits / db.updatePages (SQLite, append-only log; both pages in one tx for creates)
       └─ broadcast { type: 'edit', path, version, summary } to all WS clients
```

Executor return shapes:
- **Edit:** `{ kind: "edit", path, html }`
- **Create:** `{ kind: "create", parent_path, new_path, parent_html, new_html }`

### Two-LLM pattern

- **Validator** — Decide if a suggestion is allowed and roughly what it would do. `anthropic/claude-3-haiku` (or any cheap/fast). Runs on every request. JSON-mode. Short output.
- **Executor** — Apply an approved change to the HTML. `anthropic/claude-3.5-sonnet` (or any strong HTML-follower). Runs only on accepted suggestions. Full HTML in/out.

The split keeps cost down — most rejections cost fractions of a cent.

---

## 4. Defense in Depth

Five independent layers, each capable of rejecting an attack on its own. The LLM is the softest layer; the others are the actual safety.

### 4.1 Pre-LLM regex blocklist (cheap, deterministic)

If the **user's message text** matches any of these, reject before the LLM is called:

- `<\s*script`, `<\s*/script`, `<\s*style`
- `javascript:`
- `data\s*:\s*text/html`
- `\bon\w+\s*=\s*["']`
- `<\s*iframe`, `<\s*form`, `<\s*object`, `<\s*embed`, `<\s*base`, `<\s*meta\s+http-equiv`

### 4.2 Validator LLM (policy check)

A cheap LLM in JSON-mode evaluates the suggestion against the policy in Section 2. The system prompt explicitly rejects prompt-injection attempts. Output schema:

```json
{ "allowed": true, "reason": "...", "change_summary": "...", "elements_estimated": 5 }
```

Reject if `allowed` is false, schema is invalid, or `elements_estimated > MAX_EDIT_DELTA`.

### 4.3 Executor LLM

Receives the current HTML + the validator's `change_summary` + the original suggestion. System prompt forbids `<script>`, event handlers, dangerous URLs. Returns the full updated HTML document only — no prose, no code fences.

For new-page suggestions, the executor receives the parent page's HTML plus the inferred slug and target path. It must return both the updated parent HTML (with a same-edit link to the new page) and the new page's seed HTML.

### 4.4 Post-execution sanitizer (DOMPurify, hard allowlist)

Always runs on executor output, regardless of LLM behavior. Strips any tags/attrs/URLs not on the allowlist (see `src/sanitize.js` for the exact lists). This is the layer that catches "the LLM listened to a clever jailbreak." Runs on every page touched by a create.

### 4.5 Link-guard (post-sanitize, for new pages)

Verifies that the sanitized parent HTML contains an `<a href="...">` element whose resolved URL matches the new page's path. Rejects the edit if missing.

### 4.6 Browser-enforced CSP

Response header on every page:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'none'
```

The widget's `<script src="/widget.js">` is self-hosted, so the policy is airtight against remote script execution.

---

## 5. Data Model

```sql
CREATE TABLE pages (
  id            INTEGER PRIMARY KEY,
  path          TEXT UNIQUE NOT NULL,        -- canonical '/<slug>' or '/'
  current_html  TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 0,  -- per-page, monotonic
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE edits (
  id            INTEGER PRIMARY KEY,
  page_id       INTEGER NOT NULL REFERENCES pages(id),
  version       INTEGER NOT NULL,            -- N == "this edit IS the Nth version of THIS page"
  user_suggestion TEXT NOT NULL,
  validator_reasoning TEXT,
  validator_change_summary TEXT,
  previous_html TEXT NOT NULL,
  new_html      TEXT NOT NULL,
  ip_hash       TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE(page_id, version)
);

CREATE TABLE rate_limits (
  ip_hash       TEXT PRIMARY KEY,
  last_suggestion_at TEXT,
  cooldown_until TEXT,
  total_attempts INTEGER DEFAULT 0,
  total_rejected INTEGER DEFAULT 0,
  flagged       INTEGER DEFAULT 0
);
```

`path` is canonical: lowercase, no trailing slash except for `/`, segments `[a-z0-9-]+`. Depth is the segment count (`/` = 0, `/a/b/c/d` = 4). `ip_hash` = `SHA-256(IP_HASH_SALT + ":" + ip).hex().slice(0, 32)`. Raw IPs are never stored.

---

## 6. HTTP API

### `GET /<path>`

Returns the page at `path` if it exists in `pages`. Unknown paths return `404 Not Found` — no auto-create on GET. Widget script injected; security headers applied.

- Response: `text/html`
- Headers: `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`

### `GET /widget.js`

Static. Chat widget bundle.

### `GET /api/state`

- Response: `{ pages: [{ path, version, updated_at }], recent_edits: [{ path, version, summary, created_at }] }` (last 10 across all pages).

### `GET /api/state?path=<path>`

- Response: `{ path, version, updated_at, recent_edits: [{ version, summary, created_at }] }` (last 10 for that page).

### `GET /api/page?path=<path>`

For in-place swaps. Returns full sanitized HTML.

- Response: `{ path, version, updated_at, html }`
- `404` if unknown.

### `POST /api/suggest`

- Request: `{ "message": string, "path"?: string }` (1–500 chars). The server uses `path` (or `/` default) to scope everything; the client always sends it.
- Responses:
  - `200 { "status": "accepted", "path": string, "version": int, "summary": string }` — `path` is the page targeted (the *parent* for creates).
  - `400 { "status": "rejected", "reason": "empty message" | "message too long (>500 chars)" | "invalid path" }`
  - `422 { "status": "rejected", "reason": "depth cap exceeded" | "link required to new page" | "path already exists" | <validator reason> | <sanitizer reason> | <link-guard reason> }`
  - `429 { "status": "rejected", "reason": "cooldown active", "until": ISO }`

For a successful create, two WS events are emitted (one for parent, one for new page).

The endpoint enforces cooldown *before* the LLM is called (no cost on rate-limited requests). Cooldown is set on *every* request, not just accepted ones.

### `WS /ws`

- `{ "type": "edit", "path": string, "version": int, "summary": string }` — one event per affected page.

---

## 7. Environment

- `OPENROUTER_API_KEY` — (required) OpenRouter auth
- `VALIDATOR_MODEL` — `anthropic/claude-3-haiku` (cheap gatekeeper)
- `EXECUTOR_MODEL` — `anthropic/claude-3.5-sonnet` (capable HTML editor)
- `IP_HASH_SALT` — (required) 32+ random bytes, hex; never rotate (would orphan all rate limits)
- `COOLDOWN_MINUTES` — `60` per-IP gap between suggestions
- `MAX_EDIT_DELTA` — `20` max element count delta per edit
- `MAX_PAGE_DEPTH` — `4` (segments; `/` is depth 0)
- `PORT` — `3131` backend listen port (bind to `127.0.0.1` only)
- `LOG_LEVEL` — `info` Fastify logger level
- `CANVAS_DATA_DIR` — `./data` override for tests

`IP_HASH_SALT` is a one-time secret. Generating a new one invalidates all existing rate-limit state and IP-hash correlations. Don't rotate casually.

---

## 8. Client Widget

### 8.1 Slug inference (server-side, deterministic, LLM-free)

`slugInfer.extract(message, currentPath)`:
- If the message contains an explicit token matching `/[a-z0-9-]+/`, use it. Leading `/` is stripped; the result is appended to `currentPath`.
- Otherwise, look for a phrase after verbs like "make", "create", "add a page for/about", "a gallery called X". Slugify: lowercase, keep `[a-z0-9]+` runs, join with `-`, max 32 chars, strip leading/trailing dashes.
- Reject if no slug can be inferred, or if `currentPath + '/' + slug` would exceed `MAX_PAGE_DEPTH`.
- The validator LLM can veto a proposed slug; the executor decides the link's anchor text.

### 8.2 Widget behavior

- Reads `window.location.pathname` as the current page; sends it on every `POST /api/suggest`.
- On WS `edit` events:
  - If `event.path === location.pathname`: `fetch('/api/page?path=' + event.path)`, then swap the entire `<html>` element's content. Re-attach persistent nodes (`#canvas-style`, `#canvas-fab`, `#canvas-panel`) to the new document by ID before discarding the old one. `document.title` updates from the new `<title>`. Scroll position preserved if document height is similar; otherwise reset to top.
  - If `event.path !== location.pathname`: silently `fetch('/api/state')` and discard. No UI changes for v1; the call keeps any future page-aware UI fresh.
- Chat log state lives in `localStorage` keyed by `path`, so it survives in-place swaps and is per-page.
- Cooldown countdowns still rendered from server-reported `until` timestamps (no client clock dependency).
- Reconnect: 2s backoff on close.

**DOM contract:** appends `<style id="canvas-style">`, `<button id="canvas-fab">`, `<div id="canvas-panel">`. These IDs are stable across in-place swaps.

---

## 9. Operations

### Start / stop

```bash
pm2 start /var/www/canvas/ecosystem.config.cjs
pm2 restart canvas
pm2 stop canvas
pm2 logs canvas
```

### Rollback the last edit on a page

```bash
cd /var/www/canvas && node scripts/rollback.mjs /<path> 1
cd /var/www/canvas && node scripts/rollback.mjs /<path> 3
cd /var/www/canvas && node scripts/rollback.mjs /<path> 999   # reset to seed
```

### Inspect history

```bash
# per-page
sqlite3 /var/www/canvas/data/canvas.db \
  "SELECT version, validator_change_summary, created_at FROM edits
   WHERE page_id = (SELECT id FROM pages WHERE path = '/<path>')
   ORDER BY version DESC LIMIT 20;"

# global
sqlite3 /var/www/canvas/data/canvas.db \
  "SELECT p.path, e.version, e.validator_change_summary, e.created_at
   FROM edits e JOIN pages p ON p.id = e.page_id
   ORDER BY e.created_at DESC LIMIT 20;"
```

### Reset a page to seed

```bash
cd /var/www/canvas && node scripts/rollback.mjs /<path> 999
```

### Update dependencies

```bash
cd /var/www/canvas && npm outdated
cd /var/www/canvas && npm update
cd /var/www/canvas && pm2 restart canvas
```

### View real-time traffic

```bash
pm2 logs canvas --raw | jq -r 'select(.msg | test("suggest|edit")) | .msg'
```

---

## 10. Known Limits & Failure Modes

### New-page spam via deep paths

Blocked at `pathPolicy.checkDepth` before the LLM is called — free rejection.

### New-page spam via shallow trees

A user could create many shallow children of their current page. Cooldown is per IP, and the link-guard means each new page also costs an edit on the parent — double-billing the cooldown.

### Slug collisions

Two users on the same page suggesting the same new slug race. First write commits, second gets `422 "path already exists"`. Cooldown makes this rare.

### In-place swap regressions

Replacing `<html>` content is safe by construction: no scripts exist (CSP), no event handlers exist (sanitizer), nothing user-land needs to persist across the swap except the widget's own three nodes.

### Tree shape is user-controlled

The link-guard requires one inbound link to a new page, not that the tree is a tree. A page can be created with a link from anywhere navigable. Discoverability is a community problem.

### First-mover effect

The first 3–5 visitors shape the site forever. Seed pages are intentionally minimal.

### LLM cost spikes

A viral share could produce thousands of suggestions. Mitigations:
- Cooldown runs *before* the LLM call, so spam is free.
- Validator is the cheap model.
- Hard cap on the executor's `max_tokens` (8192 in the current code).
- Add a daily token budget as a circuit-breaker if needed.

### LLM returns broken HTML

DOMPurify and the structural guards (50%/50-element checks, doctype check) catch this. The site reverts to its previous state and the user sees a generic rejection.

### WebSocket disconnect

Widget reconnects with 2s backoff. The widget also works without WebSocket — clients simply don't see live updates until the next WS event arrives or they manually reload.

### Storage growth

`edits.previous_html` is stored for every accepted change, so the DB grows linearly with the number of accepted edits. A page with 10,000 edits is ~50–200MB depending on page size. v1 doesn't prune. If this becomes a problem: add a "snapshot every N edits, discard intermediate previous_html" job.

### Rollback is silent

The rollback script updates the DB and the next `GET /<path>` reflects the new state, but connected WebSocket clients are **not** notified. They'll see the rollback on their next swap or manual reload.

---

## 11. Security Posture

- **Input layer:** regex blocklist + validator LLM (system-prompt-hardened).
- **Output layer:** DOMPurify with hard allowlist + structural sanity checks (50% element count, doctype, +50 element cap) + link-guard for new pages.
- **Transport:** HTTPS via nginx; WebSocket via wss:.
- **Browser:** CSP with default-src 'self'; script-src 'self', frame-ancestors 'none', form-action 'none'.
- **Storage:** IPs never persisted; only salted hashes.
- **Secrets:** OpenRouter key + IP_HASH_SALT in /var/www/canvas/.env (not in git).
- **Process:** PM2 fork mode, single instance, no cluster (LLM calls are I/O bound, not CPU bound).

### What an attacker can do

- Suggest a benign change → succeeds.
- Suggest an obvious attack → blocked at the regex layer.
- Craft a clever prompt injection → might fool the validator, but DOMPurify + CSP will still strip the result.
- Hammer the endpoint → rate-limited per IP, per cooldown.
- Get the OpenRouter key → ❌ it's only in the server's .env, never sent to the client.

### What an attacker cannot do (assuming no zero-days)

- Execute JavaScript on the page (CSP + DOMPurify).
- Submit a form (no forms ever rendered, form-action 'none').
- Embed the canvas in an iframe (frame-ancestors 'none').
- Trick the page into loading remote scripts (CSP script-src 'self').
- Persist arbitrary HTML, event handlers, or dangerous URLs in the DB (DOMPurify allowlist).
- Create a new page without linking to it from a parent (link-guard).
- Create a path deeper than `MAX_PAGE_DEPTH`.

---

## 11.5 New-Page Edit Flow (end-to-end)

For "add a gallery to this page" sent from `/foo`:

1. Client: `POST /api/suggest { message: "add a gallery", path: "/foo" }`.
2. Server: `pathPolicy.checkDepth("/foo")` passes. `pageResolver.resolve("/foo")` loads current HTML.
3. Server: `slugInfer.extract("add a gallery", "/foo")` → slug `gallery`, candidate path `/foo/gallery`.
4. Server: `pathPolicy.checkDepth("/foo/gallery")` — if it exceeds `MAX_PAGE_DEPTH`, reject with `422 "depth cap exceeded"` before any LLM call.
5. Server: validator LLM receives current HTML of `/foo` + proposed change. Confirms small, nondestructive, and that a same-edit link to `/foo/gallery` will be added.
6. Server: executor LLM returns `{ kind: "create", parent_path: "/foo", new_path: "/foo/gallery", parent_html: <new HTML of /foo with link>, new_html: <seed HTML of /foo/gallery> }`.
7. Server: `sanitize.sanitizeHTML` runs on both. `linkGuard.verify(parent_html, "/foo/gallery")` confirms an `<a href>` resolving to `/foo/gallery` exists in the sanitized parent. If not, reject.
8. Server: transaction writes parent (version N+1) and new page (version 1), records two `edits` rows.
9. Server: emits two WS events.
10. Clients: a user on `/foo` fetches `/api/page?path=/foo` and swaps `<html>` in place — the new link appears. A user on `/` silently refetches `/api/state` and discards.

---

## 12. Versioning

- **v1** (this spec): Multiple pages, no auth, no admin, in-place HTML swap on WS edits, two-LLM OpenRouter pipeline, 6-layer defense (5 base + link-guard).

Out of scope until further notice: anything resembling a content moderation platform, anything user-account-shaped, anything that requires persistent identity.

---

## 13. Glossary

- **Edit** — a single accepted change that bumps a page's version. Persisted in the edits table.
- **Suggestion** — a user's submitted message. May be accepted (becomes an edit) or rejected.
- **Validator** — the cheap LLM that decides whether a suggestion is allowed.
- **Executor** — the capable LLM that produces the new HTML.
- **Sanitizer** — the DOMPurify step that scrubs executor output.
- **Link-guard** — post-sanitize check that a same-edit link to the new page exists on the parent.
- **Version** — monotonically increasing integer per page. v0 is the seed.
- **Rollback** — restoring a prior version of a single page as that page's current state, using a stored `previous_html` snapshot.
- **Page** — a single routable HTML document at `/<slug>`. Each page has its own version counter and edit log.
- **Path** — the canonical URL path of a page, e.g. `/` or `/about`. Used as the lookup key in `pages` and as the addressable target of a suggestion.
- **Seed** — the initial empty HTML for a newly created page (v0).
- **Depth** — number of segments in a page's path. `/` is depth 0; `/a/b/c` is depth 3. `MAX_PAGE_DEPTH` (default 4) caps how deep new pages can be created.
- **Parent page** — for a new page at `/a/b/c`, the parent is `/a/b` (the page the user was on when they suggested the new page).
- **Same-edit link** — an `<a href="...">` element that, in the same accepted edit that creates a new page, is added to the parent page pointing at the new page.
- **In-place swap** — replacing the `<html>` element's content client-side from a WS-pushed event, without a full page reload.
