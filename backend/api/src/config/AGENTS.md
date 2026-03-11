<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# config — Application Configuration

## Purpose
Centralized, type-safe application configuration loaded from environment variables. `env.ts` uses Zod to validate all required environment variables at startup, failing fast with descriptive errors if any are missing or malformed. Other files provide domain-specific constants: model name defaults, runtime limits (max tokens, context window sizes), pricing tables, and timeout values. All configuration is read-only after initialization.

## Key Files
| File | Description |
|------|-------------|
| `env.ts` | Loads `.env`, validates with Zod, exports typed `config` object |
| `constants.ts` | Application-wide constants (API versions, default values, magic numbers) |
| `model-defaults.ts` | Default model names per profile (Default/Pro/Fast/Think/Code/Vision/Auto) |
| `runtime-limits.ts` | Max tokens, max context window, max concurrent requests per tier |
| `pricing.ts` | Token pricing tables per model for usage tracking |
| `timeouts.ts` | Timeout values (ms) for LLM calls, DB queries, HTTP requests, WebSocket pings |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- `env.ts` is the single source of truth for all environment variable access — never read `process.env` directly elsewhere
- Model names in `model-defaults.ts` correspond to `OMK_ENGINE_*` env vars; the env var takes precedence at runtime
- Adding a new env var requires: (1) add to `env.ts` Zod schema, (2) add to `.env.example`, (3) document in `CLAUDE.md`
- `runtime-limits.ts` values are per-tier; free/pro/enterprise tiers have separate limits

### Testing Requirements
- Test Zod validation by providing invalid env values and asserting startup failure
- `model-defaults.ts` and constants do not need separate tests — they are covered by integration tests

### Common Patterns
- Import: `import { config } from '@/config/env'`
- Never destructure config at module load time; access `config.X` at call time to allow test overrides
- Timeout constants should be named `*_TIMEOUT_MS` for clarity

## Dependencies
### Internal
- Consumed by virtually every other module; it is the lowest-level dependency

### External
- `zod` — Environment variable schema validation
- `dotenv` — `.env` file loading

<!-- MANUAL: -->
