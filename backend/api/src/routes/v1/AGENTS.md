<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# v1 — Versioned API Routes

## Purpose
Houses route modules for the versioned `/api/v1/` prefix. Version 1 routes provide a stable, explicitly versioned surface for external integrations and API key clients. Versioned routes follow the same patterns as unversioned routes but are frozen once published — breaking changes require a new version directory.

## Key Files
| File | Description |
|------|-------------|
| _(files vary — check directory for current v1 route modules)_ | Versioned route handlers under `/api/v1/` |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- Versioned routes are frozen after publication — never introduce breaking changes in `v1/`
- Add new endpoints as additive changes only; deprecate old ones with a warning response header before removal
- Follow the same middleware and schema patterns as the parent `routes/` directory
- API versioning strategy: new major behaviour goes in `v2/` (create the directory when needed)

### Testing Requirements
- All v1 routes must have request/response contract tests
- Run `npm run test:bun`; API contract tests via `npm run test:e2e`

### Common Patterns
- Same as parent `routes/` — `Router`, `requireAuth`, Zod validation, controller delegation
- Response envelope: `{ success: true, data: {...}, meta: { version: 'v1' } }`

## Dependencies
### Internal
- Same as `routes/` — auth, controllers, services, schemas

### External
- `express` — `Router`

<!-- MANUAL: -->
