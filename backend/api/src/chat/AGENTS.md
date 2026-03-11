<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# chat — Chat Pipeline

## Purpose
Implements the full chat processing pipeline from raw user query to model-ready prompt. Stages: (1) query classification via `llm-classifier.ts` (9 QueryTypes, backed by a 2-layer semantic cache), (2) brand profile resolution via `profile-resolver.ts` (7 profiles: Default, Pro, Fast, Think, Code, Vision, Auto), (3) model selection via `model-selector.ts`, (4) domain routing via `domain-router.ts`, (5) context engineering via `context-engineering.ts` (4-Pillar Framework), and (6) prompt assembly via `prompt-templates.ts`. The `request-handler.ts` orchestrates the full pipeline and hands off to `ChatService`.

## Key Files
| File | Description |
|------|-------------|
| `llm-classifier.ts` | LLM-based query classifier with 9 QueryTypes; uses L1 exact + L2 cosine-similarity cache |
| `semantic-cache.ts` | 2-layer semantic cache: L1 exact hash match, L2 cosine-similarity via embeddings |
| `model-selector.ts` | Maps QueryType + profile to concrete Ollama model name |
| `profile-resolver.ts` | Resolves brand model profile (Default/Pro/Fast/Think/Code/Vision/Auto) from request context |
| `domain-router.ts` | Routes query to domain-specific prompt context based on classification |
| `prompt-templates.ts` | Assembles final system prompts from templates, domain context, and skill injections |
| `context-engineering.ts` | 4-Pillar Framework: context window optimization, token budget management |
| `request-handler.ts` | Orchestrates the full pipeline; bridges WebSocket handler to ChatService |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- The classification pipeline is stateless and side-effect-free; each step receives and returns plain objects
- `semantic-cache.ts` depends on `EmbeddingService` for L2 similarity — changes to embedding models affect cache hit rates
- `model-selector.ts` reads from `config/model-defaults.ts`; never hardcode model names in this directory
- The 4-Pillar context engineering applies token budgeting — respect the `maxContextTokens` limit
- QueryTypes: `FACTUAL`, `CREATIVE`, `CODE`, `ANALYSIS`, `CONVERSATIONAL`, `RESEARCH`, `VISION`, `MATH`, `TRANSLATION`

### Testing Requirements
- Classifier tests must cover all 9 QueryTypes with representative prompts
- Semantic cache tests must verify L1 hit, L2 hit, and full miss paths
- Run `npm run test:bun` — tests in `backend/api/src/__tests__/`

### Common Patterns
- Pipeline functions are pure: `classify(query) → QueryType`, `selectModel(type, profile) → modelName`
- Cache keys are normalized: lowercase, whitespace-trimmed, punctuation-stripped
- The 2-layer cache always tries L1 first; only compute embeddings on L1 miss

## Dependencies
### Internal
- `services/EmbeddingService.ts` — Embedding vectors for L2 semantic cache
- `config/model-defaults.ts` — Model name mappings per profile
- `ollama/client.ts` — LLM calls for query classification
- `agents/index.ts` — Agent routing result fed into domain-router
- `cache/index.ts` — Backing LRU store for semantic cache

### External
- No direct external dependencies beyond project-level `axios`, `winston`

<!-- MANUAL: -->
