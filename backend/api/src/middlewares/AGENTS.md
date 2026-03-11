<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# middlewares — Express Middleware Stack

## Purpose
Assembles and configures the full Express middleware stack. `setup.ts` mounts global middleware in the correct order: security headers (helmet), CORS, body parsing, static files, rate limiters, and the global error handler. Rate limiters are domain-specific: `chat-rate-limiter.ts` throttles chat WebSocket upgrades and REST chat endpoints, `api-key-limiter.ts` applies separate limits for API key authenticated requests. `validation.ts` provides reusable Zod-based request body validators. `rate-limit-headers.ts` injects standard `RateLimit-*` headers into responses.

## Key Files
| File | Description |
|------|-------------|
| `setup.ts` | Mounts all middleware in correct order; registers global error handler |
| `chat-rate-limiter.ts` | Per-user and per-IP rate limiting for chat endpoints |
| `api-key-limiter.ts` | Separate rate limit policy for API key authenticated requests |
| `validation.ts` | Zod-based request body validation middleware factory |
| `rate-limit-headers.ts` | Injects `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` headers |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- Middleware order in `setup.ts` is load-bearing — security headers must come before routes, rate limiters before auth
- Never modify CORS configuration without verifying the frontend origin list; incorrect CORS breaks all browser requests
- Rate limit values are in `config/constants.ts`; do not hardcode them in middleware files
- The global error handler (last middleware in `setup.ts`) must remain the final `app.use()` call

### Testing Requirements
- Rate limiter tests must verify that limits are applied per-user and per-IP separately
- Validation middleware tests: valid body passes through, invalid body returns 400 with Zod error details
- Run `npm run test:bun`

### Common Patterns
- Validation factory: `validate(schema)` returns Express middleware that calls `schema.parse(req.body)`
- Rate limiter uses `express-rate-limit` with a Redis or in-memory store
- Error handler signature: `(err, req, res, next)` — 4-argument form required by Express

## Dependencies
### Internal
- `config/constants.ts` — Rate limit values, CORS origins
- `utils/api-response.ts` — Error response formatting in global error handler
- `utils/logger.ts` — Error logging
- `schemas/` — Zod schemas passed to `validate()`

### External
- `helmet` — Security headers
- `cors` — CORS configuration
- `express-rate-limit` — Rate limiting
- `zod` — Request validation

<!-- MANUAL: -->
