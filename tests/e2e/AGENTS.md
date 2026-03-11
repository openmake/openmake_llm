<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# tests/e2e

## Purpose
Playwright E2E tests for critical user flows in the OpenMake LLM platform. Tests run against Chromium and WebKit browsers and require a live server on the configured base URL. These tests cover server health, authentication, and chat interaction flows end-to-end.

## Key Files
| File | Description |
|------|-------------|
| `main-flow.spec.ts` | Primary E2E spec covering server health check, login flow, and core chat interaction flows. |

## For AI Agents
### Working In This Directory
- Tests require a running server — start with `npm start` or `npm run dev` before running E2E tests.
- Base URL is configured in `playwright.config.ts` at the project root (default: `http://localhost:52416`).
- Tests target Chromium and WebKit — do not assume Chrome-only APIs.
- Page selectors should use `data-testid` attributes where available; avoid brittle CSS class selectors.

### Testing Requirements
- Run all E2E tests: `npm run test:e2e` (uses `npx playwright test`)
- Run in interactive UI mode: `npm run test:e2e:ui`
- Run a single spec: `npx playwright test tests/e2e/main-flow.spec.ts`
- Tests must pass on both Chromium and WebKit before merging.

### Common Patterns
- Use `page.waitForSelector()` or `page.waitForResponse()` rather than fixed `setTimeout` delays.
- Authentication state can be reused across tests via Playwright's `storageState` feature.
- WebSocket chat tests should await the WS `message` event, not poll the DOM.

## Dependencies
### Internal
- `playwright.config.ts` — browser targets, base URL, timeout configuration
- Running server (`backend/api/`) — E2E tests require the full stack to be live

### External
- `@playwright/test` — test framework and browser automation
- Chromium, WebKit — browser engines installed via `npx playwright install`

<!-- MANUAL: -->
