<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# ui — CLI Terminal Presentation Utilities

## Purpose
Provides terminal UI utilities for the CLI entry point (`cli.ts`) and commands (`commands/`). `banner.ts` renders the application banner on startup. `spinner.ts` shows an animated progress spinner during long-running operations like LLM streaming. `highlight.ts` applies syntax highlighting to code output in the terminal using ANSI escape codes.

## Key Files
| File | Description |
|------|-------------|
| `banner.ts` | ASCII art application banner rendered on CLI startup |
| `spinner.ts` | Animated terminal spinner for streaming/loading states |
| `highlight.ts` | ANSI syntax highlighting for code blocks in terminal output |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- These utilities are CLI-only — do not import them in server-side code paths (HTTP handlers, services, WebSocket)
- Spinner must be stopped (`.stop()` or `.succeed()`/`.fail()`) in all exit paths, including error paths
- `highlight.ts` should detect language from fenced code block markers when possible
- Terminal width detection should use `process.stdout.columns` with a sensible fallback (80)

### Testing Requirements
- Terminal UI is primarily tested via manual CLI invocation
- Unit test spinner start/stop state transitions if complex logic is added

### Common Patterns
- Spinner usage: `const s = spinner.start('Generating...'); ... s.succeed('Done'); s.fail('Error')`
- Highlight: `highlight.code(content, 'typescript')` → ANSI-colored string
- Banner: called once at process start in `cli.ts`

## Dependencies
### Internal
- Used by: `commands/explain.ts`, `commands/generate.ts`, `commands/review.ts`, `cli.ts`

### External
- `ora` or `cli-spinners` — Spinner animation (check actual import in `spinner.ts`)
- `chalk` or `ansi-colors` — ANSI color codes
- `highlight.js` or `shiki` — Syntax highlighting (check actual import)

<!-- MANUAL: -->
