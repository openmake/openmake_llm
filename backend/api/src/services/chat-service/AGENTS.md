<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# chat-service — ChatService Internals

## Purpose
Contains the internal modules that `ChatService.ts` delegates to, split out for maintainability. This subdirectory holds focused single-responsibility modules for specific ChatService concerns: tool allowlist computation, conversation history management, language detection, and response post-processing. All modules here are private to `ChatService` — they are not exported from `services/index.ts`.

## Key Files
| File | Description |
|------|-------------|
| _(check directory for current files — common examples below)_ | |
| `tool-allowlist.ts` | Computes the allowed tool list from user tier and `enabledTools` flags |
| `history-manager.ts` | Conversation history trimming to fit context window |
| `language-detector.ts` | Detects user language from message text; respects explicit `language` preference |
| `response-processor.ts` | Post-processes LLM output: citation injection, safety filtering |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- These modules are internal implementation details of `ChatService` — import them only from `ChatService.ts`
- Keep each module focused on a single concern; resist adding cross-cutting logic here
- History trimming must preserve the system prompt and the most recent N turns within the token budget
- Language detection falls back to English if confidence is low

### Testing Requirements
- Unit test each module independently; mock dependencies
- Tool allowlist tests must cover free/pro/enterprise tier combinations
- Run `npm run test:bun`

### Common Patterns
- Pure functions preferred: `computeToolAllowlist(tier, enabledTools, builtInTools): Tool[]`
- History trimmer: `trimHistory(messages, maxTokens): Message[]` — removes oldest turns first
- Language detector: returns ISO 639-1 code or `'en'` as default

## Dependencies
### Internal
- `mcp/tool-tiers.ts` — Tier definitions for tool allowlist computation
- `config/runtime-limits.ts` — Max token budgets for history trimming
- `i18n/` — Language code validation

### External
- `franc` or similar — Language detection library (if used)

<!-- MANUAL: -->
