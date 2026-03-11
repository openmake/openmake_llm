<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# utils — Cross-Cutting Utilities

## Purpose
Provides shared utilities used across the entire backend: structured logging via Winston (`logger.ts`), standardized API response formatting (`api-response.ts`), global error handler integration (`error-handler.ts`), user input sanitization for XSS prevention (`input-sanitizer.ts`), database query helpers (`db-helpers.ts`), request context propagation (`request-context.ts`), and JWT token cleanup scheduling (`token-cleanup.ts`).

## Key Files
| File | Description |
|------|-------------|
| `logger.ts` | Winston logger factory: `createLogger('ModuleName')` with structured JSON output |
| `api-response.ts` | `success(data, meta?)` and `error(message, code?, details?)` response helpers |
| `error-handler.ts` | Express global error handler: maps error types to HTTP status codes |
| `input-sanitizer.ts` | XSS sanitization for user-provided strings before DB storage or rendering |
| `db-helpers.ts` | SQL query building helpers: pagination, sorting, dynamic WHERE clauses |
| `request-context.ts` | AsyncLocalStorage-based request context for tracing and logging correlation |
| `token-cleanup.ts` | Scheduled job to purge expired JWT entries from the token blacklist table |

## Subdirectories
_None_ (tests in `__tests__/` at `src/` level)

## For AI Agents
### Working In This Directory
- Always use `createLogger('ModuleName')` — never use `console.log` in production code
- `api-response.ts` helpers must be used for all HTTP responses to ensure consistent envelope format
- `input-sanitizer.ts` must be called on all user-provided strings before storage or rendering — this is the primary XSS defense
- `db-helpers.ts` pagination helper must use parameterized LIMIT/OFFSET, never string interpolation
- `request-context.ts` provides correlation IDs — set at middleware layer, read in services and logger

### Testing Requirements
- Logger tests: verify log levels, structured fields, module name prefix
- Error handler tests: verify correct status codes for each custom error type
- Sanitizer tests: verify XSS payloads are neutralized; verify legitimate content is preserved
- Run `npm run test:bun`

### Common Patterns
- Logger: `const logger = createLogger('ChatService'); logger.info('Processing', { userId, model })`
- Response: `res.json(success({ messages }, { total: count }))` or `res.status(400).json(error('Invalid input'))`
- Sanitize: `const clean = sanitizeInput(req.body.message)` before storage or LLM prompt injection

## Dependencies
### Internal
- `config/env.ts` — Log level configuration
- `errors/` — Custom error types mapped in `error-handler.ts`
- `data/models/token-blacklist.ts` — Target of `token-cleanup.ts` scheduled job

### External
- `winston` — Structured logging
- `dompurify` / `sanitize-html` — HTML/XSS sanitization (check actual import in `input-sanitizer.ts`)
- `async_hooks` (Node built-in) — `AsyncLocalStorage` for `request-context.ts`

<!-- MANUAL: -->
