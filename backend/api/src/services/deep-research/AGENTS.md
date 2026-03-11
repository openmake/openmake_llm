<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# deep-research — DeepResearchService Internals

## Purpose
Contains the internal modules for `DeepResearchService.ts`: query planning (decomposing a research question into sub-queries), search execution (parallel web searches for each sub-query), result deduplication and ranking, and final synthesis (combining ranked results into a coherent research report). These modules implement a multi-step research pipeline that can run for tens of seconds; progress is broadcast via WebSocket.

## Key Files
| File | Description |
|------|-------------|
| _(check directory for current files — common examples below)_ | |
| `query-planner.ts` | Decomposes research question into N focused sub-queries using LLM |
| `search-executor.ts` | Parallel web search execution for each sub-query |
| `result-ranker.ts` | Deduplicates and ranks search results by relevance |
| `synthesizer.ts` | Combines ranked results into a structured research report via LLM |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- Sub-query searches run in parallel (Promise.allSettled) — individual search failures should not abort the whole pipeline
- The query planner uses the LLM; cache plans keyed on normalized research question to avoid redundant calls
- Synthesis prompts are large (many search results); respect the context window limit from `config/runtime-limits.ts`
- Progress events (`{ stage, percent, subQuery }`) are emitted throughout and broadcast via WebSocket

### Testing Requirements
- Mock web search calls; do not make real HTTP requests in tests
- Test parallel execution: verify all sub-queries are searched concurrently
- Test synthesis with truncated input when results exceed context window
- Run `npm run test:bun`

### Common Patterns
- Pipeline: `planQueries(question) → searchAll(subQueries) → rankResults(results) → synthesize(ranked)`
- Progress broadcast: `emitProgress({ stage: 'searching', percent: 40, subQuery: 'current query' })`
- Error isolation: use `Promise.allSettled` for parallel searches; filter out rejected results

## Dependencies
### Internal
- `ollama/client.ts` — Query planning and synthesis LLM calls
- `mcp/web-search.ts` — Individual web search execution
- `security/ssrf-guard.ts` — URL validation for fetched sources
- `config/runtime-limits.ts` — Context window limits for synthesis
- `sockets/ws-chat-handler.ts` — Progress event broadcasting

### External
- None beyond project-level `axios`

<!-- MANUAL: -->
