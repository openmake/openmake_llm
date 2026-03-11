<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# chat-strategies — Pluggable Chat Strategy Implementations

## Purpose
Implements the Strategy pattern for chat response generation. Each file is a self-contained strategy that `ChatService` selects based on the active mode flags in the request. `direct.ts` is the baseline single-model response. `a2a.ts` runs parallel Agent-to-Agent generation and merges results. `discussion.ts` orchestrates the multi-agent debate via `agents/discussion-engine.ts`. `deep-research.ts` delegates to `DeepResearchService`. `agent-loop.ts` runs the tool-calling agentic loop via `ollama/agent-loop.ts`.

## Key Files
| File | Description |
|------|-------------|
| `direct.ts` | Direct single-model response strategy — baseline chat |
| `a2a.ts` | Agent-to-Agent parallel generation: spawns N clients, merges outputs |
| `discussion.ts` | Multi-agent discussion strategy via `discussion-engine.ts` |
| `deep-research.ts` | Deep research strategy — delegates to `DeepResearchService` |
| `agent-loop.ts` | Tool-calling agentic loop strategy — delegates to `ollama/agent-loop.ts` |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- All strategies must implement the same interface: `execute(context: ChatContext): AsyncIterable<string>` (or equivalent streaming interface)
- `a2a.ts` spawns multiple `OllamaClient` instances; each gets a separate API key via round-robin — call `createOllamaClient()` N times sequentially
- Strategies must not store state between calls — they receive all context in the `ChatContext` parameter
- Adding a new strategy requires: (1) implement the strategy file here, (2) register it in `ChatService.ts` strategy selection logic, (3) add the trigger flag to the chat request schema

### Testing Requirements
- Mock `OllamaClient` to return deterministic streaming chunks
- Test strategy selection in `ChatService` unit tests
- Run `npm run test:bun`

### Common Patterns
- Strategy interface: `interface ChatStrategy { execute(ctx: ChatContext, onChunk: (token: string) => void): Promise<void> }`
- `ChatService` selection: `if (ctx.discussionMode) return new DiscussionStrategy(); if (ctx.deepResearchMode) return new DeepResearchStrategy(); ...`
- A2A merge: concatenate outputs with section separators, then optionally run a synthesis prompt

## Dependencies
### Internal
- `ollama/client.ts` — LLM inference for direct and a2a strategies
- `ollama/agent-loop.ts` — Agent loop execution
- `agents/discussion-engine.ts` — Discussion orchestration
- `services/DeepResearchService.ts` — Deep research execution
- `mcp/tool-router.ts` — Tool calls in agent-loop strategy

### External
- None beyond project-level dependencies

<!-- MANUAL: -->
