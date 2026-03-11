<!-- Parent: ../../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# errors — Custom Error Classes

## Purpose
Defines typed custom error classes for infrastructure-level failures that require specific handling by callers. Each error class extends `Error` with a meaningful name and carries structured context. These errors are thrown by `cluster/`, `ollama/`, and are caught in `middlewares/` error handler or service-level try/catch blocks to produce appropriate HTTP responses or retry logic.

## Key Files
| File | Description |
|------|-------------|
| `circuit-open.error.ts` | Thrown when a cluster node's circuit breaker is in OPEN state |
| `key-exhaustion.error.ts` | Thrown when all API keys in the pool are on cooldown |
| `quota-exceeded.error.ts` | Thrown when a user's token/request quota is exceeded |
| `all-nodes-failed.error.ts` | Thrown when all cluster nodes are unreachable or circuit-open |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- Error classes should carry the minimum context needed for the catcher to act: node URL, key index, user ID
- Never catch these errors and re-throw as generic `Error` — the type information is used by callers
- Add a new error class here whenever a new infrastructure failure mode is introduced; do not overload existing classes
- All error classes must set `this.name = 'ClassName'` in the constructor for readable stack traces

### Testing Requirements
- Errors are simple classes; test that `instanceof` checks work and properties are set correctly
- Primary test coverage comes from the modules that throw these errors

### Common Patterns
- Pattern: `class CircuitOpenError extends Error { constructor(public nodeUrl: string) { super(...); this.name = 'CircuitOpenError'; } }`
- Catch in service layer: `catch (err) { if (err instanceof KeyExhaustionError) { ... } }`
- Map to HTTP status in error handler middleware: `CircuitOpenError` → 503, `QuotaExceededError` → 429

## Dependencies
### Internal
- Thrown by: `cluster/circuit-breaker.ts`, `ollama/api-key-manager.ts`, `services/ChatService.ts`
- Caught by: `middlewares/setup.ts` (global error handler), service-level try/catch

### External
- None — only Node.js built-in `Error`

<!-- MANUAL: -->
