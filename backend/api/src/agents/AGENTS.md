<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# agents — Industry-Specialist Agent Routing

## Purpose
Provides 96 industry-specialist AI agents with a 2-stage routing system. Stage 1 uses intent-based topic analysis (`topic-analyzer.ts`) to identify the domain. Stage 2 uses TF-IDF keyword matching with synonym expansion (`keyword-router.ts`) for precise agent selection. Also includes a semantic LLM-based router (`llm-router.ts`), a multi-agent discussion engine (`discussion-engine.ts`), and a skill manager (`skill-manager.ts`) for agent capability injection. Agent definitions live in `industry-agents.json` (96 entries) and system prompts are organized under `prompts/`.

## Key Files
| File | Description |
|------|-------------|
| `index.ts` | Main entry: 2-stage routing coordinator, exports `routeToAgent()` |
| `keyword-router.ts` | TF-IDF scoring with synonym expansion for keyword-based agent selection |
| `llm-router.ts` | Semantic LLM-based routing fallback using embedding similarity |
| `topic-analyzer.ts` | Stage 1 intent classifier — maps query to domain topic |
| `skill-manager.ts` | Agent skill CRUD — attach/detach capabilities to agents |
| `discussion-engine.ts` | Multi-agent debate orchestration — parallel A2A generation + synthesis |
| `industry-agents.json` | 96 agent definitions with names, keywords, domains, and prompt refs |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `prompts/` | 17 industry prompt subdirectories (agriculture, business, creative, education, energy, engineering, finance, government, healthcare, hospitality, legal, logistics, media, real-estate, science, special, technology) |

## For AI Agents
### Working In This Directory
- Agent definitions in `industry-agents.json` are the source of truth for agent metadata; keep `keyword-router.ts` synonym maps in sync when adding agents
- The 2-stage routing order is fixed: topic analysis first, keyword matching second, LLM router as fallback — do not short-circuit
- `discussion-engine.ts` spawns multiple `OllamaClient` instances in parallel; each gets a separate API key via round-robin pool
- Skill injection happens before prompt assembly; check `skill-manager.ts` before modifying prompt templates

### Testing Requirements
- Tests live in `__tests__/` at the `src/` level and `mcp/__tests__/`
- Run `npm run test:bun` — test files matching `**/__tests__/**/*.test.ts`
- When adding a new agent, add a routing test to verify keyword matching

### Common Patterns
- Agent selection returns `AgentProfile | null`; callers must handle null (fall through to default agent)
- Synonym maps use lowercase arrays; expand conservatively to avoid false positives
- Discussion engine results are merged with a synthesis prompt before streaming to the client

## Dependencies
### Internal
- `ollama/client.ts` — LLM calls for llm-router and discussion-engine
- `chat/prompt-templates.ts` — System prompt assembly
- `services/ChatService.ts` — Consumes `routeToAgent()` result
- `data/repositories/skill` — Persists agent skill assignments

### External
- No direct npm dependencies beyond project-level `axios`, `winston`

<!-- MANUAL: -->
