<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# frontend/web/public/js/components

## Purpose
Reusable self-contained UI component modules. Each component is an ES Module that encapsulates its own DOM manipulation, event binding, and state. Components are mounted by `main.js` or page modules and expose their API via both named exports and `window.*` globals for inline handler compatibility.

## Key Files
| File | Description |
|------|-------------|
| `unified-sidebar.js` | 3-state Gemini-style sidebar component with collapsed, icon-only, and expanded states. Manages sidebar toggle animations, active route highlighting, and user role-based nav item visibility. |
| `sidebar.js` | Legacy sidebar component retained for compatibility. Superseded by `unified-sidebar.js` for new development. |
| `admin-panel.js` | Floating admin panel overlay component. Provides quick-access admin actions without navigating away from the current page. |

## For AI Agents
### Working In This Directory
- Components must export their public API as named exports AND register on `window.*` for any functions called from inline HTML `onclick` attributes.
- Each component should be self-contained: its own DOM queries, event listeners, and cleanup logic.
- Prefer `unified-sidebar.js` over `sidebar.js` for any sidebar-related changes — `sidebar.js` is legacy.
- Component styles live in `css/unified-sidebar.css`, `css/dark-sidebar.css`, and `css/layout.css` — do not embed styles inline in JS.
- Components must not import from `modules/pages/` — that would create a circular dependency.

### Testing Requirements
- Component rendering should be verifiable via E2E tests in `tests/e2e/`.
- After modifying `unified-sidebar.js`, verify sidebar state transitions (collapsed → icon → expanded) and active route highlighting work correctly.

### Common Patterns
- Component initialization follows: `createComponent()` returns a controller object with `mount(containerEl)`, `update(data)`, and `destroy()` methods.
- Event delegation is preferred over per-element listeners for dynamically rendered lists.
- `window.sidebarComponent = ...` pattern for global access from inline handlers.

## Dependencies
### Internal
- `css/unified-sidebar.css` — sidebar component styles
- `css/dark-sidebar.css` — dark variant styles
- `modules/state.js` — reads `AppState.currentRoute` for active highlighting
- `modules/auth.js` — reads user role for nav item visibility

### External
- None — plain vanilla JS, no component framework.

<!-- MANUAL: -->
