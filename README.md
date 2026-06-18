# Canvas

Canvas is a collaborative website where visitors suggest edits through a chat widget.
The server validates and applies changes, stores history in SQLite, and broadcasts updates in real time.

## Requirements

- Node.js 20+
- npm

## Quick Start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy env file and set required values:

   ```bash
   cp .env.example .env
   ```

   Required:
   - `OPENROUTER_API_KEY`
   - `IP_HASH_SALT`

3. Run dev server:

   ```bash
   npm run dev
   ```

4. Open:
   - `http://127.0.0.1:3131`

## Environment Variables

See `.env.example` for all current options.

Main settings:
- `OPENROUTER_API_KEY` (required)
- `VALIDATOR_MODEL`
- `EXECUTOR_MODEL`
- `IP_HASH_SALT` (required)
- `COOLDOWN_MINUTES`
- `RATE_LIMIT_ENABLED`
- `MAX_EDIT_DELTA`
- `MAX_PAGE_DEPTH`
- `PORT`
- `HOST`
- `LOG_LEVEL`
- `CANVAS_DATA_DIR`
- `CANVAS_ADMIN_TOKEN` (optional rollback auth)

## Scripts

- `npm run dev` - start with file watch
- `npm run build` - compile TypeScript to `dist/`
- `npm start` - run compiled server
- `npm test` - run test suite
- `npm run typecheck` - run TypeScript checks

## Notes

- Data is stored in SQLite at `CANVAS_DATA_DIR/canvas.db`.
- `GET /log` is a read-only history page.
- `POST /api/rollback` can be protected with `CANVAS_ADMIN_TOKEN`.
