<!-- Parent: ../../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# domains/chat — Chat Domain

## Purpose
Unified domain module for the entire chat subsystem. Consolidates the chat processing pipeline, strategy pattern implementations, and ChatService orchestrator into a single cohesive domain. Previously scattered across `chat/`, `services/ChatService.ts`, `services/chat-service/`, and `services/chat-strategies/`.

## Key Files
| File | Description |
|------|-------------|
| `service.ts` | Central ChatService orchestrator — agent routing, model selection, context assembly, strategy dispatch |

## Subdirectories
| Directory | Description |
|-----------|-------------|
| `pipeline/` | Chat processing pipeline: query classification, model selection, profile resolution, prompt assembly, semantic cache |
| `strategies/` | Pluggable chat strategies: direct, a2a, discussion, deep-research, agent-loop |
| `service/` | ChatService internals: barrel re-exports, types, formatters, metrics |

## For AI Agents
### Working In This Directory
- `service.ts` is the central orchestrator — it imports from `pipeline/`, `strategies/`, and `service/` subdirectories
- The `pipeline/` contains stateless, side-effect-free classification and prompt assembly functions
- Each strategy in `strategies/` is self-contained and implements a common interface
- The `service/` barrel (`service/index.ts`) re-exports ChatService + types for external consumers
- External code should import from `domains/chat/service/` (barrel) or `domains/chat/pipeline/` — never from `service.ts` directly

### Testing Requirements
- Tests are in `backend/api/src/__tests__/` — import paths use `../domains/chat/pipeline/` and `../domains/chat/strategies/`
- Run `npm run test:bun` or `npx jest` for unit tests
- Build verification: `cd backend/api && npx tsc --noEmit`

### Common Patterns
- Pipeline functions are pure: `classify(query) -> QueryType`, `selectModel(type, profile) -> modelName`
- Strategies implement: `execute(context) -> result` with streaming support
- ChatService selects strategy based on request flags: discussionMode, deepResearchMode, a2aMode, agentLoopMode

## Dependencies
### Internal
- `agents/` — Agent routing, discussion engine, system prompts
- `ollama/` — LLM client, model types, agent loop
- `services/` — DeepResearchService, RAGService, EmbeddingService
- `config/` — Environment, runtime limits, model defaults
- `mcp/` — Tool router, tool tiers, MCP client
- `data/` — Conversation DB, user manager

### External
- No direct external dependencies beyond project-level packages

<!-- MANUAL: -->
