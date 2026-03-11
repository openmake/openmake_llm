<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# frontend/web/public

## Purpose
Static SPA assets served directly by the Express backend with no build step for JavaScript. All HTML, CSS, and JS files are served as-is. JavaScript uses native ES Modules loaded via `<script type="module">`. The SPA entry point is `index.html`; routing is handled client-side by `js/spa-router.js`.

## Key Files
| File | Description |
|------|-------------|
| `index.html` | SPA shell — loads core modules, defines layout skeleton, bootstraps the app. |
| `settings.html` | Standalone settings page with its own script entry point (`js/settings-standalone.js`). |
| `app.js` | Legacy global script (retained for compatibility); prefer ES Module equivalents in `js/modules/`. |
| `style.css` | Global base styles; imports and extends `css/design-tokens.css`. |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `css/` | Global stylesheet layer — see `css/AGENTS.md` |
| `js/` | JavaScript entry points and SPA infrastructure — see `js/AGENTS.md` |

## For AI Agents
### Working In This Directory
- All JS files must use `type="module"` in `<script>` tags. UMD vendor libraries in `js/vendor/` are the only exception.
- Cache busters (`?v=N`) in HTML script/link tags must be kept in sync with the referenced files when content changes.
- Do not introduce a bundler, transpiler, or framework — the project deliberately uses unbundled ES Modules.
- `index.html` is the single HTML shell; new pages are JS modules loaded by the SPA router, not separate HTML files (except standalone pages like `settings.html`).

### Testing Requirements
- Validate ES Module integrity after adding or renaming files: `bash frontend/web/scripts/validate-modules.sh`
- E2E tests in `tests/e2e/` exercise flows through these assets against a live server.

### Common Patterns
- Inline `<script type="module">` blocks in HTML use `window.*` globals (not imports) for `onclick` handlers.
- Static assets (images, fonts) are referenced with root-relative paths (`/images/...`).

## Dependencies
### Internal
- `backend/api/src/middlewares/` — static file middleware serves this directory
- `js/modules/` — core business logic modules
- `css/design-tokens.css` — design token source of truth

### External
- Browser native ES Module support (no polyfills)
- Vendor libraries in `js/vendor/` (Chart.js UMD, etc.)

<!-- MANUAL: -->
