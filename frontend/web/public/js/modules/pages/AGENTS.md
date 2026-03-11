<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# frontend/web/public/js/modules/pages

## Purpose
Page-specific module controllers, lazy-loaded by the SPA router when the user navigates to a route. Each module exports a default object with `getHTML()`, `init()`, and `cleanup()` lifecycle methods. These modules are the direct controllers for the 21 admin and user-facing pages of the OpenMake LLM platform.

## Key Files
| File | Description |
|------|-------------|
| `admin.js` | Admin dashboard page — system status, user management quick actions, platform overview metrics. |
| `admin-metrics.js` | Detailed admin metrics page — charts and tables for system performance and usage analytics. |
| `agent-learning.js` | Agent learning configuration page — manage agent knowledge and learning parameters. |
| `alerts.js` | System alerts and notifications management page. |
| `analytics.js` | Usage analytics page — query volume, model usage, cost breakdowns, user activity charts. |
| `api-keys.js` | API key management page — create, list, revoke, and rotate Ollama API pool keys. |
| `audit.js` | Audit log page — searchable log of admin actions and security events. |
| `cluster.js` | Ollama cluster management page — node status, load distribution, health monitoring. |
| `custom-agents.js` | Custom agent builder page — create and configure industry-specific AI agents. |
| `developer.js` | Developer tools page — API documentation, request inspector, and debug utilities. |
| `documents.js` | Knowledge base documents page — upload, list, delete, and status for RAG document corpus. |
| `external.js` | External integrations page — configure external API connections and webhooks. |
| `guide.js` | User guide page — interactive onboarding and feature documentation. |
| `history.js` | Chat history page — browse, search, and manage past conversation sessions. |
| `memory.js` | Memory management page — view and manage the AI's long-term memory and context. |
| `password-change.js` | Password change page — secure password update form with current password verification. |
| `research.js` | Deep research page — configure and launch multi-step research queries. |
| `settings.js` | User settings page — profile, preferences, MCP tool toggles, model selection. Reads `window.MCP_TOOL_CATALOG` from `modules/settings.js`. |
| `skill-library.js` | Skill library page — browse and enable/disable AI skill modules. |
| `token-monitoring.js` | Token usage monitoring page — real-time and historical token consumption tracking. |
| `usage.js` | Usage summary page — personal usage statistics, quota status, billing information. |

## For AI Agents
### Working In This Directory
- Every module **must** export `export default { getHTML, init, cleanup }` — this is the contract the SPA router depends on.
- `getHTML()` returns an HTML string. All user content within it must be sanitized via `window.sanitizeHTML()` before insertion.
- `init()` is called after the HTML is mounted in the DOM. Attach event listeners here, not in `getHTML()`.
- `cleanup()` is called before navigating away. Remove event listeners, cancel pending requests, and clear timers to prevent memory leaks.
- Page modules **must not** use `import` statements — they are dynamically loaded and must access shared modules via `window.*` globals.
- Do not directly manipulate `document.body` or `document.head` — use the container element passed to `init()`.

### Testing Requirements
- After adding or modifying a page module, register its route in `js/spa-router.js` if not already present.
- Run `bash frontend/web/scripts/validate-modules.sh` to confirm the module is correctly referenced.
- E2E tests in `tests/e2e/` cover critical page flows; add coverage for new pages when practical.

### Common Patterns
- `getHTML()` returns a template literal string with the full page markup.
- `init(container)` receives the mounted DOM container element.
- Data fetching uses `window.apiClient.get('/api/...')` — never raw fetch.
- Charts use `window.Chart` (Chart.js UMD loaded globally) within `init()` after DOM is ready.
- Admin pages check user role via `window.getUser()?.role === 'admin'` and redirect if unauthorized.

## Dependencies
### Internal
- `modules/api-client.js` — all HTTP calls via `window.apiClient`
- `modules/state.js` — reads `window.AppState` for user preferences and mode flags
- `modules/sanitize.js` — `window.sanitizeHTML()` for XSS-safe rendering
- `modules/settings.js` — `window.MCP_TOOL_CATALOG`, `window.toggleMCPTool` (used by `settings.js`)
- `spa-router.js` — loads these modules and calls their lifecycle methods

### External
- `js/vendor/chart.umd.min.js` — Chart.js available as `window.Chart` on analytics/metrics pages

<!-- MANUAL: -->
