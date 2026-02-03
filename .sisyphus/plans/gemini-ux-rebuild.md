# OpenMake.AI — Gemini-Style Unified UX Rebuild

## TL;DR

> **Quick Summary**: Complete UX restructuring of the OpenMake.AI chat platform from 23 separate HTML pages into a single-page application with Gemini-style unified interface — conversation-only sidebar with 3-state collapse, chat-centric hub with tool picker, and admin/tool panels as modals/overlays. All in vanilla JavaScript with no frameworks.
> 
> **Deliverables**:
> - 3 backend bug fixes (route ordering, mount conflicts, browser-side process.uptime)
> - Unified 3-state sidebar component (Full 280px → Icon 64px → Hidden 0px)
> - SPA router with History API and dynamic page module loading
> - 21 page modules (extracted from 22 HTML pages, agents.html already removed)
> - Chat-centric hub with tool picker bar below input
> - Admin/settings as modal/slide-out panels
> - Full browser verification of all features
> 
> **Estimated Effort**: XL (multi-week major rebuild)
> **Parallel Execution**: YES — 6 waves
> **Critical Path**: Bug Fixes → SPA Infrastructure → Sidebar → Page Module Conversion → Chat Hub → Final Verification

---

## Context

### Original Request
Complete Gemini-style UX rebuild (방안 C) of the OpenMake.AI platform. Convert 23 separate HTML pages into a unified SPA with conversation-only sidebar, 3-state icon/expand/hidden modes, chat-centric hub with tool picker, and admin panels as modals/overlays. Maintain existing dark theme + glassmorphism design. Vanilla JavaScript only.

### Interview Summary
**Key Discussions**:
- User chose 방안 C (Complete Gemini Restructuring) — most ambitious option
- Sidebar = conversation list ONLY (like Google Gemini), with icon-mode + hover-expand
- Tools accessible from chat input area via tool picker buttons
- Admin/settings as modals or slide-out panels
- login.html remains as a separate page (not SPA-ified)
- Korean language throughout the UI
- Use Stitch MCP for prototyping UI designs before implementation

**Research Findings**:
- **Sidebar System A** (index.html): 155-line inline HTML sidebar with logo, theme toggle, new chat, recent conversations list, page nav menu (from nav-items.js), user section, A2A agents section
- **Sidebar System B** (sidebar.js): SharedSidebar class (294 lines) — simpler nav-only sidebar used by 21 other pages
- **CSS Architecture**: 12 CSS files totaling ~4000+ lines. design-tokens.css is the foundation (580 lines). index.html loads 8 CSS files, other pages load 3
- **Page structure pattern**: All non-index pages follow `.layout > .sidebar + .sidebar-overlay + .main-content > .page-header + .content-area` layout
- **agents.html already removed** — redirects to `/`. Only 22 pages need conversion (21 + index.html as shell)
- **app.js monolith** (2858 lines) already has modular equivalents in `js/modules/` (state, auth, ui, websocket, chat, settings, utils, guide, sanitize) but hasn't migrated yet
- **nav-items.js**: 12 menu items + 8 admin items with iconify icons and `requireAuth` flags

### Metis Review
**Identified Gaps** (addressed):
- **CSS conflict risk**: When all pages load in one SPA, their inline styles could conflict → Solution: namespace all page-specific CSS with `.page-[name]` wrapper class
- **Script lifecycle**: Pages use DOMContentLoaded for initialization → Solution: Each module exports `init()` and `cleanup()` functions, called by the SPA router
- **Global state persistence**: app.js global variables (ws, chatHistory, etc.) must persist across navigation → Solution: Chat state stays in memory, module state resets on navigation
- **Navigation interception**: All existing `<a href="...">` and `window.location.href` calls need interception → Solution: Global click handler for internal links + override window.location for SPA routing
- **Service Worker**: Currently registered in index.html → Solution: Update caching strategy for SPA pattern
- **Dual agentRouter mount**: `/api/agents` mounted twice in server.ts → Solution: Rename monitoring router to `/api/agents-monitoring` or consolidate

---

## Work Objectives

### Core Objective
Transform OpenMake.AI from a multi-page application into a Gemini-style single-page application with conversation-focused sidebar and chat-centric hub, maintaining all existing functionality and dark theme aesthetic.

### Concrete Deliverables
1. Fixed backend bugs (3 issues)
2. `frontend/web/public/js/components/unified-sidebar.js` — New 3-state sidebar component
3. `frontend/web/public/js/spa-router.js` — History API-based SPA router
4. `frontend/web/public/js/modules/pages/*.js` — 21 page modules (one per converted page)
5. Updated `index.html` — SPA shell with sidebar, chat hub, and content area
6. Updated `style.css` + new CSS — Gemini-style layout with tool picker and panels
7. Updated `nav-items.js` — Route registry for SPA
8. All existing features working within SPA

### Definition of Done
- [x] All 180 backend tests pass: `cd backend/api && npm test` → 9 suites, 180 tests, 0 failures
- [x] Every page accessible via SPA routing and features functional
- [x] 3-state sidebar works (full/icon/hidden)
- [x] Tool picker in chat input area navigates to tools
- [x] Admin/settings open as modal/panel overlays
- [x] Browser back/forward works with History API
- [x] Mobile responsive layout works

### Must Have
- All 22 pages' functionality preserved within SPA
- 3-state sidebar (Full → Icon → Hidden)
- Hover-expand overlay behavior for icon mode
- Chat-centric hub as default landing view
- Tool picker below chat input
- History API routing with URL bookmarkability
- Korean language UI throughout
- Existing dark theme + glassmorphism maintained
- Backend bug fixes

### Must NOT Have (Guardrails)
- NO React, Vue, Angular, or any framework — vanilla JS only
- NO build tools (webpack, vite) — files served directly
- NO changes to backend API contracts (only bug fix routing)
- NO new features beyond what exists in current 23 pages
- NO removal of light theme support (even though dark is primary)
- NO changes to login.html (stays as separate page)
- NO breaking the deploy pipeline (scripts/deploy-frontend.sh)
- NO modifications to the 180 backend tests
- NO generic Inter/Roboto fonts — keep Pretendard + Outfit
- NO purple-gradient-on-white cliche (keep existing dark aesthetic)

---

## Verification Strategy (MANDATORY)

### Test Decision
- **Infrastructure exists**: YES (180 backend tests via bun test)
- **User wants tests**: YES (backend tests must pass + browser verification)
- **Framework**: bun test (backend), Playwright (frontend verification)
- **QA approach**: Backend tests + automated browser verification

### Backend Test Verification
```bash
cd backend/api && bun test
# Expected: 9 suites, 180 tests, 0 failures
```

### Frontend Verification (Playwright)
Each task includes browser verification steps using the Playwright skill for automated checking.

---

## Task Dependency Graph

| Task | Depends On | Reason |
|------|------------|--------|
| T0a: Fix agents.routes.ts | None | Independent backend bug fix |
| T0b: Fix server.ts mount order | None | Independent backend bug fix |
| T0c: Fix analytics.html uptime | None | Independent frontend bug fix |
| T1: Design sidebar in Stitch | None | Design exploration, no code deps |
| T2: Design chat hub in Stitch | None | Design exploration, no code deps |
| T3: Build SPA router | T0a, T0b, T0c | Router needs clean backend routes |
| T4: Build unified sidebar | T1, T3 | Needs design reference + router for navigation |
| T5: Update index.html SPA shell | T3, T4 | Needs router + sidebar components |
| T6: Convert tool pages | T5 | Needs SPA shell to load into |
| T7: Convert agent pages | T5 | Needs SPA shell to load into |
| T8: Convert monitoring pages | T5 | Needs SPA shell to load into |
| T9: Convert admin pages | T5 | Needs SPA shell to load into |
| T10: Convert utility pages | T5 | Needs SPA shell to load into |
| T11: Build chat hub + tool picker | T2, T5, T6 | Needs design + SPA shell + tool modules |
| T12: Build admin/settings panels | T9, T11 | Needs admin modules + hub integration |
| T13: CSS consolidation + polish | T4, T5, T6-T10 | Needs all modules to identify conflicts |
| T14: Integration testing + verification | T11, T12, T13 | Needs everything complete |
| T15: Deploy verification | T14 | Needs all tests passing |

## Parallel Execution Graph

```
Wave 1 (Start immediately — independent tasks):
├── T0a: Fix agents.routes.ts route ordering
├── T0b: Fix server.ts router mount order  
├── T0c: Fix analytics.html process.uptime
├── T1: Design sidebar UI in Stitch MCP
└── T2: Design chat hub + tool picker UI in Stitch MCP

Wave 2 (After Wave 1):
└── T3: Build SPA router (js/spa-router.js)

Wave 3 (After Wave 2 + T1):
├── T4: Build unified 3-state sidebar component
└── T5: Update index.html as SPA shell

Wave 4 (After Wave 3 — page conversions in parallel):
├── T6: Convert tool pages (canvas, research, mcp-tools)
├── T7: Convert agent pages (marketplace, custom-agents, agent-learning)
├── T8: Convert monitoring pages (cluster, usage, analytics, token-monitoring, admin-metrics)
├── T9: Convert admin pages (admin, audit, external, alerts, memory, settings, password-change)
└── T10: Convert utility pages (history, guide)

Wave 5 (After Wave 4):
├── T11: Build chat hub + tool picker integration
├── T12: Build admin/settings panel overlays
└── T13: CSS consolidation + visual polish

Wave 6 (After Wave 5):
├── T14: Integration testing + browser verification
└── T15: Deploy pipeline verification
```

**Critical Path**: T0a/T0b/T0c → T3 → T4+T5 → T6-T10 → T11+T12+T13 → T14 → T15
**Estimated Parallel Speedup**: ~50% faster than sequential (Wave 4 has 5 parallel tasks)

---

## TODOs

---

### - [x] T0a. Fix agents.routes.ts Route Ordering

  **What to do**:
  - In `backend/api/src/routes/agents.routes.ts`, move the `GET /:id` route (currently line 72) to AFTER all static/named routes
  - The issue: Express processes routes in order. `/:id` is a wildcard that matches ANY string. Routes like `/custom/list`, `/categories`, `/stats`, `/feedback/stats`, `/abtest` must come BEFORE `/:id`
  - Correct order should be:
    1. `GET /` (line 24) — list all agents
    2. `GET /categories` (line 46)
    3. `GET /stats` (line 59)
    4. `GET /custom/list` (line 114)
    5. `POST /custom` (line 128)
    6. `PUT /custom/:id` (line 160)
    7. `DELETE /custom/:id` (line 183)
    8. `POST /custom/clone/:id` (line 205)
    9. `GET /feedback/stats` (line 315)
    10. `POST /abtest/start` (line 333)
    11. `GET /abtest` (line 355)
    12. `GET /abtest/:testId` (line 369)
    13. `GET /:id` (MOVED TO HERE — line 72 originally)
    14. `POST /:id/feedback` (line 233)
    15. `GET /:id/quality` (line 268)
    16. `GET /:id/failures` (line 283)
    17. `GET /:id/improvements` (line 298)
  - Run backend tests after fix

  **Must NOT do**:
  - Do NOT change any route handler logic, only their ORDER
  - Do NOT change the route paths themselves
  - Do NOT add new routes

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple code reordering within one file, no complex logic
  - **Skills**: [`typescript-programmer`, `git-master`]
    - `typescript-programmer`: Understanding Express route ordering in TypeScript
    - `git-master`: Atomic commit for this bug fix
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: No frontend work
    - `agent-browser`: No browser testing needed
    - `python-programmer`: Not Python

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T0b, T0c, T1, T2)
  - **Blocks**: T3 (SPA router needs clean backend)
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `backend/api/src/routes/agents.routes.ts:24-104` — Current route definitions (GET /, GET /categories, GET /stats, GET /:id) — note /:id at line 72 is before /custom/list at line 114
  - `backend/api/src/routes/agents.routes.ts:106-387` — Remaining routes (custom CRUD, feedback, A/B test) that should come BEFORE /:id

  **API/Type References**:
  - Express Router documentation: Parameterized routes (`/:id`) match any string, so they must be placed after literal routes (`/categories`, `/stats`, `/custom/list`, `/feedback/stats`, `/abtest`)

  **Test References**:
  - `backend/api/src/__tests__/` — Existing test suites to run after fix

  **Acceptance Criteria**:

  ```bash
  # Agent runs backend tests:
  cd backend/api && bun test
  # Assert: 9 suites, 180 tests, 0 failures
  ```

  ```bash
  # Agent verifies route order by inspecting the file:
  # GET /:id should appear AFTER all named static routes
  # Specifically: /categories, /stats, /custom/list, /feedback/stats, /abtest should all precede /:id
  grep -n "router.get\|router.post\|router.put\|router.delete" backend/api/src/routes/agents.routes.ts
  # Assert: /:id route appears after /custom/list, /feedback/stats, /abtest
  ```

  **Evidence to Capture:**
  - [ ] Test output showing all 180 tests passing
  - [ ] grep output showing corrected route order

  **Commit**: YES
  - Message: `fix(agents): reorder routes to prevent /:id from catching named paths`
  - Files: `backend/api/src/routes/agents.routes.ts`
  - Pre-commit: `cd backend/api && bun test`

---

### - [x] T0b. Fix server.ts Router Mount Order

  **What to do**:
  - In `backend/api/src/server.ts`, fix two issues:
    1. **Dual `/api/agents` mount**: Line 367 mounts `agentRouter` at `/api/agents` and line 396 mounts `agentsMonitoringRouter` at the same `/api/agents` path. Fix by changing `agentsMonitoringRouter` to mount at `/api/agents-monitoring` (line 396)
    2. **Dual `/api/metrics` mount**: Line 366 mounts `metricsRouter` at `/api/metrics`, but line 411 has an inline `GET /api/metrics` handler. Fix by removing the inline handler (lines 411-460 approximately) since `metricsRouter` already handles this endpoint
  - Update any frontend references to `/api/agents-monitoring` if the agentsMonitoringRouter path changes
  - Run backend tests after fix

  **Must NOT do**:
  - Do NOT change API handler logic
  - Do NOT modify route handler implementations
  - Do NOT remove any functionality — only fix mount conflicts

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small routing fix in server.ts, straightforward change
  - **Skills**: [`typescript-programmer`, `git-master`]
    - `typescript-programmer`: Express middleware mount order understanding
    - `git-master`: Atomic commit for this bug fix
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: No frontend work
    - `agent-browser`: No browser testing

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T0a, T0c, T1, T2)
  - **Blocks**: T3
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `backend/api/src/server.ts:364-402` — Route mounting section showing the dual mounts
  - `backend/api/src/server.ts:411-460` — Inline GET /api/metrics handler that conflicts with metricsRouter
  - `backend/api/src/routes/agents-monitoring.routes.ts` — The agentsMonitoringRouter definitions (verify its routes don't conflict with agentRouter)

  **API/Type References**:
  - `backend/api/src/routes/index.ts` — Route exports to understand what each router provides

  **Test References**:
  - `backend/api/src/__tests__/` — Run all tests after fix

  **Acceptance Criteria**:

  ```bash
  # Backend tests pass:
  cd backend/api && bun test
  # Assert: 9 suites, 180 tests, 0 failures
  ```

  ```bash
  # Verify no dual mount:
  grep -n "app.use.*'/api/agents'" backend/api/src/server.ts
  # Assert: Only ONE line mounts /api/agents
  grep -n "app.use.*'/api/metrics'" backend/api/src/server.ts
  # Assert: Only ONE metricsRouter mount, no inline handler
  ```

  **Evidence to Capture:**
  - [ ] Test output showing all 180 tests passing
  - [ ] grep output confirming single mount per path

  **Commit**: YES
  - Message: `fix(server): resolve dual router mount conflicts for /api/agents and /api/metrics`
  - Files: `backend/api/src/server.ts`
  - Pre-commit: `cd backend/api && bun test`

---

### - [x] T0c. Fix analytics.html process.uptime in Browser

  **What to do**:
  - In `frontend/web/public/analytics.html`, line 114 contains:
    ```js
    ${Math.round(process?.uptime?.() || 0)}초
    ```
  - `process` is a Node.js global — does NOT exist in browser. This causes the uptime to always show "0초"
  - Fix: The analytics page fetches data from `/api/analytics/dashboard` or `/api/metrics`. The server response already includes `uptime` field (from `monitoring/analytics.ts:293` and `controllers/metrics.controller.ts:63`). Use the API response's `uptime` value instead of `process.uptime()`
  - Change the template literal to reference the API response data variable (e.g., `data.system.uptime` or `data.uptime`)
  - Find the fetch call in the analytics.html script that loads dashboard data and identify the correct field name

  **Must NOT do**:
  - Do NOT change the backend API response format
  - Do NOT add polyfills for `process` in the browser
  - Do NOT change the visual layout of the analytics page

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single line fix in one HTML file
  - **Skills**: [`git-master`]
    - `git-master`: Atomic commit
  - **Skills Evaluated but Omitted**:
    - `typescript-programmer`: This is vanilla JS in HTML
    - `frontend-ui-ux`: No design changes

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T0a, T0b, T1, T2)
  - **Blocks**: T8 (monitoring page conversion uses this fixed page)
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `frontend/web/public/analytics.html:114` — The broken line with `process?.uptime?.()`
  - `backend/api/src/monitoring/analytics.ts:278-293` — Server-side analytics data including `uptime: Math.round(uptime)`
  - `backend/api/src/controllers/metrics.controller.ts:63` — Metrics response includes `uptime: process.uptime()`

  **Documentation References**:
  - The analytics HTML page likely has a `fetch('/api/analytics/dashboard')` or similar call — find it and use the response's uptime field

  **Acceptance Criteria**:

  ```bash
  # Verify no process reference in browser JS:
  grep -n "process" frontend/web/public/analytics.html
  # Assert: No browser-side process.uptime calls remain (process may appear in comments/strings but not as executable code)
  ```

  **For Frontend verification** (using playwright skill):
  ```
  1. Navigate to: http://localhost:52416/analytics.html
  2. Wait for: page load complete
  3. Assert: Uptime value is NOT "0초" (should show actual server uptime)
  4. Screenshot: .sisyphus/evidence/t0c-analytics-uptime.png
  ```

  **Evidence to Capture:**
  - [ ] grep output showing no browser-side process.uptime
  - [ ] Screenshot showing non-zero uptime value

  **Commit**: YES
  - Message: `fix(analytics): use API response uptime instead of browser-side process.uptime`
  - Files: `frontend/web/public/analytics.html`
  - Pre-commit: N/A (frontend only)

---

### - [x] T1. Design Sidebar UI in Stitch MCP

  **What to do**:
  - Use Stitch MCP to prototype the Gemini-style sidebar in 3 states
  - Create a Stitch project for "OpenMake.AI Sidebar Redesign"
  - Generate screens for:
    1. **Full state (280px)**: Conversation list with search, new chat button, recent conversations grouped by date, minimal logo, user avatar at bottom. Dark theme matching existing design tokens
    2. **Icon state (64px)**: Just key icons vertically — new chat (+), search, settings gear. Logo as small icon. Hover on sidebar area triggers expand overlay
    3. **Hidden state (0px)**: Mobile-only, no sidebar visible, hamburger menu in header
    4. **Hover-expand overlay**: When hovering icon-mode sidebar, it expands to 280px as an overlay (position: absolute, not pushing content), with glass-morphism backdrop
  - Use device type: DESKTOP for states 1, 2, 4 and MOBILE for state 3
  - Export the design screenshots for reference in T4

  **Must NOT do**:
  - Do NOT implement code yet — design exploration only
  - Do NOT deviate from dark theme + glassmorphism aesthetic

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: UI/UX design task requiring visual judgment
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Design expertise for creating stunning sidebar states
  - **Skills Evaluated but Omitted**:
    - `typescript-programmer`: No code to write
    - `git-master`: No commits needed (design only)

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T0a, T0b, T0c, T2)
  - **Blocks**: T4 (sidebar implementation uses design as reference)
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `frontend/web/public/css/design-tokens.css:19-166` — All CSS variables: colors (--accent-primary: #667eea), backgrounds (--bg-sidebar: #131316), glass effects (--glass-bg, --glass-blur), spacing, typography (Pretendard + Outfit)
  - `frontend/web/public/css/dark-sidebar.css` — Current sidebar dark theme styles
  - `frontend/web/public/index.html:66-154` — Current sidebar structure (System A) showing conversation list, nav menu, user section, A2A agents

  **External References**:
  - Google Gemini UI: https://gemini.google.com — Reference for conversation-list-only sidebar pattern

  **Acceptance Criteria**:

  ```
  # Agent uses Stitch MCP tools:
  1. Create project: mcp_stitch_create_project(title="OpenMake.AI Sidebar Redesign")
  2. Generate 4 screens:
     a. Full sidebar (280px, DESKTOP)
     b. Icon sidebar (64px, DESKTOP)  
     c. Hidden sidebar (MOBILE)
     d. Hover-expand overlay (DESKTOP)
  3. Fetch screenshots for all 4 screens
  4. Save screenshots to .sisyphus/evidence/t1-sidebar-*.png
  ```

  **Evidence to Capture:**
  - [ ] 4 Stitch-generated design screenshots
  - [ ] Stitch project URL/ID for future reference

  **Commit**: NO (design artifacts only)

---

### - [x] T2. Design Chat Hub + Tool Picker UI in Stitch MCP

  **What to do**:
  - Use Stitch MCP to prototype the Gemini-style chat hub with tool picker
  - Create screens for:
    1. **Welcome state**: Chat area showing welcome screen with avatar, greeting text, feature cards (코딩 에이전트, 문서 작성, 데이터 분석, 자유 대화). Below: input area with tool picker row
    2. **Tool picker**: Row of pill/icon buttons below chat input — 캔버스, 딥 리서치, MCP 도구, 마켓플레이스, 커스텀 에이전트, AI 메모리, etc. Scrollable on narrow screens
    3. **Active chat state**: Messages displayed, tool picker still visible. Side-panel mode for tools (right side)
    4. **Admin quick-access**: Settings gear icon in top toolbar that opens a slide-out panel with admin options
  - Dark theme, glassmorphism, matching existing design tokens

  **Must NOT do**:
  - Do NOT implement code — design only
  - Do NOT add features beyond what current pages provide

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: UI/UX design requiring visual judgment and creative layout
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Design expertise for chat hub layout
  - **Skills Evaluated but Omitted**:
    - `typescript-programmer`: No code
    - `git-master`: No commits

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T0a, T0b, T0c, T1)
  - **Blocks**: T11 (chat hub implementation)
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `frontend/web/public/index.html:157-263` — Current chat area structure (welcome screen, chat messages, input container with action buttons)
  - `frontend/web/public/css/design-tokens.css:19-166` — Design system variables
  - `frontend/web/public/css/feature-cards.css` — Feature card styling
  - `frontend/web/public/js/nav-items.js:12-37` — Tools/pages that become tool picker items

  **External References**:
  - Google Gemini UI tool picker: The bottom bar with Canvas, Research, etc. buttons

  **Acceptance Criteria**:

  ```
  # Agent uses Stitch MCP tools:
  1. Create project: mcp_stitch_create_project(title="OpenMake.AI Chat Hub + Tool Picker")
  2. Generate 4 screens (DESKTOP):
     a. Welcome state with tool picker
     b. Tool picker close-up
     c. Active chat with side panel
     d. Admin slide-out panel
  3. Fetch screenshots for all screens
  4. Save to .sisyphus/evidence/t2-hub-*.png
  ```

  **Evidence to Capture:**
  - [ ] 4 Stitch-generated design screenshots
  - [ ] Stitch project URL/ID

  **Commit**: NO (design artifacts only)

---

### - [x] T3. Build SPA Router (`js/spa-router.js`)

  **What to do**:
  - Create `frontend/web/public/js/spa-router.js` — a vanilla JavaScript client-side router using the History API
  - **Router features**:
    1. `Router.register(path, moduleLoader)` — Register a route with a lazy-loading function
    2. `Router.navigate(path, options)` — Navigate to a route (pushState + load module)
    3. `Router.back()`, `Router.forward()` — History navigation
    4. `Router.getCurrentRoute()` — Get current route info
    5. Popstate event handler for back/forward browser buttons
    6. Global click interceptor for `<a href>` links (internal only)
    7. Fallback: if route not found, show 404 or redirect to chat
  - **Module loading pattern**:
    - Each route maps to a module file in `js/modules/pages/[page-name].js`
    - Module files are loaded dynamically via `<script>` tag injection (no ES modules since vanilla JS)
    - Each module must export: `{ init(), cleanup(), getHTML() }` on `window.PageModules[pageName]`
    - Router calls `cleanup()` on current module before loading new one
    - Router calls `init()` on new module after injecting HTML into `#page-content` container
  - **Route registry** (derived from nav-items.js):
    ```
    / → chat (default, built-in to index.html)
    /canvas.html → canvas module
    /research.html → research module
    /mcp-tools.html → mcp-tools module
    /history.html → history module
    /marketplace.html → marketplace module
    /custom-agents.html → custom-agents module
    /agent-learning.html → agent-learning module
    /memory.html → memory module
    /usage.html → usage module
    /guide.html → guide module
    /cluster.html → cluster module
    /analytics.html → analytics module
    /token-monitoring.html → token-monitoring module
    /admin-metrics.html → admin-metrics module
    /admin.html → admin module
    /audit.html → audit module
    /external.html → external module
    /alerts.html → alerts module
    /settings.html → settings module
    /password-change.html → password-change module
    /login.html → EXCLUDED (full page redirect)
    ```
  - **CSS loading**: Each module can specify CSS dependencies. Router injects `<link>` tags and removes old page-specific ones
  - **Auth guard**: If route has `requireAuth: true` (from nav-items.js) and user not authenticated, redirect to login.html

  **Must NOT do**:
  - Do NOT use ES6 import/export (vanilla JS, no build step)
  - Do NOT break existing `/login.html` page navigation (should be full page load)
  - Do NOT use hash-based routing (#) — use History API (pushState)
  - Do NOT load all modules upfront — lazy load on navigation

  **Recommended Agent Profile**:
  - **Category**: `ultrabrain`
    - Reason: Core SPA infrastructure — needs careful architectural thinking for module loading, state management, and edge cases
  - **Skills**: [`frontend-ui-ux`, `git-master`]
    - `frontend-ui-ux`: SPA routing UX patterns (transitions, loading states)
    - `git-master`: This is a foundational commit that many tasks depend on
  - **Skills Evaluated but Omitted**:
    - `typescript-programmer`: This is vanilla JS
    - `agent-browser`: Not testing yet

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (sequential after Wave 1)
  - **Blocks**: T4, T5 (everything depends on the router)
  - **Blocked By**: T0a, T0b, T0c (bugs must be fixed first)

  **References**:

  **Pattern References**:
  - `frontend/web/public/js/nav-items.js:12-37` — Route data source (12 menu + 8 admin items with href, icon, iconify, label, requireAuth)
  - `frontend/web/public/js/components/sidebar.js:244-257` — Auth check functions (isLoggedIn, isGuestMode, isAuthenticated, checkPageAccess)
  - `frontend/web/public/js/modules/index.js:1-24` — Module loading order and dependencies
  - `frontend/web/public/app.js:1-60` — Global state variables that must persist across navigation

  **API/Type References**:
  - `History API`: `window.history.pushState(state, title, url)`, `window.addEventListener('popstate', handler)`
  - `nav-items.js` data structure: `{ href: string, icon: string, iconify: string, label: string, requireAuth?: boolean }`

  **Documentation References**:
  - MDN History API: pushState, popstate event
  - Dynamic script loading pattern: `const script = document.createElement('script'); script.src = url; document.body.appendChild(script);`

  **Acceptance Criteria**:

  ```bash
  # Verify file exists and has expected exports:
  ls -la frontend/web/public/js/spa-router.js
  # Assert: File exists
  
  # Verify Router is exposed globally:
  grep -n "window.Router\|window.SPARouter" frontend/web/public/js/spa-router.js
  # Assert: Router is exposed on window object
  
  # Verify route registration pattern:
  grep -n "register\|navigate\|popstate\|pushState" frontend/web/public/js/spa-router.js
  # Assert: Contains register, navigate, popstate handler, pushState calls
  ```

  **Evidence to Capture:**
  - [ ] File content of spa-router.js showing complete router implementation
  - [ ] Grep output confirming key functions exist

  **Commit**: YES
  - Message: `feat(spa): add vanilla JS SPA router with History API and dynamic module loading`
  - Files: `frontend/web/public/js/spa-router.js`
  - Pre-commit: N/A

---

### - [x] T4. Build Unified 3-State Sidebar Component

  **What to do**:
  - Create `frontend/web/public/js/components/unified-sidebar.js` — replaces BOTH sidebar systems
  - Create `frontend/web/public/css/unified-sidebar.css` — all sidebar styles consolidated
  - **3 states**:
    1. **Full (280px)**: Shows conversation list (recent chats grouped by date), new chat button, search input, user avatar + name at bottom, settings gear icon
    2. **Icon (64px)**: Only icons visible — new chat (+), search (🔍), settings (⚙️). Logo as small icon. NO text labels in icon mode
    3. **Hidden (0px)**: Mobile only. Hamburger menu in main header to reveal
  - **Hover-expand behavior**: When sidebar is in icon mode and user hovers, it expands to 280px as an overlay:
    - Position: absolute (overlaying main content, NOT pushing it)
    - Background: glassmorphism blur + dark bg (`rgba(13,13,14,0.95)`, `backdrop-filter: blur(20px)`)
    - Smooth transition: `width 300ms cubic-bezier(0.4, 0, 0.2, 1)`
    - Mouse-leave collapses back to icon mode after 300ms delay
  - **Conversation list**: Fetches from existing `/api/chat/conversations` endpoint. Groups by "오늘", "어제", "이번 주", "이전". Each item shows conversation title (truncated) with hover highlight
  - **Toggle mechanism**: 
    - Desktop: Click toggle button cycles Full → Icon → Full
    - Mobile: Hamburger opens sidebar overlay, tap outside closes
    - Keyboard: Ctrl+B toggles sidebar
  - **State persistence**: Save sidebar state to localStorage (`sidebar-state: 'full' | 'icon' | 'hidden'`)
  - **Integration**: The sidebar calls `Router.navigate(path)` when chat conversations are clicked (loads chat by ID)
  - Delete the old `sidebar.js` SharedSidebar class (will be replaced)

  **Must NOT do**:
  - Do NOT include page navigation menu in the sidebar (Gemini style = conversations only)
  - Do NOT add admin links to sidebar
  - Do NOT break the mobile hamburger menu pattern
  - Do NOT use position: fixed for sidebar (use sticky or absolute for overlay only)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Core UI component requiring both visual design sense and engineering
  - **Skills**: [`frontend-ui-ux`, `git-master`]
    - `frontend-ui-ux`: Sidebar state transitions, hover behavior, glassmorphism implementation
    - `git-master`: Atomic commit for this major component
  - **Skills Evaluated but Omitted**:
    - `typescript-programmer`: Vanilla JS
    - `agent-browser`: Verification comes later in T14

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T5 if T3 is done)
  - **Parallel Group**: Wave 3 (after T3 + T1)
  - **Blocks**: T5, T13
  - **Blocked By**: T1 (design reference), T3 (router for navigation)

  **References**:

  **Pattern References**:
  - `frontend/web/public/index.html:66-154` — Current sidebar System A structure (conversation list, nav menu, user section)
  - `frontend/web/public/js/components/sidebar.js:1-294` — Current SharedSidebar class (System B) — study render(), getNavItems(), toggleSidebar(), theme/auth functions
  - `frontend/web/public/css/layout.css:77-100` — Current sidebar CSS (.sidebar width, glassmorphism, sticky, overflow)
  - `frontend/web/public/css/dark-sidebar.css` — Dark theme sidebar styles
  - `frontend/web/public/css/design-tokens.css:157-159` — Sidebar CSS variables (--sidebar-width: 260px, --sidebar-collapsed-width: 0)
  - `frontend/web/public/app.js:36-56` — Global state: currentChatId, chatHistory used by sidebar

  **API/Type References**:
  - `GET /api/chat/conversations` — Fetches conversation list for sidebar
  - `GET /api/chat/conversations/:id` — Loads a specific conversation

  **External References**:
  - Google Gemini sidebar: conversation list only, grouped by time
  - Stitch designs from T1: sidebar UI prototypes

  **Acceptance Criteria**:

  ```bash
  # Files exist:
  ls -la frontend/web/public/js/components/unified-sidebar.js frontend/web/public/css/unified-sidebar.css
  # Assert: Both files exist
  ```

  ```bash
  # Verify 3-state support:
  grep -n "full\|icon\|hidden\|collapsed\|hover" frontend/web/public/js/components/unified-sidebar.js
  # Assert: References to all 3 states and hover behavior
  ```

  **For Frontend verification** (using playwright skill):
  ```
  1. Navigate to: http://localhost:52416/
  2. Wait for: sidebar to render
  3. Assert: sidebar width ~280px (full state)
  4. Click: sidebar toggle button
  5. Wait 500ms for animation
  6. Assert: sidebar width ~64px (icon state)
  7. Hover: over icon sidebar area
  8. Wait 500ms
  9. Assert: sidebar expanded as overlay (~280px, position absolute)
  10. Mouse leave sidebar
  11. Wait 500ms
  12. Assert: sidebar returns to 64px icon state
  13. Screenshot: .sisyphus/evidence/t4-sidebar-states.png
  ```

  **Evidence to Capture:**
  - [ ] unified-sidebar.js and unified-sidebar.css files
  - [ ] Screenshot showing sidebar state transitions

  **Commit**: YES
  - Message: `feat(sidebar): add unified 3-state sidebar with icon mode and hover-expand overlay`
  - Files: `frontend/web/public/js/components/unified-sidebar.js`, `frontend/web/public/css/unified-sidebar.css`
  - Pre-commit: N/A

---

### - [x] T5. Update index.html as SPA Shell

  **What to do**:
  - Transform `frontend/web/public/index.html` from a chat-only page into the SPA shell
  - **Structure**:
    ```html
    <body>
      <div class="app">
        <!-- Unified Sidebar (from T4) -->
        <aside class="sidebar" id="sidebar"></aside>
        
        <!-- Main Content Area -->
        <main class="main-content" id="mainContent">
          <!-- Top toolbar (settings, notifications, breadcrumb) -->
          <header class="top-toolbar" id="topToolbar"></header>
          
          <!-- Page Content Container (SPA router injects here) -->
          <div id="page-content">
            <!-- Default: Chat Hub (welcome screen + chat area) -->
            <!-- Other pages loaded dynamically by router -->
          </div>
        </main>
        
        <!-- Modal/Panel Overlay Container -->
        <div id="panel-container"></div>
      </div>
    </body>
    ```
  - **Script loading order**:
    1. design-tokens.css, unified-sidebar.css, main styles
    2. nav-items.js (route registry)
    3. spa-router.js
    4. unified-sidebar.js
    5. app.js (chat functionality — stays for chat hub)
  - **Remove**: Old sidebar inline HTML (lines 66-154), old nav-items inline script (lines 117-136)
  - **Keep**: Chat area structure (welcome screen, chat messages, input container) as the default "chat" module
  - **Add**: `<div id="page-content">` where the SPA router injects page module HTML
  - **Add**: `<div id="panel-container">` for modal/slide-out panels
  - **Add**: Top toolbar with settings gear, theme toggle, breadcrumb/page title
  - **Router initialization**: On page load, check `window.location.pathname` and route to correct module
  - Update CSS imports to include unified-sidebar.css

  **Must NOT do**:
  - Do NOT remove the chat functionality from index.html — it's the default landing view
  - Do NOT remove modal definitions (file upload modal, settings modal) — they move to panel-container or stay
  - Do NOT break the PWA manifest and service worker registration
  - Do NOT change the external CDN imports (Pretendard, Iconify, Marked, highlight.js)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Major HTML restructuring with visual layout implications
  - **Skills**: [`frontend-ui-ux`, `git-master`]
    - `frontend-ui-ux`: SPA shell layout, content areas, responsive design
    - `git-master`: This is a critical commit that restructures the main HTML
  - **Skills Evaluated but Omitted**:
    - `typescript-programmer`: HTML/CSS work
    - `agent-browser`: Verification comes in T14

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T4 if done carefully)
  - **Parallel Group**: Wave 3 (after T3)
  - **Blocks**: T6, T7, T8, T9, T10 (all page modules load into this shell)
  - **Blocked By**: T3 (router), T4 (sidebar component)

  **References**:

  **Pattern References**:
  - `frontend/web/public/index.html:1-320` — Current full index.html (needs major restructuring)
  - `frontend/web/public/js/spa-router.js` — Router created in T3
  - `frontend/web/public/js/components/unified-sidebar.js` — Sidebar created in T4
  - `frontend/web/public/app.js:1-60` — Chat state globals that must persist
  - `frontend/web/public/style.css` — Main CSS file (1678 lines) used by index.html

  **API/Type References**:
  - PWA manifest: `frontend/web/public/manifest.json`
  - Service worker: `frontend/web/public/service-worker.js`

  **Acceptance Criteria**:

  ```bash
  # Verify SPA shell structure:
  grep -n "page-content\|panel-container\|spa-router\|unified-sidebar" frontend/web/public/index.html
  # Assert: Contains page-content div, panel-container div, spa-router.js script, unified-sidebar.js script
  ```

  **For Frontend verification** (using playwright skill):
  ```
  1. Navigate to: http://localhost:52416/
  2. Wait for: chat area visible (welcome screen)
  3. Assert: sidebar visible on left
  4. Assert: main content area shows chat hub
  5. Assert: page-content container exists in DOM
  6. Assert: panel-container exists in DOM
  7. Screenshot: .sisyphus/evidence/t5-spa-shell.png
  ```

  **Evidence to Capture:**
  - [ ] index.html showing new SPA shell structure
  - [ ] Screenshot of rendered SPA shell

  **Commit**: YES
  - Message: `feat(spa): restructure index.html as SPA shell with page-content and panel containers`
  - Files: `frontend/web/public/index.html`
  - Pre-commit: N/A

---

### - [x] T6. Convert Tool Pages to SPA Modules (canvas, research, mcp-tools)

  **What to do**:
  - Extract 3 tool pages into SPA-loadable modules:
    1. `frontend/web/public/js/modules/pages/canvas.js` — from canvas.html
    2. `frontend/web/public/js/modules/pages/research.js` — from research.html
    3. `frontend/web/public/js/modules/pages/mcp-tools.js` — from mcp-tools.html
  - **For each page module**, create a JavaScript file that exports:
    ```js
    window.PageModules = window.PageModules || {};
    window.PageModules['canvas'] = {
      getHTML() { return `<div class="page-canvas">...</div>`; },  // Page HTML content (extracted from .html)
      getCSS() { return `...`; },  // Page-specific inline styles
      init() { /* Initialize event listeners, fetch data, etc. */ },
      cleanup() { /* Remove event listeners, abort pending fetches */ }
    };
    ```
  - **Extraction process** per page:
    1. Copy the `<style>` block content → `getCSS()` return value (wrap selectors in `.page-[name]` namespace)
    2. Copy the `<main class="main-content">` inner HTML → `getHTML()` return value (wrapped in `.page-[name]` div)
    3. Copy the `<script>` block logic → `init()` function body
    4. Create `cleanup()` to remove any intervals, event listeners, abort controllers
    5. Remove sidebar-related HTML (`.sidebar`, `.sidebar-overlay`) — handled by SPA shell
    6. Remove common imports (design-tokens, layout, sidebar.js, nav-items.js) — already in SPA shell
  - **Keep the original .html files** but redirect them to SPA: `<script>window.location.href = '/?page=canvas';</script>`
  - Register routes in spa-router.js

  **Must NOT do**:
  - Do NOT change any page's functionality or visual appearance
  - Do NOT add new features to these pages
  - Do NOT remove the original HTML files (keep as redirects for bookmarks)
  - Do NOT forget to namespace CSS selectors to prevent conflicts

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Methodical extraction of 3 pages with careful HTML/CSS/JS separation
  - **Skills**: [`frontend-ui-ux`, `git-master`]
    - `frontend-ui-ux`: CSS namespacing, layout preservation
    - `git-master`: One commit per converted page or batch commit
  - **Skills Evaluated but Omitted**:
    - `typescript-programmer`: Vanilla JS extraction
    - `agent-browser`: Verification in T14

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with T7, T8, T9, T10)
  - **Blocks**: T11 (tool picker needs tool modules), T13 (CSS consolidation)
  - **Blocked By**: T5 (SPA shell must exist to load into)

  **References**:

  **Pattern References**:
  - `frontend/web/public/canvas.html:1-80+` — Canvas page: toolbar, filter tabs, doc grid, doc card, modal overlay, toast system. Uses fetch API for document CRUD
  - `frontend/web/public/research.html:1-80+` — Research page: new research form (topic input, depth select), session list, session card with progress bar, detail modal
  - `frontend/web/public/mcp-tools.html` — MCP tools page (read full content to extract)
  - `frontend/web/public/js/spa-router.js` — Router for registering these modules

  **API/Type References**:
  - Canvas API: `GET/POST /api/canvas/documents`, `PUT/DELETE /api/canvas/documents/:id`
  - Research API: `POST /api/research/sessions`, `GET /api/research/sessions`
  - MCP API: `GET /api/mcp/tools`, `POST /api/mcp/execute`

  **Acceptance Criteria**:

  ```bash
  # Module files exist:
  ls frontend/web/public/js/modules/pages/canvas.js frontend/web/public/js/modules/pages/research.js frontend/web/public/js/modules/pages/mcp-tools.js
  # Assert: All 3 files exist
  ```

  ```bash
  # Each module exports required interface:
  for f in canvas research mcp-tools; do grep "PageModules\['$f'\]\|getHTML\|init\|cleanup" "frontend/web/public/js/modules/pages/$f.js" | head -5; done
  # Assert: Each file has PageModules registration with getHTML, init, cleanup
  ```

  ```bash
  # Original HTML files redirect to SPA:
  head -3 frontend/web/public/canvas.html frontend/web/public/research.html frontend/web/public/mcp-tools.html
  # Assert: Each contains redirect script
  ```

  **Evidence to Capture:**
  - [ ] All 3 module files with correct exports
  - [ ] Original HTML files converted to redirects

  **Commit**: YES
  - Message: `feat(spa): convert tool pages (canvas, research, mcp-tools) to SPA modules`
  - Files: `frontend/web/public/js/modules/pages/canvas.js`, `research.js`, `mcp-tools.js`, modified HTML files
  - Pre-commit: N/A

---

### - [x] T7. Convert Agent Pages to SPA Modules (marketplace, custom-agents, agent-learning)

  **What to do**:
  - Extract 3 agent pages into SPA-loadable modules:
    1. `frontend/web/public/js/modules/pages/marketplace.js` — from marketplace.html
    2. `frontend/web/public/js/modules/pages/custom-agents.js` — from custom-agents.html
    3. `frontend/web/public/js/modules/pages/agent-learning.js` — from agent-learning.html
  - Follow the same extraction pattern as T6 (getHTML, getCSS, init, cleanup)
  - Note: `agents.html` is already removed (redirects to `/`), so skip it
  - Namespace CSS with `.page-marketplace`, `.page-custom-agents`, `.page-agent-learning`
  - Keep original HTML files as redirects

  **Must NOT do**:
  - Same guardrails as T6

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Same methodical extraction as T6
  - **Skills**: [`frontend-ui-ux`, `git-master`]
    - `frontend-ui-ux`: Layout preservation
    - `git-master`: Batch commit
  - **Skills Evaluated but Omitted**:
    - Same as T6

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with T6, T8, T9, T10)
  - **Blocks**: T13 (CSS consolidation)
  - **Blocked By**: T5 (SPA shell)

  **References**:

  **Pattern References**:
  - `frontend/web/public/marketplace.html` — Agent marketplace page
  - `frontend/web/public/custom-agents.html` — Custom agent builder page
  - `frontend/web/public/agent-learning.html` — Agent learning/feedback page
  - Same extraction pattern as T6

  **API/Type References**:
  - Marketplace API: `GET /api/marketplace/agents`
  - Custom agents API: `GET/POST/PUT/DELETE /api/agents/custom/*`
  - Learning API: `GET /api/agents/:id/quality`, `/api/agents/:id/feedback`

  **Acceptance Criteria**:

  ```bash
  # Module files exist:
  ls frontend/web/public/js/modules/pages/marketplace.js frontend/web/public/js/modules/pages/custom-agents.js frontend/web/public/js/modules/pages/agent-learning.js
  # Assert: All 3 files exist
  ```

  **Evidence to Capture:**
  - [ ] All 3 module files with correct exports

  **Commit**: YES
  - Message: `feat(spa): convert agent pages (marketplace, custom-agents, agent-learning) to SPA modules`
  - Files: 3 new module JS files + 3 modified HTML redirects
  - Pre-commit: N/A

---

### - [x] T8. Convert Monitoring Pages to SPA Modules (cluster, usage, analytics, token-monitoring, admin-metrics)

  **What to do**:
  - Extract 5 monitoring pages into SPA-loadable modules:
    1. `frontend/web/public/js/modules/pages/cluster.js` — from cluster.html
    2. `frontend/web/public/js/modules/pages/usage.js` — from usage.html
    3. `frontend/web/public/js/modules/pages/analytics.js` — from analytics.html (USES T0c FIX)
    4. `frontend/web/public/js/modules/pages/token-monitoring.js` — from token-monitoring.html
    5. `frontend/web/public/js/modules/pages/admin-metrics.js` — from admin-metrics.html
  - Follow same extraction pattern as T6
  - **Important for analytics.js**: The T0c bug fix (process.uptime) must be incorporated — use the API response data for uptime
  - Many monitoring pages use auto-refresh intervals — `cleanup()` MUST clear these intervals
  - Namespace CSS appropriately

  **Must NOT do**:
  - Do NOT re-introduce the `process.uptime` bug in the extracted module
  - Do NOT forget to clear auto-refresh intervals in cleanup()

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 5 pages with auto-refresh patterns need careful cleanup handling
  - **Skills**: [`frontend-ui-ux`, `git-master`]
    - `frontend-ui-ux`: Dashboard/monitoring page layouts
    - `git-master`: Batch commit
  - **Skills Evaluated but Omitted**:
    - Same as T6

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with T6, T7, T9, T10)
  - **Blocks**: T13
  - **Blocked By**: T5 (SPA shell), T0c (analytics.html bug fix)

  **References**:

  **Pattern References**:
  - `frontend/web/public/cluster.html` — Cluster status with node cards
  - `frontend/web/public/usage.html` — API usage charts/tables
  - `frontend/web/public/analytics.html:1-114+` — Analytics dashboard with dash-grid cards, health badges, metric rows, data tables
  - `frontend/web/public/token-monitoring.html` — Token usage monitoring
  - `frontend/web/public/admin-metrics.html` — Integrated monitoring dashboard
  - `frontend/web/public/css/pages/dashboard.css` — Dashboard-specific CSS (used by admin.html)

  **API/Type References**:
  - Cluster: `GET /api/cluster/*`
  - Usage: `GET /api/usage/*`
  - Analytics: `GET /api/analytics/dashboard`
  - Token monitoring: `GET /api/monitoring/*`
  - Metrics: `GET /api/metrics`

  **Acceptance Criteria**:

  ```bash
  # Module files exist:
  ls frontend/web/public/js/modules/pages/cluster.js frontend/web/public/js/modules/pages/usage.js frontend/web/public/js/modules/pages/analytics.js frontend/web/public/js/modules/pages/token-monitoring.js frontend/web/public/js/modules/pages/admin-metrics.js
  # Assert: All 5 files exist
  ```

  ```bash
  # Verify cleanup clears intervals:
  grep -n "clearInterval\|clearTimeout\|cleanup" frontend/web/public/js/modules/pages/analytics.js
  # Assert: cleanup() exists and clears intervals
  ```

  **Evidence to Capture:**
  - [ ] All 5 module files
  - [ ] Grep showing interval cleanup in monitoring modules

  **Commit**: YES
  - Message: `feat(spa): convert monitoring pages (cluster, usage, analytics, token-monitoring, admin-metrics) to SPA modules`
  - Files: 5 new JS modules + 5 modified HTML redirects
  - Pre-commit: N/A

---

### - [x] T9. Convert Admin Pages to SPA Modules (admin, audit, external, alerts, memory, settings, password-change)

  **What to do**:
  - Extract 7 admin pages into SPA-loadable modules:
    1. `frontend/web/public/js/modules/pages/admin.js` — from admin.html (user management)
    2. `frontend/web/public/js/modules/pages/audit.js` — from audit.html
    3. `frontend/web/public/js/modules/pages/external.js` — from external.html
    4. `frontend/web/public/js/modules/pages/alerts.js` — from alerts.html
    5. `frontend/web/public/js/modules/pages/memory.js` — from memory.html
    6. `frontend/web/public/js/modules/pages/settings.js` — from settings.html
    7. `frontend/web/public/js/modules/pages/password-change.js` — from password-change.html
  - Follow same extraction pattern as T6
  - All admin pages require authentication — module init should check auth and redirect if needed
  - These pages will later be accessed as modal/panel overlays (T12), but first must work as full-page modules

  **Must NOT do**:
  - Do NOT remove auth checks from admin pages
  - Do NOT change admin functionality

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 7 pages — largest batch, needs systematic approach
  - **Skills**: [`frontend-ui-ux`, `git-master`]
    - `frontend-ui-ux`: Admin UI patterns
    - `git-master`: Batch commit
  - **Skills Evaluated but Omitted**:
    - Same as T6

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with T6, T7, T8, T10)
  - **Blocks**: T12 (admin panel overlays), T13
  - **Blocked By**: T5 (SPA shell)

  **References**:

  **Pattern References**:
  - `frontend/web/public/admin.html:1-80+` — User management with badges (admin/user/guest), toast notifications
  - `frontend/web/public/audit.html` — Audit log viewer
  - `frontend/web/public/external.html` — External integrations
  - `frontend/web/public/alerts.html` — Alert management
  - `frontend/web/public/memory.html` — AI memory management
  - `frontend/web/public/settings.html:1-60+` — Settings page with toggle switches
  - `frontend/web/public/password-change.html` — Password change form
  - `frontend/web/public/css/pages/dashboard.css` — Dashboard CSS shared by admin pages

  **API/Type References**:
  - Admin: `GET/POST /api/admin/*`
  - Audit: `GET /api/audit/*`
  - External: `GET/POST /api/external/*`
  - Alerts: `GET/POST /api/alerts/*` (from monitoring/alerts.ts)
  - Memory: `GET/POST/DELETE /api/memory/*`
  - Settings: Client-side localStorage primarily

  **Acceptance Criteria**:

  ```bash
  # Module files exist:
  ls frontend/web/public/js/modules/pages/admin.js frontend/web/public/js/modules/pages/audit.js frontend/web/public/js/modules/pages/external.js frontend/web/public/js/modules/pages/alerts.js frontend/web/public/js/modules/pages/memory.js frontend/web/public/js/modules/pages/settings.js frontend/web/public/js/modules/pages/password-change.js
  # Assert: All 7 files exist
  ```

  **Evidence to Capture:**
  - [ ] All 7 module files

  **Commit**: YES
  - Message: `feat(spa): convert admin pages (admin, audit, external, alerts, memory, settings, password-change) to SPA modules`
  - Files: 7 new JS modules + 7 modified HTML redirects
  - Pre-commit: N/A

---

### - [x] T10. Convert Utility Pages to SPA Modules (history, guide)

  **What to do**:
  - Extract 2 utility pages into SPA-loadable modules:
    1. `frontend/web/public/js/modules/pages/history.js` — from history.html
    2. `frontend/web/public/js/modules/pages/guide.js` — from guide.html
  - Follow same extraction pattern as T6
  - **guide.html** note: The guide page loads `guide_content.js` for content data. This dependency must be maintained — either include it in the module or ensure it's already loaded in the SPA shell (it IS loaded in index.html line 39)
  - **history.html** note: Conversation history overlaps with sidebar conversation list. Consider if history page becomes a "show all conversations" view vs sidebar showing recent only

  **Must NOT do**:
  - Same guardrails as T6
  - Do NOT remove guide_content.js dependency

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Only 2 pages, straightforward extraction
  - **Skills**: [`frontend-ui-ux`, `git-master`]
    - `frontend-ui-ux`: Layout preservation
    - `git-master`: Commit
  - **Skills Evaluated but Omitted**:
    - Same as T6

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with T6, T7, T8, T9)
  - **Blocks**: T13
  - **Blocked By**: T5 (SPA shell)

  **References**:

  **Pattern References**:
  - `frontend/web/public/history.html` — Conversation history list with search, filter
  - `frontend/web/public/guide.html` — User guide with guide_content.js data
  - `frontend/web/public/guide_content.js` — Guide content data (already loaded in index.html)

  **API/Type References**:
  - History: `GET /api/chat/conversations` (with pagination/search)

  **Acceptance Criteria**:

  ```bash
  # Module files exist:
  ls frontend/web/public/js/modules/pages/history.js frontend/web/public/js/modules/pages/guide.js
  # Assert: Both files exist
  ```

  **Evidence to Capture:**
  - [ ] Both module files

  **Commit**: YES
  - Message: `feat(spa): convert utility pages (history, guide) to SPA modules`
  - Files: 2 new JS modules + 2 modified HTML redirects
  - Pre-commit: N/A

---

### - [x] T11. Build Chat Hub + Tool Picker Integration

  **What to do**:
  - Redesign the chat area in index.html as the central Gemini-style hub
  - **Tool picker bar**: Add a row of tool buttons below the chat input area:
    ```html
    <div class="tool-picker" id="toolPicker">
      <button class="tool-btn" data-route="/canvas.html">
        <iconify-icon icon="lucide:file-text"></iconify-icon>
        <span>캔버스</span>
      </button>
      <button class="tool-btn" data-route="/research.html">
        <iconify-icon icon="lucide:flask-conical"></iconify-icon>
        <span>딥 리서치</span>
      </button>
      <button class="tool-btn" data-route="/mcp-tools.html">
        <iconify-icon icon="lucide:wrench"></iconify-icon>
        <span>MCP 도구</span>
      </button>
      <button class="tool-btn" data-route="/marketplace.html">
        <iconify-icon icon="lucide:store"></iconify-icon>
        <span>마켓플레이스</span>
      </button>
      <!-- More tools: custom-agents, memory, agent-learning, usage, guide -->
    </div>
    ```
  - Tool picker uses iconify icons from nav-items.js
  - Clicking a tool button calls `Router.navigate(route)` to load that page module
  - Tool picker is scrollable horizontally on narrow screens
  - **Chat area remains the default view**: When at `/`, show welcome screen + chat
  - When navigating to a tool, chat area hides and `#page-content` shows the tool module
  - **Back to chat**: Clicking logo or "채팅" in tool picker returns to chat hub
  - **Side panel mode** (optional enhancement): Some tools could open as a right-side panel alongside chat. This is a stretch goal — basic version just replaces content area
  - Create `frontend/web/public/css/tool-picker.css` for tool picker styling
  - Glassmorphism pill buttons with hover glow effects

  **Must NOT do**:
  - Do NOT remove any existing chat input action buttons (file attach, web search, discussion mode, thinking mode)
  - Do NOT change the chat functionality (WebSocket, message rendering, etc.)
  - Do NOT put admin tools in the tool picker (those go in the admin panel - T12)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Core UX feature requiring both visual design and engineering
  - **Skills**: [`frontend-ui-ux`, `git-master`]
    - `frontend-ui-ux`: Tool picker UI, transitions between chat and tool views
    - `git-master`: Atomic commit
  - **Skills Evaluated but Omitted**:
    - `typescript-programmer`: Vanilla JS
    - `agent-browser`: Verification in T14

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T12, T13)
  - **Parallel Group**: Wave 5 (after T6-T10 complete)
  - **Blocks**: T14 (integration testing)
  - **Blocked By**: T2 (design reference), T5 (SPA shell), T6 (tool modules to navigate to)

  **References**:

  **Pattern References**:
  - `frontend/web/public/index.html:207-262` — Current input container with action buttons (left-actions: new chat, file attach, web search, discussion mode, thinking mode)
  - `frontend/web/public/js/nav-items.js:13-26` — Menu items that become tool picker buttons (캔버스, 딥 리서치, MCP 도구, 마켓플레이스, 커스텀 에이전트, AI 메모리, API 사용량, 에이전트 학습, 사용 가이드)
  - `frontend/web/public/css/feature-cards.css` — Existing card styling to reference for tool button design
  - `frontend/web/public/css/glassmorphism.css` — Glass effects for tool buttons
  - Stitch designs from T2: Chat hub + tool picker prototypes

  **API/Type References**:
  - nav-items.js structure: `{ href, iconify, label }` for each tool

  **Acceptance Criteria**:

  ```bash
  # Tool picker exists:
  grep -n "tool-picker\|tool-btn\|toolPicker" frontend/web/public/index.html
  # Assert: Tool picker HTML exists
  
  ls frontend/web/public/css/tool-picker.css
  # Assert: CSS file exists
  ```

  **For Frontend verification** (using playwright skill):
  ```
  1. Navigate to: http://localhost:52416/
  2. Wait for: tool picker visible below chat input
  3. Assert: Tool buttons visible (캔버스, 딥 리서치, MCP 도구, etc.)
  4. Click: "캔버스" tool button
  5. Wait for: canvas module to load in page-content
  6. Assert: Canvas page content visible
  7. Assert: URL is /canvas.html
  8. Click: "채팅" button or logo
  9. Wait for: chat hub visible again
  10. Assert: URL is /
  11. Screenshot: .sisyphus/evidence/t11-tool-picker.png
  ```

  **Evidence to Capture:**
  - [ ] Tool picker HTML and CSS
  - [ ] Screenshot showing tool picker in action

  **Commit**: YES
  - Message: `feat(hub): add Gemini-style chat hub with tool picker bar`
  - Files: `frontend/web/public/index.html`, `frontend/web/public/css/tool-picker.css`
  - Pre-commit: N/A

---

### - [x] T12. Build Admin/Settings Panel Overlays

  **What to do**:
  - Create `frontend/web/public/js/components/admin-panel.js` — slide-out panel component for admin/settings pages
  - **Behavior**:
    - Top toolbar has a settings gear icon (⚙️) and user avatar
    - Clicking settings gear opens a slide-out panel from the right side
    - Panel contains a list of admin links (from nav-items.js admin section)
    - Clicking an admin link loads that module INTO the panel (or as a full modal)
    - Panel has a close button and click-outside-to-close behavior
    - Panel uses glassmorphism styling (backdrop-filter: blur, dark semi-transparent bg)
  - **Panel types**:
    1. **Quick settings**: Theme toggle, model selection, MCP toggles (from existing settings modal in index.html lines 287-320)
    2. **Full admin panel**: Loads admin page modules (admin, audit, external, etc.) in a wide side panel or modal
    3. **Settings page**: Settings module loads in full panel view
    4. **Password change**: Small modal
  - Create `frontend/web/public/css/admin-panel.css`
  - Integrate with top toolbar created in T5

  **Must NOT do**:
  - Do NOT remove the existing settings modal in index.html (repurpose its content)
  - Do NOT make admin features inaccessible — they must be reachable from the panel
  - Do NOT lose any admin functionality from the original separate pages

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Slide-out panel with glassmorphism and complex interaction patterns
  - **Skills**: [`frontend-ui-ux`, `git-master`]
    - `frontend-ui-ux`: Panel overlay UX, transitions, glassmorphism
    - `git-master`: Atomic commit
  - **Skills Evaluated but Omitted**:
    - `typescript-programmer`: Vanilla JS
    - `agent-browser`: Verification in T14

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T11, T13)
  - **Parallel Group**: Wave 5
  - **Blocks**: T14
  - **Blocked By**: T9 (admin modules must exist), T11 (needs hub integration context)

  **References**:

  **Pattern References**:
  - `frontend/web/public/index.html:287-320` — Existing settings modal (LLM model settings, theme settings, MCP settings)
  - `frontend/web/public/js/nav-items.js:27-36` — Admin nav items (사용자 관리, 통합 모니터링, 감사 로그, 외부 연동, 분석 대시보드, 알림 관리, 비밀번호 변경, 설정)
  - `frontend/web/public/css/glassmorphism.css` — Glass effects for panel backdrop
  - Admin page modules from T9

  **Acceptance Criteria**:

  ```bash
  # Files exist:
  ls frontend/web/public/js/components/admin-panel.js frontend/web/public/css/admin-panel.css
  # Assert: Both files exist
  ```

  **For Frontend verification** (using playwright skill):
  ```
  1. Navigate to: http://localhost:52416/
  2. Wait for: top toolbar visible
  3. Click: settings gear icon in toolbar
  4. Wait for: admin panel slides in from right
  5. Assert: Panel visible with admin links
  6. Click: "설정" link in admin panel
  7. Wait for: settings content loads in panel
  8. Assert: Theme toggles and other settings visible
  9. Click: outside panel to close
  10. Assert: Panel closed
  11. Screenshot: .sisyphus/evidence/t12-admin-panel.png
  ```

  **Evidence to Capture:**
  - [ ] admin-panel.js and admin-panel.css files
  - [ ] Screenshot showing admin panel slide-out

  **Commit**: YES
  - Message: `feat(admin): add slide-out admin/settings panel with glassmorphism overlay`
  - Files: `frontend/web/public/js/components/admin-panel.js`, `frontend/web/public/css/admin-panel.css`
  - Pre-commit: N/A

---

### - [x] T13. CSS Consolidation + Visual Polish

  **What to do**:
  - Review ALL CSS for conflicts, duplication, and consistency now that all modules load in one SPA
  - **Tasks**:
    1. Audit all page module `getCSS()` outputs for selector conflicts (e.g., `.modal`, `.toast`, `.badge` — common class names used differently across pages)
    2. Ensure all page-specific CSS is properly namespaced (`.page-canvas .modal`, `.page-admin .badge`, etc.)
    3. Consolidate common patterns (toast, modal, badge, table styles) into `components.css` if not already there
    4. Remove duplicate CSS rules that are now redundant
    5. Ensure unified-sidebar.css, tool-picker.css, admin-panel.css work together
    6. Test light theme still works (data-theme="light")
    7. Test responsive breakpoints (mobile, tablet, desktop)
    8. Add page transition animations (fade-in/slide when SPA navigates between modules)
    9. Verify glassmorphism effects work across all components
  - **Design polish**:
    - Smooth page transitions (opacity + translateY animation)
    - Loading state when modules are being fetched
    - Active state indication for current tool in tool picker
    - Hover effects consistent across all interactive elements

  **Must NOT do**:
  - Do NOT change the design tokens (colors, fonts, spacing)
  - Do NOT remove light theme support
  - Do NOT break any page's visual appearance

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: CSS audit and visual polish requiring design eye
  - **Skills**: [`frontend-ui-ux`, `git-master`]
    - `frontend-ui-ux`: CSS architecture, visual consistency, animation polish
    - `git-master`: Commit CSS changes
  - **Skills Evaluated but Omitted**:
    - `typescript-programmer`: Pure CSS work

  **Parallelization**:
  - **Can Run In Parallel**: YES (with T11, T12)
  - **Parallel Group**: Wave 5
  - **Blocks**: T14
  - **Blocked By**: T4 (sidebar CSS), T5 (SPA shell), T6-T10 (all page modules with their CSS)

  **References**:

  **Pattern References**:
  - `frontend/web/public/css/design-tokens.css` — Foundation: variables, resets, utilities (DON'T MODIFY)
  - `frontend/web/public/css/components.css` — Shared component styles
  - `frontend/web/public/css/layout.css` — Layout system (sidebar, main-content, page-header)
  - `frontend/web/public/css/glassmorphism.css` — Glass effects
  - `frontend/web/public/css/animations.css` — Animation library
  - `frontend/web/public/css/icons.css` — Icon styles
  - `frontend/web/public/style.css` — index.html specific styles (1678 lines)
  - `frontend/web/public/css/dark-sidebar.css` — Old sidebar dark theme
  - `frontend/web/public/css/light-theme.css` — Light theme overrides
  - All new CSS from T4, T11, T12

  **Acceptance Criteria**:

  ```bash
  # No un-namespaced common selectors in page modules:
  for f in frontend/web/public/js/modules/pages/*.js; do
    echo "=== $f ===";
    grep -o "\.modal\b\|\.toast\b\|\.badge\b\|\.btn\b" "$f" | sort -u;
  done
  # Assert: Common selectors are namespaced (.page-xxx .modal, not just .modal)
  ```

  **For Frontend verification** (using playwright skill):
  ```
  1. Navigate through all major routes: /, /canvas.html, /research.html, /admin.html, /settings.html
  2. At each route:
     a. Screenshot the page
     b. Assert: No visual glitches (broken layouts, overlapping elements)
     c. Assert: Dark theme consistent
  3. Toggle theme to light
  4. Verify light theme works on current page
  5. Toggle back to dark
  6. Save screenshots to .sisyphus/evidence/t13-css-audit/
  ```

  **Evidence to Capture:**
  - [ ] Screenshots of all major pages showing consistent styling
  - [ ] Light theme verification screenshots

  **Commit**: YES
  - Message: `style(spa): consolidate CSS, namespace page styles, add page transitions`
  - Files: Various CSS files
  - Pre-commit: N/A

---

### - [x] T14. Integration Testing + Browser Verification

  **What to do**:
  - Comprehensive end-to-end verification of the entire SPA
  - **Backend tests**:
    ```bash
    cd backend/api && bun test
    # Must: 9 suites, 180 tests, 0 failures
    ```
  - **Frontend verification checklist** (using playwright skill):
    1. **Chat Hub**: Navigate to `/`, verify welcome screen, send a test message, verify response renders
    2. **Sidebar**: Verify 3-state toggle (full → icon → hidden on mobile), hover-expand, conversation list loads
    3. **Tool Picker**: Click each tool button, verify page loads correctly
    4. **SPA Navigation**: Use browser back/forward, verify correct page loads, URL updates correctly
    5. **Page modules (ALL 21)**: Navigate to each route, verify content loads, no JS errors in console
    6. **Admin Panel**: Open admin panel, navigate to each admin section
    7. **Settings**: Open settings, toggle theme, change model, verify changes persist
    8. **Auth flow**: Logout → verify restricted pages redirect to login. Login → verify access restored
    9. **Mobile responsiveness**: Resize to mobile viewport, verify sidebar hidden, hamburger menu works
    10. **Deep link**: Open `http://localhost:52416/canvas.html` directly → verify SPA loads correctly (not redirect loop)
    11. **Keyboard shortcut**: Ctrl+B toggles sidebar
  - **Deploy pipeline test**:
    ```bash
    bash scripts/deploy-frontend.sh
    # Verify: Files copied correctly to backend/api/dist/public/
    ```
  - Document ALL issues found and fix them

  **Must NOT do**:
  - Do NOT skip any page in the verification
  - Do NOT ignore console errors — all must be resolved
  - Do NOT mark as done until ALL checks pass

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Browser-based visual + functional verification
  - **Skills**: [`frontend-ui-ux`, `agent-browser`, `git-master`]
    - `frontend-ui-ux`: Visual regression detection
    - `agent-browser`: Playwright automation for comprehensive browser testing
    - `git-master`: Fix commits for any issues found
  - **Skills Evaluated but Omitted**:
    - `typescript-programmer`: Fixes might be in TS (backend) or JS (frontend)

  **Parallelization**:
  - **Can Run In Parallel**: NO (must run after everything)
  - **Parallel Group**: Wave 6 (sequential)
  - **Blocks**: T15
  - **Blocked By**: T11, T12, T13 (all implementation must be complete)

  **References**:

  **Pattern References**:
  - ALL previous task outputs
  - `backend/api/src/__tests__/` — Backend test suites
  - `scripts/deploy-frontend.sh` — Deploy pipeline

  **Acceptance Criteria**:

  ```bash
  # Backend tests:
  cd backend/api && bun test
  # Assert: 9 suites, 180 tests, 0 failures
  ```

  **For Frontend verification** (using playwright skill):
  ```
  # Comprehensive test sequence:
  1. Navigate to: http://localhost:52416/
  2. Assert: Welcome screen visible
  3. Assert: Sidebar visible (full state)
  
  # Chat test:
  4. Type "Hello" in chat input
  5. Click send
  6. Wait 5s for response
  7. Assert: AI response appears in chat
  
  # Sidebar states:
  8. Click sidebar toggle → Assert icon mode (64px)
  9. Hover sidebar → Assert overlay expand
  10. Click sidebar toggle → Assert full mode
  
  # Tool picker navigation:
  11. Click "캔버스" → Assert canvas page loads, URL = /canvas.html
  12. Click browser back → Assert chat hub
  13. Click "딥 리서치" → Assert research page loads
  14. Click "MCP 도구" → Assert mcp-tools page loads
  
  # Admin panel:
  15. Click settings gear → Assert admin panel opens
  16. Click "사용자 관리" → Assert admin page in panel
  17. Close panel
  
  # All pages check (navigate to each):
  18-38. For each of the 21 pages:
    - Navigate via Router
    - Assert: Content loads without JS errors
    - Assert: Page-specific functionality works
  
  # Mobile check:
  39. Resize viewport to 375x812
  40. Assert: Sidebar hidden
  41. Click hamburger → Assert sidebar overlay
  42. Close sidebar
  
  # Deep link:
  43. Navigate directly to http://localhost:52416/canvas.html
  44. Assert: SPA loads, sidebar present, canvas content shown
  
  # Save evidence:
  45. Screenshots to .sisyphus/evidence/t14-integration/
  ```

  **Evidence to Capture:**
  - [ ] Backend test output (180 passing)
  - [ ] Screenshots of all 21 page modules loaded in SPA
  - [ ] Screenshots of sidebar states, tool picker, admin panel
  - [ ] Mobile viewport screenshots

  **Commit**: YES (only if fixes needed)
  - Message: `fix(spa): resolve integration issues found during testing`
  - Files: Various
  - Pre-commit: `cd backend/api && bun test`

---

### - [x] T15. Deploy Pipeline Verification

  **What to do**:
  - Run the full deploy pipeline and verify the SPA works from the deployed location
  - **Steps**:
    1. Run `bash scripts/deploy-frontend.sh`
    2. Verify all new files are copied:
       - `js/spa-router.js`
       - `js/components/unified-sidebar.js`
       - `js/components/admin-panel.js`
       - `js/modules/pages/*.js` (21 files)
       - `css/unified-sidebar.css`
       - `css/tool-picker.css`
       - `css/admin-panel.css`
    3. Start the backend server
    4. Navigate to `http://localhost:52416/` and verify SPA works
    5. Run backend tests one final time
  - Fix deploy script if new files aren't being copied (e.g., new directories need to be included)

  **Must NOT do**:
  - Do NOT modify the deploy script's core logic (only add new paths if needed)
  - Do NOT skip backend test verification

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Script execution and verification
  - **Skills**: [`git-master`]
    - `git-master`: Final commit if deploy script updated
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: No design work
    - `agent-browser`: Already verified in T14

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 6 (after T14)
  - **Blocks**: None (final task)
  - **Blocked By**: T14

  **References**:

  **Pattern References**:
  - `scripts/deploy-frontend.sh` — Current deploy script (read to understand copy patterns)

  **Acceptance Criteria**:

  ```bash
  # Deploy:
  bash scripts/deploy-frontend.sh
  # Assert: Exit code 0
  
  # Verify new files in deploy target:
  ls backend/api/dist/public/js/spa-router.js backend/api/dist/public/js/components/unified-sidebar.js backend/api/dist/public/css/unified-sidebar.css
  # Assert: All new files present
  
  ls backend/api/dist/public/js/modules/pages/ | wc -l
  # Assert: 21 page module files
  
  # Final backend test:
  cd backend/api && bun test
  # Assert: 9 suites, 180 tests, 0 failures
  ```

  **Evidence to Capture:**
  - [ ] Deploy script output
  - [ ] File listing showing all new files in deploy target
  - [ ] Final test output

  **Commit**: YES (if deploy script updated)
  - Message: `build(deploy): update deploy script for new SPA files and module directories`
  - Files: `scripts/deploy-frontend.sh`
  - Pre-commit: `cd backend/api && bun test`

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| T0a | `fix(agents): reorder routes to prevent /:id from catching named paths` | agents.routes.ts | bun test |
| T0b | `fix(server): resolve dual router mount conflicts for /api/agents and /api/metrics` | server.ts | bun test |
| T0c | `fix(analytics): use API response uptime instead of browser-side process.uptime` | analytics.html | Browser check |
| T3 | `feat(spa): add vanilla JS SPA router with History API and dynamic module loading` | spa-router.js | N/A |
| T4 | `feat(sidebar): add unified 3-state sidebar with icon mode and hover-expand overlay` | unified-sidebar.js, unified-sidebar.css | Browser check |
| T5 | `feat(spa): restructure index.html as SPA shell with page-content and panel containers` | index.html | Browser check |
| T6 | `feat(spa): convert tool pages (canvas, research, mcp-tools) to SPA modules` | 3 modules + 3 HTML | N/A |
| T7 | `feat(spa): convert agent pages (marketplace, custom-agents, agent-learning) to SPA modules` | 3 modules + 3 HTML | N/A |
| T8 | `feat(spa): convert monitoring pages to SPA modules` | 5 modules + 5 HTML | N/A |
| T9 | `feat(spa): convert admin pages to SPA modules` | 7 modules + 7 HTML | N/A |
| T10 | `feat(spa): convert utility pages (history, guide) to SPA modules` | 2 modules + 2 HTML | N/A |
| T11 | `feat(hub): add Gemini-style chat hub with tool picker bar` | index.html, tool-picker.css | Browser check |
| T12 | `feat(admin): add slide-out admin/settings panel with glassmorphism overlay` | admin-panel.js, admin-panel.css | Browser check |
| T13 | `style(spa): consolidate CSS, namespace page styles, add page transitions` | Various CSS | Browser check |
| T14 | `fix(spa): resolve integration issues found during testing` | Various | bun test + Browser |
| T15 | `build(deploy): update deploy script for new SPA files` | deploy-frontend.sh | bun test |

---

## Success Criteria

### Verification Commands
```bash
# Backend tests:
cd backend/api && bun test
# Expected: 9 suites, 180 tests, 0 failures

# Deploy pipeline:
bash scripts/deploy-frontend.sh
# Expected: Exit code 0, all files copied

# File count verification:
ls frontend/web/public/js/modules/pages/*.js | wc -l
# Expected: 21 page module files

# No browser-side process references:
grep -r "process\." frontend/web/public/js/modules/pages/ | grep -v "//.*process"
# Expected: No matches (process is server-only)
```

### Final Checklist
- [ ] All "Must Have" present: 3-state sidebar, tool picker, SPA routing, all 22 pages working, admin panels
- [ ] All "Must NOT Have" absent: No frameworks, no build tools, no broken login, no removed features
- [x] All 180 backend tests pass
- [ ] All 21 page modules load correctly in SPA
- [ ] Sidebar: Full → Icon → Hidden works with hover expand
- [ ] Tool picker navigates to tool pages
- [ ] Admin panel opens from settings gear
- [x] Browser back/forward works
- [x] Mobile responsive layout works
- [ ] Deep links work (direct URL access)
- [ ] Deploy pipeline copies all new files
- [ ] Korean UI throughout
- [ ] Dark theme + glassmorphism maintained
- [ ] Light theme still works
