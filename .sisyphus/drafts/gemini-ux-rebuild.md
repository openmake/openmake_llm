# Draft: OpenMake.AI Gemini-Style UX Rebuild

## Requirements (confirmed)
- **Approach**: 방안 C — Complete Gemini Restructuring
- **Sidebar**: Conversation list ONLY (like Gemini), 3-state: Full(280px) → Icon(64px) → Hidden(0px mobile only)
- **Icon mode**: Hover to temporarily expand (overlay style, not pushing content)
- **Tools**: Accessible from chat input area (tool picker buttons)
- **Admin/settings**: Modals or slide-out panels
- **SPA conversion**: 22 pages → dynamically loaded content within index.html
- **login.html stays separate** (not SPA-ified)
- **Keep existing dark theme + glassmorphism design**
- **Vanilla JS only** — no React/Vue/frameworks
- **Korean language UI** (all labels in Korean)
- **180 backend tests must continue passing**
- **Stitch MCP for UI design/prototyping**

## Technical Decisions
- Client-side routing via History API (pushState)
- Each page becomes a "module" that loads HTML + initializes JS
- Unified sidebar component replaces both System A and System B
- nav-items.js becomes the SPA route registry
- Page-specific CSS loaded dynamically or consolidated

## Research Findings (from direct code inspection)

### Current Architecture
- **23 HTML pages** in frontend/web/public/
- **agents.html is already removed** (redirects to `/`)
- **Sidebar System A** (index.html): Inline HTML with logo, theme toggle, new chat button, recent conversations, page navigation menu (from nav-items.js), user section, A2A agents
- **Sidebar System B** (sidebar.js): SharedSidebar class renders into `<aside id="sidebar">` — used by 21 other pages (not index.html or login.html)
- **CSS System**: design-tokens.css (580 lines) defines all variables, layout.css (750 lines), style.css (1678 lines — index.html specific), components.css, glassmorphism.css, animations.css, icons.css, feature-cards.css, dark-sidebar.css, light-theme.css
- **Layout pattern**: System B pages use `.layout > .sidebar + .sidebar-overlay + .main-content > .page-header + .content-area` structure
- **app.js monolith**: 2858 lines handling chat, auth, WebSocket, settings, conversation management — already has modular equivalents in js/modules/

### Known Bugs (confirmed)
1. **agents.routes.ts**: Route ordering — `/:id` (line 72) catches before `/custom/list` (114), `/feedback/stats` (315), `/abtest` (355). Fix: move `/:id` to AFTER all named routes.
2. **server.ts**: Dual mount of `/api/agents` — agentRouter (line 367) and agentsMonitoringRouter (line 396) both on same path. Also `/api/metrics` metricsRouter (366) conflicts with inline GET `/api/metrics` handler (411). Fix: consolidate or use sub-paths.
3. **analytics.html**: `process.uptime()` called in browser (line 114) — `process` is Node.js only. Fix: use API response data for uptime instead.

### Page Categorization (22 pages to convert + login stays)
**Core/Chat**: index.html (becomes the SPA shell)
**Tools**: canvas.html, research.html, mcp-tools.html
**Agents**: marketplace.html, custom-agents.html, agent-learning.html (agents.html already removed)
**Monitoring**: cluster.html, usage.html, analytics.html, token-monitoring.html, admin-metrics.html
**Admin**: admin.html, audit.html, external.html, alerts.html, memory.html, settings.html, password-change.html
**Utility**: history.html, guide.html
**Separate**: login.html (stays)

## Open Questions
- None critical remaining — all decisions captured

## Scope Boundaries
- INCLUDE: Bug fixes, sidebar unification, SPA routing, page module conversion, tool picker, admin panels, testing
- EXCLUDE: login.html (stays separate), backend API changes (except bug fixes), new features, mobile app
