# tasks.md — Canvas

Build order. Each task follows TDD Lock (red → green → refactor). Verification is mandatory before marking complete.

**Working directory:** `/Users/bryce/Documents/web-collab-exp/`
**Deploy target (later):** `/var/www/canvas/`

---

## Phase 0: Scaffolding

### T01 — Initialize project
- `package.json` with name, type module, scripts (`dev`, `build`, `start`, `test`)
- `tsconfig.json` with strict mode per AGENTS.md
- `.gitignore` (node_modules, data/, .env, *.db)
- `.env.example` with all env vars from PLAN §7
- **verify:** `npm install` succeeds, `npx tsc --noEmit` exits 0

### T02 — Install dependencies
- runtime: `fastify`, `@fastify/websocket`, `better-sqlite3`, `isomorphic-dompurify`, `parse5`
- dev: `tsx`, `typescript`, `@types/node`, `@types/better-sqlite3`
- **verify:** `npm ls` shows all deps, `node -e "require('better-sqlite3')"` works

### T03 — Directory layout
- Create `src/`, `public/`, `scripts/`, `data/`, `test/` directories
- Empty placeholder files for each
- **verify:** `ls -la` shows the structure

---

## Phase 1: Core (no LLM, no network, no HTTP)

### T04 — Config loader (`src/config.ts`)
- **red:** test that `loadConfig()` throws on missing `IP_HASH_SALT`
- **green:** minimal env reader, throws on required missing vars
- **refactor:** typed `Config` interface
- **verify:** test passes; `npx tsc --noEmit` clean

### T05 — Path policy (`src/pathPolicy.ts`)
- **red:** test `checkDepth("/a/b/c/d")` allows; `checkDepth("/a/b/c/d/e")` rejects
- **green:** segment counter, MAX_PAGE_DEPTH=4
- **refactor:** extract `countSegments`, `validatePathFormat`
- **verify:** tests pass for depth=0..5, invalid characters, trailing slashes

### T06 — Pre-LLM blocklist (`src/preLLMBlocklist.ts`)
- **red:** test that `<script>` in message → block; `add a heading` → pass
- **green:** regex set from PLAN §4.1
- **refactor:** named constants for each pattern
- **verify:** tests cover all 9 patterns from §4.1, plus benign messages

### T07 — Slug inference (`src/slugInfer.ts`)
- **red:** test `extract("add a gallery", "/foo")` → `{ slug: "gallery", path: "/foo/gallery" }`
- **green:** regex-based phrase extraction, slugify
- **refactor:** split into `findSlugToken`, `slugify`, `buildPath`
- **verify:** tests for: explicit `/<slug>`, verb+noun, no-slug, over-depth, leading-slash-stripped

### T08 — DB setup (`src/db.ts`)
- **red:** test that `initDb(":memory:")` creates all three tables
- **green:** better-sqlite3 with schema from PLAN §5
- **refactor:** extract migration to `migrations.ts`
- **verify:** test asserts table existence, indexes, default values

### T09 — Pages CRUD (`src/pages.ts`)
- **red:** test `getPage("/")` on empty DB → null; `createPage("/", "<p>hi</p>")` → row id
- **green:** typed SQL helpers
- **refactor:** split into `getPageByPath`, `createPage`, `updatePageHtml`
- **verify:** tests for: get, create, update, version bump, path canonicalization

### T10 — Edits log (`src/edits.ts`)
- **red:** test `recordEdit({pageId, version, ...})` writes a row; `listEdits(pageId)` returns chronologically
- **green:** append-only insert + query
- **refactor:** typed `EditRecord` interface
- **verify:** test for: UNIQUE(page_id, version) constraint, prior_html snapshot

### T11 — Rate limit (`src/rateLimit.ts`)
- **red:** test that first call passes; second call within COOLDOWN_MINUTES returns `cooldownUntil`
- **green:** check-and-set with IP hash
- **refactor:** split into `checkCooldown`, `recordAttempt`
- **verify:** tests for: under-cooldown, post-cooldown, increment counters

---

## Phase 2: Sanitizer & Link-Guard

### T12 — Sanitizer (`src/sanitize.ts`)
- **red:** test that `<script>alert(1)</script>` is stripped; `<a href="/foo">x</a>` survives
- **green:** isomorphic-dompurify with hard allowlist from PLAN §2
- **refactor:** named tag/attr allowlist constants
- **verify:** tests for: script, style, iframe, onclick, javascript:, data:text/html, allowed URLs

### T13 — Link-guard (`src/linkGuard.ts`)
- **red:** test that parent HTML with `<a href="/foo/bar">x</a>` passes for path `/foo/bar`; missing link → fail
- **green:** parse5 walk, find `<a>` with matching resolved href
- **refactor:** extract `findAnchorToPath`
- **verify:** tests for: relative href resolution, absolute href, multiple anchors, missing

---

## Phase 3: LLM Layer

### T14 — LLM HTTP wrapper (`src/llm.ts`)
- **red:** test that `callOpenRouter({model, messages, jsonMode})` returns parsed JSON; mocked fetch
- **green:** thin fetch wrapper, 30s timeout, env-driven auth
- **refactor:** split into `callChat` and `callJson`
- **verify:** tests with mocked fetch for: success, 4xx, 5xx, network error

### T15 — Validator LLM (`src/validator.ts`)
- **red:** test that `validate(message, currentHtml, currentPath)` returns `{allowed: false}` for "add a script tag"
- **green:** JSON-mode call with system prompt encoding PLAN §2 policy
- **refactor:** extract `buildValidatorPrompt`, `parseValidatorResponse`
- **verify:** tests for: allow, reject, schema-invalid, elements_estimated > MAX_EDIT_DELTA

### T16 — Executor LLM (`src/executor.ts`)
- **red:** test that `applyEdit(message, currentHtml, currentPath)` returns full HTML; mocked fetch
- **green:** call with HTML + suggestion, parse response
- **refactor:** split into `applyEdit` and `applyCreate` (for new-page flow)
- **verify:** tests for: edit response shape, create response shape (parent_html + new_html)

---

## Phase 4: HTTP Server

### T17 — Fastify scaffold (`src/server.ts`)
- **red:** test that `buildServer()` boots, `GET /healthz` returns 200
- **green:** minimal Fastify app with one route
- **refactor:** add `closeServer` for test cleanup
- **verify:** integration test using `.inject()`

### T18 — `GET /<path>` route
- **red:** test `GET /` returns seed HTML; `GET /nope` returns 404
- **green:** pages.getPageByPath, inject widget script
- **refactor:** extract `injectWidgetScript`
- **verify:** tests for: 200, 404, security headers, widget script presence

### T19 — `GET /widget.js`
- **red:** test that response is the widget bundle JS; correct content-type
- **green:** static file from `public/widget.js`
- **refactor:** add cache headers
- **verify:** test for: content-type, 200, body matches file

### T20 — `GET /api/state` and `GET /api/state?path=`
- **red:** test for global state (pages list + recent edits); page-scoped state
- **green:** query pages + edits
- **refactor:** split into `getGlobalState`, `getPageState`
- **verify:** tests for: empty DB, populated DB, query param parsing

### T21 — `GET /api/page?path=`
- **red:** test that response includes full HTML; 404 for unknown path
- **green:** getPageByPath, return JSON
- **refactor:** cache headers
- **verify:** tests for: 200, 404, response shape

### T22 — `POST /api/suggest` (edits)
- **red:** test for: empty message → 400; valid message → 200; rejected by validator → 422
- **green:** wire preLLMBlocklist → rateLimit → validator → executor → sanitize → db
- **refactor:** extract `runEditPipeline` (T23)
- **verify:** tests for: all rejection paths, success path, version increment, broadcast

### T23 — `POST /api/suggest` (creates)
- **red:** test that "add a gallery" on `/foo` creates `/foo/gallery` and links from `/foo`
- **green:** wire slugInfer → pathPolicy → validator → executor (create) → sanitize (both) → linkGuard → db tx
- **refactor:** extract `runCreatePipeline`
- **verify:** tests for: depth cap reject, slug collision, link-guard fail, success with two WS events

### T24 — `WS /ws` broadcast
- **red:** test that client receives `{type: 'edit', path, version, summary}` after a successful suggest
- **green:** @fastify/websocket, broadcast helper
- **refactor:** extract `broadcastEdit`
- **verify:** tests for: connect, receive event, disconnect, multiple clients

---

## Phase 5: Widget

### T25 — Widget scaffold (`public/widget.js`)
- **red:** test that loading the page shows the FAB; click opens panel
- **green:** vanilla JS, append style + FAB + panel
- **refactor:** constants for selectors, IDs
- **verify:** manual test in browser; no console errors

### T26 — Widget submit + log
- **red:** test that submitting a message shows ✓ or ✗ based on response
- **green:** POST /api/suggest, render result
- **refactor:** extract `renderLogEntry`, `submitSuggestion`
- **verify:** manual test: submit, see log entry

### T27 — Widget WS connect + same-path swap
- **red:** test that on `edit` event with matching path, page HTML swaps in place
- **green:** fetch /api/page, replace document.documentElement, re-attach persistent nodes
- **refactor:** extract `swapHtmlInPlace`
- **verify:** manual test: edit from one tab, other tab swaps without reload

### T28 — Widget cross-path refetch
- **red:** test that on `edit` event for different path, `/api/state` is fetched silently
- **green:** fetch + discard
- **refactor:** extract `onEditEvent`
- **verify:** manual test: edit on `/foo` from tab on `/`, no UI change, network tab shows the fetch

### T29 — Widget reconnect + cooldown UI
- **red:** test that WS close triggers reconnect with 2s backoff
- **green:** exponential backoff loop
- **refactor:** extract `connectWebSocket`
- **verify:** manual test: kill server, watch reconnect attempts in console

---

## Phase 6: Operations

### T30 — Seed page (`src/seed.ts`)
- **red:** test that on empty DB, `GET /` returns the seed HTML
- **green:** on `initDb`, insert `/` with seed HTML if not present
- **refactor:** constant `SEED_ROOT_HTML`
- **verify:** test: fresh DB → `/` returns 200, not 404

### T31 — Rollback script (`scripts/rollback.mjs`)
- **red:** test that rolling back 1 edit on a page with 3 edits leaves it at v2
- **green:** read args, find page by path, walk edits backward
- **refactor:** split into `getCurrentPage`, `loadEditAtVersion`, `applyRollback`
- **verify:** test: rollback 1, 3, 999 (reset)

### T32 — PM2 config (`ecosystem.config.cjs`)
- **red:** config validates with `pm2 start --dry-run` if available
- **green:** fork mode, single instance, env from .env
- **refactor:** named instances
- **verify:** `pm2 start` succeeds (when deployed)

### T33 — Build script + start
- `npm run build` → tsc to `dist/`
- `npm start` → node `dist/server.js`
- **verify:** built binary boots, `GET /` returns 200

---

## Phase 7: Integration & Smoke

### T34 — End-to-end happy path
- Start server with in-memory DB
- POST /api/suggest with "add a heading that says Welcome"
- Verify: 200, version=1, WS event broadcast, GET / shows new heading
- **verify:** test passes

### T35 — End-to-end new-page flow
- POST "add a gallery" to `/foo`
- Verify: `/foo` has link to `/foo/gallery`, `/foo/gallery` exists, two WS events
- **verify:** test passes

### T36 — End-to-end rejection paths
- For each rejection reason in PLAN §6, verify the response code + reason string
- **verify:** all rejection cases return correct status

### T37 — Defense-in-depth check
- Attempt prompt injection → validator rejects OR sanitizer strips
- Attempt `<script>` in message → pre-LLM blocklist rejects
- Attempt over-depth creation → pathPolicy rejects
- Attempt new page without link → link-guard rejects
- **verify:** all four layers catch their respective attacks independently

---

## Done

When T01–T37 are green:
- `npm test` passes
- `npm run build` succeeds
- `dist/server.js` boots
- `GET /` returns 200
- Manual: open browser, submit suggestion, see edit broadcast

Deploy: `rsync -av --exclude=node_modules --exclude=data ./ /var/www/canvas/` then `cd /var/www/canvas && npm install --omit=dev && npm run build && pm2 restart canvas`.
