<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# ollama — Ollama HTTP Client

## Purpose
Wraps the Ollama HTTP API with a production-ready client layer. `client.ts` provides the primary `OllamaClient` class with streaming support, bound to a specific API key index from the key pool. `api-key-manager.ts` manages the round-robin key pool with 5-minute cooldown on 429 errors. `connection-pool.ts` reuses HTTP connections. `agent-loop.ts` implements the tool-calling agentic loop (generate → parse tool calls → execute via MCP → continue). `api-usage-tracker.ts` records token consumption per request for quota enforcement.

See `backend/api/AGENTS.md` for the full API Key Pool architecture diagram.

## Key Files
| File | Description |
|------|-------------|
| `client.ts` | `OllamaClient` — streaming chat/generate, bound API key, axios interceptor for 429 retry |
| `api-key-manager.ts` | Singleton key pool: round-robin selection, 5-minute cooldown, `recordKeyFailure()`, `reportSuccess()` |
| `connection-pool.ts` | HTTP keep-alive connection pooling for Ollama requests |
| `agent-loop.ts` | Agentic tool-calling loop: generate → tool call parsing → MCP execution → continue |
| `api-usage-tracker.ts` | Token usage recording per request for quota tracking |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- `OllamaClient` instances bind to a key index at construction time — call `createOllamaClient()` (not `new OllamaClient()` directly) to get proper key assignment
- The 429 retry in the axios interceptor exchanges the bound key and retries once; multiple retries risk exhausting the pool
- `agent-loop.ts` has a maximum iteration limit to prevent infinite tool-call loops; do not remove it
- `api-key-manager.ts` is the **only** place where `OLLAMA_API_KEY_*` env vars are read; do not access them elsewhere
- Model names come from `config/model-defaults.ts` via the chat pipeline; `OllamaClient` accepts any model string

### Testing Requirements
- Mock axios in client tests; do not make real Ollama calls in unit tests
- Test key rotation: simulate 429 and verify key is replaced and request retries
- Test agent loop termination: verify max iterations guard works
- Run `npm run test:bun`

### Common Patterns
- Client creation: `const client = createOllamaClient()` — gets next available key
- Streaming: `client.chatStream(messages, model, onChunk)` — calls `onChunk` for each SSE token
- Key failure: `apiKeyManager.recordKeyFailure(index, 429)` — automatic, done in axios interceptor

## Dependencies
### Internal
- `config/env.ts` — `OLLAMA_HOST`, `OLLAMA_API_KEY_1..N`
- `config/model-defaults.ts` — Default model names
- `mcp/tool-router.ts` — Tool execution in `agent-loop.ts`
- `errors/key-exhaustion.error.ts` — Thrown when all keys are on cooldown
- `utils/logger.ts` — Request/response logging

### External
- `axios` — HTTP client with interceptors

<!-- MANUAL: -->
