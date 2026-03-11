<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# frontend/web/public/js/modules

## Purpose
Core application logic modules — the heart of the frontend business logic. Each file is a focused ES Module responsible for one domain: real-time chat, WebSocket lifecycle, authentication, centralized state, API communication, security, settings persistence, and more. Page-specific controllers live in the `pages/` subdirectory and are lazy-loaded by the SPA router.

## Key Files
| File | Description |
|------|-------------|
| `chat.js` | WebSocket real-time chat. Assembles the WS message payload from `AppState` (tools, mode flags, model selection) and handles streaming response rendering. |
| `websocket.js` | WebSocket connection lifecycle: connect, reconnect, heartbeat, and inbound message routing to registered handlers. |
| `auth.js` | JWT authentication: reads the HttpOnly cookie token, decodes claims, exposes `getUser()`, `logout()`, and role checks. |
| `state.js` | Centralized `AppState` singleton. Single source of truth for all runtime UI state: current route, enabled tools, chat mode flags, user preferences. |
| `sanitize.js` | XSS defense. Provides `sanitizeHTML()` — the mandatory wrapper for all user-generated content before it touches `innerHTML`. |
| `api-client.js` | HTTP client wrapping `fetch` with auth headers, error normalization, and JSON parsing. All REST calls go through this module. |
| `api-endpoints.js` | Centralized API route constants. Maps endpoint names to URL strings. Update here when backend routes change. |
| `settings.js` | User settings management. Defines `MCP_TOOL_CATALOG` (master tool list), `VIRTUAL_TOOL_MAP`, `loadMCPSettings`, `saveMCPSettings`, `toggleMCPTool`, and bidirectional sync between AppState and localStorage. |
| `session.js` | Chat session management: create, load, list, and switch sessions. Syncs session state with the backend. |
| `file-upload.js` | File attachment handling for chat: drag-and-drop, file picker, upload progress, and multipart form submission. |
| `ui.js` | Shared UI utilities: toast notifications, loading spinners, modal helpers, and DOM convenience functions. |
| `utils.js` | Pure utility functions: date formatting, string helpers, debounce/throttle, and other stateless utilities. |
| `error-handler.js` | Global error handling: catches unhandled promise rejections and errors, formats user-facing error messages. |
| `modes.js` | Chat input toolbar toggle buttons (Thinking, Web Search, Discussion, Deep Research). Manages button state, AppState sync, and `saveMCPSettings()` persistence. |
| `safe-storage.js` | localStorage wrapper with JSON serialization, error handling, and fallback for storage-disabled environments. |
| `constants.js` | Application-wide constants: default model names, timeout values, pagination limits, and feature flags. |
| `cluster.js` | Ollama cluster management UI logic: node status display, load balancing visualization. |
| `document.js` | Document/RAG management: upload, list, delete, and status display for knowledge base documents. |
| `guide.js` | Interactive user guide and onboarding tour logic. |
| `index.js` | Module barrel — re-exports commonly used symbols for convenient import by page modules. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `pages/` | 21 page-specific module controllers, lazy-loaded by the SPA router — see `pages/AGENTS.md` |

## For AI Agents
### Working In This Directory
- `sanitize.js` is a **hard security requirement** — never set `innerHTML` or `outerHTML` with user content without wrapping it in `sanitizeHTML()` first.
- `state.js` is the single source of truth for runtime state — do not store UI state in module-level variables when `AppState` is the right place.
- `api-client.js` must be used for all backend HTTP calls — do not use raw `fetch` directly in other modules.
- `api-endpoints.js` is the single source for URL strings — do not hardcode endpoint paths elsewhere.
- `settings.js` `MCP_TOOL_CATALOG` is the master tool definition — `pages/settings.js` reads from `window.MCP_TOOL_CATALOG`, so only update here.
- Modules that expose functions for inline `onclick` handlers must register them on `window.*` explicitly.

### Testing Requirements
- Unit tests for utility functions live in `backend/api/src/` (backend) — frontend modules currently lack unit tests; rely on E2E tests.
- After modifying `chat.js` or `websocket.js`, validate with E2E chat flow tests.
- After modifying `sanitize.js`, verify XSS vectors are still blocked.

### Common Patterns
- Modules export named functions and also assign critical ones to `window.*` for HTML handler compatibility.
- Async operations use `async/await` with `try/catch`; errors are routed through `error-handler.js`.
- Settings persistence uses `safe-storage.js` with the key `mcpSettings` for MCP tool state.
- `AppState` mutations use direct property assignment: `AppState.thinkingEnabled = true`.

## Dependencies
### Internal
- `css/design-tokens.css` — `ui.js` references token values for dynamic style calculations
- `components/unified-sidebar.js` — consumes `AppState.currentRoute` from `state.js`
- `spa-router.js` — calls page module `init()`/`cleanup()` lifecycle hooks

### External
- Browser `fetch` API (wrapped by `api-client.js`)
- Browser `WebSocket` API (used by `websocket.js`)
- Browser `localStorage` (wrapped by `safe-storage.js`)

<!-- MANUAL: -->
