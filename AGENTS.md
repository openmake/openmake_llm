# Repository Guidelines

## Project Structure & Module Organization
This repository is organized as npm workspaces:
- `backend/api`: TypeScript API server (Express, WebSocket, data layer, MCP integrations). Main source is in `backend/api/src`, with tests in `backend/api/src/__tests__` and `backend/api/src/mcp/__tests__`.
- `frontend/web`: Vite-powered web UI. Primary runtime assets live in `frontend/web/public` (`js/`, `css/`, `images/`), with helper scripts in `frontend/web/scripts`.
- `services/database`: SQL initialization and migration files (`init/`, `migrations/`).
- `tests/e2e`: cross-app Playwright tests (`api-routes`, `external-keys`, `gdpr-*`, `mcp-server-ingest`, `skill-creator`, `alert-dashboard-stats` 등).

## Build, Test, and Development Commands
- `npm run dev`: run backend and frontend together.
- `npm run dev:api` / `npm run dev:frontend`: run one workspace only.
- `npm run build`: build backend (`tsc`) and run frontend module validation.
- `npm run lint`: run ESLint across the repo.
- `npm --workspace backend/api run test`: run backend Jest tests.
- `npm --workspace backend/api run test:coverage`: generate coverage (`text`, `lcov`, `html`).
- `npm run test:e2e`: run Playwright end-to-end tests.

## Coding Style & Naming Conventions
- Language: TypeScript (backend) and ES modules (frontend JS).
- Indentation: 4 spaces; keep existing quote style (single quotes in TS, mixed in legacy frontend JS).
- Backend naming patterns:
  - Routes/schemas/utilities: kebab-case filenames (for example `api-keys.routes.ts`).
  - Service/class files: PascalCase where class-oriented (for example `AuditService.ts`).
- Run `npm run lint` before opening a PR. ESLint warns on unused vars unless prefixed with `_`.

## Testing Guidelines
- Backend uses Jest with `ts-jest`; test files should use `*.test.ts` or `*.spec.ts`.
- Keep unit tests close to code under `backend/api/src/__tests__` (or module-local `__tests__`).
- For behavior changes in routing or response logic, also run:
  - `npm --workspace backend/api run eval:routing`
  - `npm --workspace backend/api run eval:response`

## Commit & Pull Request Guidelines
- Follow Conventional Commits seen in history: `feat: ...`, `fix: ...`, `refactor(scope): ...`, `docs(scope): ...`.
- Keep commits focused and scoped to one change.
- PRs should include:
  - clear summary and risk/impact notes,
  - linked issue (if applicable),
  - test evidence (command list and results),
  - screenshots for UI changes.

## Security & Configuration Tips
- Use `.env.example` as the baseline; never commit real secrets in `.env`.
- When changing schema/data behavior, add or update SQL migrations under `services/database/migrations` with sequential numeric prefixes.
