<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# controllers — Express HTTP Controllers

## Purpose
Contains Express Router HTTP controllers for the main application domains: admin operations, authentication flows, cluster management, health checks, and session management. Controllers are thin — they parse and validate the request, delegate to the appropriate service, and format the response using `utils/api-response.ts`. No business logic lives here.

## Key Files
| File | Description |
|------|-------------|
| `admin.controller.ts` | Admin operations: user management, system stats, audit log access |
| `auth.controller.ts` | Auth flows: login, logout, token refresh, OAuth callback handling |
| `cluster.controller.ts` | Cluster node management: add/remove nodes, view health status |
| `health.controller.ts` | Health check endpoint: DB ping, Ollama reachability, uptime |
| `session.controller.ts` | Session management: list, retrieve, and delete chat sessions |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- Controllers must not contain business logic — delegate to `services/` or `data/repositories/`
- Always apply `requireAuth` / `requireAdmin` middleware at the router level, not inside controller functions
- Use `success()` and `error()` from `utils/api-response.ts` for consistent response formatting
- Never change existing route response shapes — frontend depends on stable API contracts

### Testing Requirements
- Controller tests use supertest against the mounted Express app
- Mock service and repository calls; do not hit real DB or Ollama in controller unit tests
- Run `npm run test:bun` or `npx jest --testPathPattern=controllers`

### Common Patterns
- Controller signature: `async (req: Request, res: Response, next: NextFunction) => void`
- Wrap async logic in try/catch and call `next(err)` on failure
- Validate request body with Zod schemas from `schemas/` before processing

## Dependencies
### Internal
- `services/` — Business logic delegation
- `data/repositories/` — Direct DB access for simple CRUD operations
- `utils/api-response.ts` — `success()`, `error()` response helpers
- `auth/middleware.ts` — Applied at router level before controllers
- `schemas/` — Request body validation

### External
- `express` — `Request`, `Response`, `NextFunction` types

<!-- MANUAL: -->
