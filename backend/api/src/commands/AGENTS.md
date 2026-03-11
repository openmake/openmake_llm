<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# commands — CLI LLM Code Operations

## Purpose
Provides CLI commands that use the LLM to perform code-related operations: explaining code snippets, generating code from natural language descriptions, and reviewing code for issues. These commands are invoked via `cli.ts` and are designed for terminal use, not HTTP API exposure. Output is formatted for terminal display using utilities from `ui/`.

## Key Files
| File | Description |
|------|-------------|
| `explain.ts` | CLI command: send a code snippet to the LLM and stream an explanation |
| `generate.ts` | CLI command: generate code from a natural language description |
| `review.ts` | CLI command: review code for bugs, style issues, and improvements |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- These commands are CLI-only; do not expose them as HTTP endpoints
- Output should be streamed to stdout using `ui/spinner.ts` and `ui/highlight.ts` for visual feedback
- Commands call `OllamaClient` directly; they do not go through the chat pipeline (no classification, no profile resolution)
- Keep commands focused: one LLM call per command, no chaining

### Testing Requirements
- Commands are primarily tested via manual CLI invocation
- Mock `OllamaClient` for unit tests to avoid live LLM calls
- Run `npm run test:bun` for any unit test coverage

### Common Patterns
- Read input from stdin or CLI args; write output to stdout
- Use `ui/spinner.ts` to show progress during LLM streaming
- Handle errors gracefully: print user-friendly message, exit with non-zero code

## Dependencies
### Internal
- `ollama/client.ts` — LLM inference calls
- `ui/spinner.ts`, `ui/highlight.ts`, `ui/banner.ts` — Terminal output formatting
- `config/env.ts` — Model configuration

### External
- `commander` or similar CLI arg parsing (check `cli.ts` for the exact library used)

<!-- MANUAL: -->
