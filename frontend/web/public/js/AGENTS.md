<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# frontend/web/public/js

## Purpose
Top-level JavaScript entry points and SPA infrastructure. All JS is served as native ES Modules with no bundler. This directory contains the app entry point, client-side router, navigation data, and the standalone settings script. Core business logic lives in `modules/`; reusable UI components live in `components/`; third-party libraries live in `vendor/`.

## Key Files
| File | Description |
|------|-------------|
| `main.js` | App entry point. Bootstraps the SPA: initializes auth, loads AppState, mounts the sidebar, and starts the router. |
| `spa-router.js` | History API-based SPA router. Maps URL paths to page module names, dynamically imports page modules via `loadModule()`, and calls `init()`/`cleanup()` lifecycle hooks. |
| `nav-items.js` | Sidebar navigation data — array of nav item definitions (label, icon, route, role requirements). |
| `settings-standalone.js` | Standalone script for `settings.html`. Operates independently of the SPA router. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `components/` | Reusable self-contained UI component modules — see `components/AGENTS.md` |
| `modules/` | Core application logic modules — see `modules/AGENTS.md` |
| `vendor/` | Third-party libraries (UMD bundles, not ES Modules) |

## For AI Agents
### Working In This Directory
- `spa-router.js` is the routing authority — to add a new page, register its route here and create a matching page module in `modules/pages/`.
- `main.js` initialization order matters: auth must resolve before the router starts, and AppState must be initialized before any module that reads it.
- `settings-standalone.js` does not participate in the SPA lifecycle — it cannot use `import` from `modules/` at load time; use `window.*` globals instead.
- Files in `vendor/` are UMD/classic scripts loaded with plain `<script>` tags (no `type="module"`); do not modify them.

### Testing Requirements
- After routing changes, run `bash frontend/web/scripts/validate-modules.sh` to verify all module references resolve.
- E2E tests in `tests/e2e/` validate navigation flows through the router.

### Common Patterns
- Page modules export `{ getHTML, init, cleanup }` and are loaded lazily by `spa-router.js`.
- Global functions needed by inline `onclick` handlers must be registered on `window` explicitly.
- `nav-items.js` entries use `role` field to control sidebar visibility by user role.

## Dependencies
### Internal
- `modules/auth.js` — authentication state consumed by `main.js` and router
- `modules/state.js` — `AppState` initialized in `main.js`
- `components/unified-sidebar.js` — mounted by `main.js`

### External
- Browser History API (`pushState`, `popstate`)
- Vendor libraries in `vendor/` (Chart.js, etc.)

<!-- MANUAL: -->
