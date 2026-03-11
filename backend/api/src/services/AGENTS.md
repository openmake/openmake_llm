<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# services — Core Business Logic

## Purpose
Houses the primary business logic services that orchestrate the application's core features. `ChatService.ts` is the central coordinator: it resolves allowed MCP tools, selects the chat strategy (direct, A2A, discussion, deep-research, agent-loop), manages conversation history, and streams responses. `RAGService.ts` retrieves relevant document chunks for augmented generation. `EmbeddingService.ts` generates vector embeddings for semantic search and cache. `MemoryService.ts` manages long-term user memory. `DeepResearchService.ts` orchestrates multi-step research with web search. `AuditService.ts` records security-relevant events. `Reranker.ts` re-scores RAG retrieval results for relevance.

## Key Files
| File | Description |
|------|-------------|
| `ChatService.ts` | Central chat orchestrator: tool resolution, strategy dispatch, history management, streaming |
| `RAGService.ts` | Retrieval-Augmented Generation: chunk retrieval, context injection |
| `EmbeddingService.ts` | Vector embedding generation for semantic search and L2 cache |
| `MemoryService.ts` | Long-term user memory: store, retrieve, summarize |
| `DeepResearchService.ts` | Multi-step research orchestration with web search and synthesis |
| `AuditService.ts` | Security audit event recording (login, key usage, admin actions) |
| `Reranker.ts` | Cross-encoder reranking of RAG retrieval candidates |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `chat-service/` | ChatService internals split into focused modules (see `chat-service/AGENTS.md`) |
| `chat-strategies/` | Pluggable chat strategy implementations: direct, a2a, discussion, deep-research, agent-loop (see `chat-strategies/AGENTS.md`) |
| `deep-research/` | DeepResearchService internals: query planning, search execution, synthesis (see `deep-research/AGENTS.md`) |

## For AI Agents
### Working In This Directory
- `ChatService` is the single entry point for all chat processing — do not call `OllamaClient` directly from routes or controllers
- Strategy selection is based on `enabledTools` flags in the chat request; see `chat-strategies/` for individual strategy implementations
- `EmbeddingService` is shared by `RAGService`, `MemoryService`, and `chat/semantic-cache.ts` — changes affect all three
- `AuditService.ts` writes must be fire-and-forget (non-blocking) — never `await` them in request paths

### Testing Requirements
- Mock `OllamaClient` and repository calls in service unit tests
- Integration tests for `ChatService` use a real DB and mock Ollama
- Run `npm run test:bun`; see `backend/api/src/__tests__/` for existing test patterns

### Common Patterns
- Service constructor injection: `constructor(private ollamaClient: OllamaClient, private ragService: RAGService, ...)`
- Strategy pattern: `ChatService` selects a strategy object and calls `strategy.execute(context)`
- Streaming: services call `onChunk(token)` callbacks; they do not write directly to `res`

## Dependencies
### Internal
- `ollama/client.ts` — LLM inference
- `data/repositories/` — All persistence
- `mcp/tool-router.ts` — Tool execution
- `chat/` — Pipeline (classifier, model-selector, context-engineering)
- `agents/index.ts` — Agent routing
- `config/` — Model defaults, limits, timeouts

### External
- `axios` — HTTP for web search in `DeepResearchService`
- `zod` — Input validation

<!-- MANUAL: -->
