<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# mcp — Model Context Protocol

## Purpose
Implements the Model Context Protocol layer: 10+ built-in tools (vision OCR, web search, Firecrawl scraping, filesystem sandbox), external MCP server connections (stdio/SSE transport), tier-based access control, and a unified tool router. `tool-router.ts` merges built-in and external tools under a `::` namespace convention. `tool-tiers.ts` enforces free/pro/enterprise access. `unified-client.ts` is the singleton entry point combining the JSON-RPC 2.0 server, tool router, and server registry.

See `backend/api/AGENTS.md` for the full MCP architecture diagram and tool synchronization rules.

## Key Files
| File | Description |
|------|-------------|
| `tool-router.ts` | Unified routing for built-in and external tools; `::` namespace for external tools |
| `tool-tiers.ts` | `TOOL_TIERS` map and `canUseTool(tier, name)` access control |
| `server-registry.ts` | External MCP server connection registry backed by DB |
| `external-client.ts` | External MCP server client supporting stdio and SSE transports |
| `tools.ts` | Built-in tool definitions array (`builtInTools`) with handlers |
| `unified-client.ts` | Singleton `UnifiedMCPClient` — composes server, router, registry |
| `user-sandbox.ts` | Per-user data isolation context (`UserContext`) |
| `web-search.ts` | Web search tools: `web_search`, `fact_check`, `extract_webpage`, `research_topic` |
| `firecrawl.ts` | Firecrawl scraping tools (loaded conditionally on `FIRECRAWL_API_KEY`) |
| `sequential-thinking.ts` | `applySequentialThinking()` prompt injection (NOT a tool — no tier entry) |
| `filesystem.ts` | Sandboxed filesystem tools for user data access |
| `deep-research.ts` | Deep research MCP tool integration |
| `server.ts` | JSON-RPC 2.0 MCP server implementation |
| `types.ts` | `MCPTool`, `MCPToolResult`, `MCPToolDefinition` type definitions |
| `index.ts` | Barrel export of public API |

## Subdirectories
_None_ (tests are in `__tests__/` at the `src/` root level)

## For AI Agents
### Working In This Directory
- **When adding/modifying tools, update 3 places simultaneously**: `tools.ts` (handler), `tool-tiers.ts` (access), `frontend/web/public/js/modules/settings.js` (UI catalog)
- `sequential_thinking` is a prompt injection, NOT a tool — never add it to `TOOL_TIERS`
- Firecrawl tools are only included in `builtInTools` when `FIRECRAWL_API_KEY` is set — use conditional loading pattern from existing `firecrawl.ts`
- External tools use `serverName::toolName` convention; built-in tools use plain names
- `run_command`, `read_file`, `write_file` (unsandboxed) are **permanently deleted** — do not restore them

### Testing Requirements
- Tests in `__tests__/` cover `tool-tiers.ts` (access control) and `tool-router.ts` (routing logic)
- Mock external MCP server connections; do not require live external servers
- Run `npm run test:bun`

### Common Patterns
- Tool call routing: `toolRouter.callTool(toolName, args, userContext)` — handles namespace resolution
- Access check: `canUseTool(user.tier, toolName)` before routing
- New built-in tool template: `{ name, description, inputSchema, handler: async (args, ctx) => MCPToolResult }`

## Dependencies
### Internal
- `services/ChatService.ts` — Calls `getAllowedTools()` before model invocation
- `data/repositories/` — Server registry DB persistence
- `config/env.ts` — `FIRECRAWL_API_KEY`, tier settings
- `security/ssrf-guard.ts` — Applied in `web-search.ts` before outbound HTTP
- `ollama/api-key-manager.ts` — API key for web search calls

### External
- `@modelcontextprotocol/sdk` — MCP protocol types and transport
- `firecrawl-js` — Firecrawl API client (conditional)
- `axios` — HTTP for web search and extract tools

<!-- MANUAL: -->
