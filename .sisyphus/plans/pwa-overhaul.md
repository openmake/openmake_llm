# PWA Overhaul: OpenMake.Ai

## TL;DR

> **Quick Summary**: Transform the partially-broken PWA implementation of OpenMake.Ai into a fully-functional Progressive Web App. Fix broken icons/manifest, completely rewrite the service worker with proper caching, add offline support, improve install experience, and optimize server-side caching headers.
>
> **Deliverables**:
> - Complete icon set generated from logo.png (8 sizes + maskable + favicon)
> - Fixed manifest.json with correct branding and icon paths
> - Rewritten service-worker.js with comprehensive caching strategy
> - Offline fallback page and offline indicator UI
> - Install prompt UI (Chrome + iOS guidance)
> - Server-side Cache-Control headers
> - Consistent PWA meta tags across all HTML entry points
> - Push notification foundation (VAPID keys + basic subscription endpoint)
>
> **Estimated Effort**: Large (8-10 tasks, ~2-3 days)
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 (Icons) → Task 2 (Manifest) → Task 3 (Service Worker) → Task 6 (Offline Support)

---

## Context

### Original Request
사용자가 openmake_llm 프로젝트를 제대로된 PWA로 수정/개선하는 개발계획을 요청함. The project is an Express.js + Vanilla JS SPA chat application with a partially-implemented, broken PWA. Primary user device is iPhone (iOS Safari).

### Interview Summary
**Key Discussions**:
- The existing PWA implementation references non-existent icon files, uses wrong branding ("Ollama" instead of "OpenMake.Ai"), and has a severely incomplete service worker cache list
- No build tools are used — vanilla JS with manual file copy deployment via `scripts/deploy-frontend.sh`
- The deploy script already auto-bumps SW cache version with timestamps (good foundation)
- WebSocket module already has exponential backoff reconnection (usable for offline recovery)
- macOS `sips` CLI is available for icon resizing (no need for npm image packages)
- iOS Safari is primary target — must handle iOS PWA quirks

**Research Findings**:
- iOS Safari supports Web Push since 16.4+ but requires VAPID + user gesture
- iOS Safari can evict service workers after days of non-use — cache strategy must be resilient
- Maskable icons need separate manifest entries (not combined `any maskable` purpose — this is a common mistake, present in current manifest)
- CDN resources (Pretendard font, Iconify, marked.js, highlight.js, DOMPurify) should use stale-while-revalidate
- The current STATIC_ASSETS list has only 9 entries; the actual cacheable file count is 50+

### Metis Review (Self-Analysis)
**Identified Gaps** (addressed in plan):
- Gap: No favicon.ico or apple-touch-icon-precomposed → Task 1 includes these
- Gap: Current manifest uses `"purpose": "any maskable"` on all icons → Task 2 separates these
- Gap: login.html has zero PWA support → Task 5 adds full meta tags
- Gap: No offline fallback page exists → Task 6 creates one
- Gap: deploy script overwrites SW but doesn't update icon files → Task 1 puts icons in frontend/web/public/
- Gap: css/pages/dashboard.css and css/pages/agents.css exist but weren't in user's CSS list → added to SW cache
- Gap: css/dark-sidebar.css exists but not in CSS list → added to SW cache
- Gap: js/components/admin-panel.js and js/components/sidebar.js exist but not in JS list → added to SW cache
- Gap: images/ directory has assets (avatars, backgrounds, branding, illustrations, icons) totaling ~2.5MB → selective caching needed
- Gap: External CDN deps won't cache without explicit strategy → Task 3 addresses

---

## Work Objectives

### Core Objective
Make OpenMake.Ai a fully installable, offline-capable PWA that works reliably on iOS Safari and Chrome, with correct branding, complete caching, and graceful offline degradation.

### Concrete Deliverables
- `/icons/` directory with 10 icon files (8 standard + 1 maskable-512 + 1 favicon)
- Updated `manifest.json` with "OpenMake.Ai" branding and verified icon paths
- Rewritten `service-worker.js` with 50+ cached assets and proper CDN strategy
- `offline.html` fallback page
- Offline indicator component in main UI
- Install prompt banner component
- Updated `server.ts` with Cache-Control headers
- Updated `index.html` and `login.html` with consistent PWA meta tags
- VAPID key pair + basic push subscription API endpoint (foundation only)

### Definition of Done
- [ ] `npx lighthouse --only-categories=pwa https://rasplay.tplinkdns.com:52416` scores 90+ on PWA
- [ ] App installs successfully on iOS Safari (Add to Home Screen → launches standalone)
- [ ] App installs successfully on Chrome desktop (install prompt triggers)
- [ ] Navigating to any SPA route while airplane mode shows cached content or offline fallback
- [ ] All manifest icons load (no 404s in DevTools)
- [ ] Service worker registers and caches all static assets on first visit

### Must Have
- All 8 icon sizes referenced in manifest must exist and load
- Apple touch icon must work on iOS
- Service worker must cache ALL JS, CSS, and HTML files
- Offline fallback when network unavailable
- Correct "OpenMake.Ai" branding everywhere (manifest, meta tags)
- Cache-Control headers for static assets

### Must NOT Have (Guardrails)
- Do NOT introduce webpack, vite, or any build tools
- Do NOT change the frontend from vanilla JS to a framework
- Do NOT modify the SPA router logic or page module loading pattern
- Do NOT add npm dependencies to the frontend (it's plain JS, no package.json)
- Do NOT over-cache API responses (they contain auth tokens and real-time data)
- Do NOT cache user-specific data in the service worker (use IndexedDB instead)
- Do NOT add heavy polyfills or libraries — keep it lightweight
- Do NOT change the Express server port or URL structure
- Do NOT modify the deploy-frontend.sh script logic (it already works well)

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: Playwright E2E available (`npx playwright test`)
- **User wants tests**: Manual verification + automated Lighthouse audit
- **Framework**: No unit test framework for vanilla JS frontend

### Automated Verification Approach

Each task includes verification via:
- **Lighthouse PWA audit**: Automated scoring
- **curl/HTTP checks**: Verify headers, file existence, icon loading
- **Playwright browser automation**: Install prompt, offline behavior, visual verification
- **Service Worker DevTools**: Cache inspection via browser automation

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - No Dependencies):
├── Task 1: Generate PWA Icons from logo.png
├── Task 5: PWA Meta Tags Consistency (index.html + login.html)
└── Task 7: Server-side Cache-Control Headers

Wave 2 (After Wave 1 - Needs Icons):
├── Task 2: Fix manifest.json
├── Task 4: Create Offline Fallback Page
└── Task 8: Push Notification Foundation

Wave 3 (After Wave 2 - Needs Manifest + Offline Page):
├── Task 3: Service Worker Complete Rewrite
└── Task 9: Performance Optimization (preloads, lazy loading)

Wave 4 (After Wave 3 - Needs Working SW):
├── Task 6: Offline Support (indicator UI, message queue, WS recovery)
└── Task 10: Install Experience (custom prompt, iOS guidance)

Wave 5 (Final Verification):
└── Task 11: Integration Testing & Lighthouse Audit
```

### Dependency Matrix

| Task | Depends On | Blocks | Can Parallelize With |
|------|------------|--------|---------------------|
| 1. Icons | None | 2, 3 | 5, 7 |
| 2. Manifest | 1 | 3 | 4, 8 |
| 3. Service Worker | 1, 2, 4 | 6, 10, 11 | 9 |
| 4. Offline Page | None (but best after 1 for icon ref) | 3 | 2, 8 |
| 5. Meta Tags | None | 11 | 1, 7 |
| 6. Offline Support | 3 | 11 | 10 |
| 7. Server Headers | None | 11 | 1, 5 |
| 8. Push Foundation | None | 11 | 2, 4 |
| 9. Performance | 2 | 11 | 3 |
| 10. Install Experience | 3 | 11 | 6 |
| 11. Integration Test | ALL | None | None (final) |

### Agent Dispatch Summary

| Wave | Tasks | Recommended Dispatch |
|------|-------|---------------------|
| 1 | 1, 5, 7 | 3 parallel agents (quick, quick, quick) |
| 2 | 2, 4, 8 | 3 parallel agents (quick, unspecified-low, unspecified-low) |
| 3 | 3, 9 | 2 parallel agents (unspecified-high, unspecified-low) |
| 4 | 6, 10 | 2 parallel agents (unspecified-high, unspecified-low) |
| 5 | 11 | 1 agent (visual-engineering with playwright) |

---

## TODOs

---

- [x] 1. Generate PWA Icons from logo.png ✅ (10개 아이콘 파일 생성됨)

  **What to do**:
  - Create directory `frontend/web/public/icons/`
  - Using macOS `sips` CLI, resize `frontend/web/public/logo.png` (496x503 PNG) to these sizes:
    - icon-72.png (72x72)
    - icon-96.png (96x96)
    - icon-128.png (128x128)
    - icon-144.png (144x144)
    - icon-152.png (152x152)
    - icon-192.png (192x192)
    - icon-384.png (384x384)
    - icon-512.png (512x512)
  - Create a maskable version of icon-512 with 20% safe zone padding (add solid background #0a0a0f around the logo so the logo occupies only the inner 80% of the canvas): `icon-512-maskable.png`
  - Create `favicon.png` at 32x32 from logo.png
  - Note: logo.png is 496x503 (not square!) — must first pad to square (503x503) before resizing to avoid distortion
  - Use `sips` commands:
    ```bash
    # Make square canvas first
    sips -p 503 503 --padColor 0A0A0F logo.png -o logo-square.png
    # Then resize each
    sips -z 72 72 logo-square.png -o icons/icon-72.png
    # ... repeat for each size
    ```
  - For maskable icon: create 640x640 canvas with #0a0a0f background, center the 512x512 logo in it, then resize to 512x512
  - Verify all files exist and are valid PNGs

  **Must NOT do**:
  - Do NOT install npm packages for image processing
  - Do NOT modify the original logo.png file
  - Do NOT create ICO format (modern browsers don't need it)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Shell commands only, no complex logic, just image resizing with sips
  - **Skills**: [`git-master`]
    - `git-master`: For clean commit of generated binary files
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: No UI work, just image processing
    - `typescript-programmer`: No code involved

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 5, 7)
  - **Blocks**: Tasks 2, 3
  - **Blocked By**: None

  **References**:
  - `frontend/web/public/logo.png` — Source image (496x503 PNG, RGBA, 301KB)
  - `frontend/web/public/manifest.json:icons` — Target icon paths (/icons/icon-{size}.png)
  - macOS `sips` man page: `man sips` — Image processing commands

  **Acceptance Criteria**:

  ```bash
  # Verify all icon files exist and are valid PNGs
  for size in 72 96 128 144 152 192 384 512; do
    file frontend/web/public/icons/icon-${size}.png | grep -q "PNG image"
    sips -g pixelWidth -g pixelHeight frontend/web/public/icons/icon-${size}.png
    # Assert: pixelWidth == $size AND pixelHeight == $size
  done

  # Verify maskable icon
  file frontend/web/public/icons/icon-512-maskable.png | grep -q "PNG image"
  sips -g pixelWidth -g pixelHeight frontend/web/public/icons/icon-512-maskable.png
  # Assert: 512x512

  # Verify favicon
  file frontend/web/public/icons/favicon.png | grep -q "PNG image"
  sips -g pixelWidth -g pixelHeight frontend/web/public/icons/favicon.png
  # Assert: 32x32

  # Verify no original file modified
  ls -la frontend/web/public/logo.png
  # Assert: file size still 301315 bytes
  ```

  **Commit**: YES
  - Message: `feat(pwa): generate icon set from logo.png for all required sizes`
  - Files: `frontend/web/public/icons/*`
  - Pre-commit: `ls frontend/web/public/icons/ | wc -l` → should be 10

---

- [x] 2. Fix manifest.json ✅ (OpenMake.Ai 브랜딩, #667eea 테마)

  **What to do**:
  - Update `name` from "Ollama AI Chat" to "OpenMake.Ai"
  - Update `short_name` from "Ollama" to "OpenMake"
  - Update `description` to "AI 기반 지능형 채팅 어시스턴트 - OpenMake.Ai"
  - Update `theme_color` from "#3b82f6" to "#667eea" (matches actual app accent color)
  - Keep `background_color` as "#0a0a0f" (correct dark background)
  - **FIX icon entries**: Separate `any` and `maskable` purposes (current `"any maskable"` causes issues on some browsers):
    ```json
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512-maskable.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
    ```
  - For sizes 72-384: use `"purpose": "any"` only (maskable only needed at 512)
  - Update shortcut icons to use existing icon paths
  - Add `"id": "/"` for stable PWA identity
  - Keep `display: "standalone"` (correct for chat app)
  - Keep `orientation: "portrait-primary"` (good for mobile-first)
  - Consider adding `screenshots` array for richer install prompt (add 2 screenshots: mobile + desktop)
    - For now, leave screenshots empty/omit — can be added later with actual screenshots

  **Must NOT do**:
  - Do NOT change `start_url`, `scope`, or `lang`
  - Do NOT add `display_override` (not needed, standalone is correct)
  - Do NOT add `prefer_related_applications: true`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single JSON file edit with known changes
  - **Skills**: []
    - No special skills needed for JSON editing
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: No UI work
    - `typescript-programmer`: Not TypeScript

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 8)
  - **Blocks**: Task 3
  - **Blocked By**: Task 1 (needs icons to exist for path verification)

  **References**:
  - `frontend/web/public/manifest.json` — Current file to edit (full contents known)
  - `frontend/web/public/css/design-tokens.css` — Check for actual --accent color value to confirm #667eea
  - Web App Manifest spec: https://www.w3.org/TR/appmanifest/ — Purpose field semantics
  - `frontend/web/public/icons/` — Icon files created in Task 1

  **Acceptance Criteria**:

  ```bash
  # Parse manifest and verify fields
  cat frontend/web/public/manifest.json | python3 -c "
  import json, sys
  m = json.load(sys.stdin)
  assert m['name'] == 'OpenMake.Ai', f'name wrong: {m[\"name\"]}'
  assert m['short_name'] == 'OpenMake', f'short_name wrong: {m[\"short_name\"]}'
  assert m['theme_color'] == '#667eea', f'theme_color wrong: {m[\"theme_color\"]}'
  assert m['background_color'] == '#0a0a0f', f'bg wrong: {m[\"background_color\"]}'
  # Check no 'any maskable' combined purpose
  for icon in m['icons']:
      assert icon['purpose'] != 'any maskable', f'Combined purpose found: {icon}'
  # Check maskable icon exists
  maskable = [i for i in m['icons'] if i['purpose'] == 'maskable']
  assert len(maskable) >= 1, 'No maskable icon found'
  print('All manifest checks passed')
  "

  # Verify all referenced icon files exist via HTTP
  # (run after server restart)
  for icon_path in $(cat frontend/web/public/manifest.json | python3 -c "import json,sys; [print(i['src']) for i in json.load(sys.stdin)['icons']]"); do
    test -f "frontend/web/public${icon_path}" && echo "OK: $icon_path" || echo "MISSING: $icon_path"
  done
  # Assert: ALL say "OK"
  ```

  **Commit**: YES
  - Message: `fix(pwa): update manifest.json branding to OpenMake.Ai with correct icons`
  - Files: `frontend/web/public/manifest.json`
  - Pre-commit: `python3 -c "import json; m=json.load(open('frontend/web/public/manifest.json')); assert m['name']=='OpenMake.Ai'"`

---

- [x] 3. Service Worker Complete Rewrite ✅ (327줄, openmake- 캐시명, 70+ 자산 캐싱)

  **What to do**:
  - Rewrite `frontend/web/public/service-worker.js` with comprehensive caching strategy
  - **Cache name**: Change from 'ollama-chat-v3' to 'openmake-v{VERSION}' (deploy script will auto-bump)
  
  - **STATIC_ASSETS** — Complete list of ALL files to pre-cache on install:
  
    HTML entry points (2):
    ```
    '/', '/index.html', '/login.html'
    ```
  
    CSS files (13):
    ```
    '/style.css',
    '/css/design-tokens.css', '/css/icons.css', '/css/glassmorphism.css',
    '/css/animations.css', '/css/feature-cards.css', '/css/unified-sidebar.css',
    '/css/light-theme.css', '/css/components.css', '/css/layout.css',
    '/css/dark-sidebar.css',
    '/css/pages/dashboard.css', '/css/pages/agents.css'
    ```
  
    JS core files (8):
    ```
    '/app.js', '/guide_content.js',
    '/js/spa-router.js', '/js/main.js', '/js/nav-items.js',
    '/js/components/unified-sidebar.js', '/js/components/admin-panel.js',
    '/js/components/sidebar.js'
    ```
  
    JS modules (11):
    ```
    '/js/modules/auth.js', '/js/modules/chat.js', '/js/modules/guide.js',
    '/js/modules/index.js', '/js/modules/sanitize.js', '/js/modules/settings.js',
    '/js/modules/state.js', '/js/modules/ui.js', '/js/modules/utils.js',
    '/js/modules/websocket.js'
    ```
  
    JS page modules (20):
    ```
    '/js/modules/pages/admin-metrics.js', '/js/modules/pages/admin.js',
    '/js/modules/pages/agent-learning.js', '/js/modules/pages/alerts.js',
    '/js/modules/pages/analytics.js', '/js/modules/pages/audit.js',
    '/js/modules/pages/canvas.js', '/js/modules/pages/cluster.js',
    '/js/modules/pages/custom-agents.js', '/js/modules/pages/external.js',
    '/js/modules/pages/guide.js', '/js/modules/pages/history.js',
    '/js/modules/pages/marketplace.js', '/js/modules/pages/mcp-tools.js',
    '/js/modules/pages/memory.js', '/js/modules/pages/password-change.js',
    '/js/modules/pages/research.js', '/js/modules/pages/settings.js',
    '/js/modules/pages/token-monitoring.js', '/js/modules/pages/usage.js'
    ```
  
    Assets (3):
    ```
    '/manifest.json', '/logo.png', '/offline.html'
    ```
  
    Icons (10):
    ```
    '/icons/icon-72.png', '/icons/icon-96.png', '/icons/icon-128.png',
    '/icons/icon-144.png', '/icons/icon-152.png', '/icons/icon-192.png',
    '/icons/icon-384.png', '/icons/icon-512.png', '/icons/icon-512-maskable.png',
    '/icons/favicon.png'
    ```
  
    Image assets (selectively - only small/critical ones):
    ```
    '/images/avatar/character-avatar.png',
    '/images/branding/ai-assistant-icon.png'
    ```
    (Skip large images: welcome-bg.png 499KB, illustrations, etc. — lazy cache these)
  
    TOTAL: ~70 assets to pre-cache
  
  - **Caching Strategies** by request type:
  
    | Request Type | Strategy | Rationale |
    |-------------|----------|-----------|
    | Static assets (JS/CSS/icons) | **Cache-first** | Immutable per deployment |
    | HTML documents (/, *.html) | **Network-first** with cache fallback | Get latest version, fall back to cached |
    | API requests (/api/*) | **Network-only** | Real-time data, auth-dependent |
    | CDN resources (jsdelivr, cdnjs) | **Stale-while-revalidate** | Versioned URLs, safe to cache |
    | Image assets (/images/*) | **Cache-first** with lazy population | Don't pre-cache all, cache on first request |
    | WebSocket (ws:/wss:) | **Passthrough** | Cannot cache WebSocket |
    | Offline fallback | Return `/offline.html` for navigation requests when network fails |
  
  - **CDN Resource Caching**:
    ```javascript
    // Separate cache for CDN resources
    const CDN_CACHE = 'openmake-cdn-v1';
    const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];
    // Strategy: stale-while-revalidate
    ```
  
  - **Cache Size Management**:
    - Static cache: unlimited (controlled by pre-cache list)
    - CDN cache: max 50 entries, LRU eviction
    - Image cache: max 100 entries, LRU eviction
    - Implement `trimCache(cacheName, maxItems)` helper
  
  - **SW Update Notification**:
    - On activate, post message to all clients: `{ type: 'SW_UPDATED', version: CACHE_NAME }`
    - Client side (in app.js or main.js): listen for this message and show a toast "새 버전이 있습니다. 새로고침해주세요."
  
  - **SPA Route Handling**:
    - For navigation requests to SPA routes (e.g., /settings.html, /history.html), if network fails, return cached `/index.html` (the SPA shell)
    - The SPA router will handle rendering the correct page from cached JS modules
  
  - **Background Sync** (keep stub, improve):
    - Register sync tag 'sync-messages' when user sends chat while offline
    - Handler: read from IndexedDB 'pending-messages' store, POST each to API
    - Note: iOS Safari does NOT support Background Sync — use fallback: retry on navigator.onLine event
  
  - **Push Handler** (improve existing):
    - Update icon paths in push handler from '/icons/icon-192.png' to verified paths
    - Add `data.url` support in notificationclick for deep linking

  **Must NOT do**:
  - Do NOT use importScripts() for external libraries in SW
  - Do NOT cache /api/* responses in SW (use IndexedDB from client instead)
  - Do NOT skip waiting without notifying users (current skipWaiting is OK for now but add notification)
  - Do NOT pre-cache image assets over 100KB (lazy cache instead)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Complex JavaScript with multiple caching strategies, edge cases, iOS quirks
  - **Skills**: [`typescript-programmer`]
    - `typescript-programmer`: Deep JS/TS knowledge for SW patterns (even though output is JS, patterns are same)
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: No visual UI in service worker
    - `agent-browser`: Not browser automation, it's SW code

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 9)
  - **Blocks**: Tasks 6, 10, 11
  - **Blocked By**: Tasks 1, 2, 4

  **References**:

  **Pattern References**:
  - `frontend/web/public/service-worker.js` — Current SW to rewrite (full contents known, 175 lines)
  - `scripts/deploy-frontend.sh:50-58` — Deploy script auto-bumps CACHE_NAME with sed (keep compatible format)

  **File References** (what to cache):
  - `frontend/web/public/` — Full file tree (91 files discovered via glob)
  - `frontend/web/public/css/` — 13 CSS files (including css/pages/ subdirectory)
  - `frontend/web/public/js/` — 39 JS files across modules/pages/components
  - `frontend/web/public/images/` — Image assets with sizes (avatar ~400KB each, backgrounds ~500KB)

  **API References**:
  - `frontend/web/public/index.html:55-61` — Current SW registration script pattern
  - `frontend/web/public/js/modules/websocket.js:1-50` — WebSocket reconnection pattern (reference for offline handling)

  **External References**:
  - Service Worker API: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
  - Workbox strategies (reference, not to use): https://developer.chrome.com/docs/workbox/modules/workbox-strategies
  - iOS SW quirks: iOS may evict SW cache after ~weeks of non-use

  **Acceptance Criteria**:

  ```bash
  # Verify SW file structure
  grep -q "openmake-" frontend/web/public/service-worker.js
  # Assert: Cache name uses 'openmake-' prefix (not 'ollama-')

  # Count cached assets in STATIC_ASSETS array
  grep -c "'/[^']*'" frontend/web/public/service-worker.js
  # Assert: >= 65 entries

  # Verify CDN caching code exists
  grep -q "cdn.jsdelivr.net\|cdnjs.cloudflare.com" frontend/web/public/service-worker.js
  # Assert: CDN hosts referenced

  # Verify offline fallback
  grep -q "offline.html" frontend/web/public/service-worker.js
  # Assert: offline.html referenced

  # Verify cache trimming function exists
  grep -q "trimCache\|maxItems\|MAX_CACHE" frontend/web/public/service-worker.js
  # Assert: Cache management exists

  # Verify SW update notification
  grep -q "SW_UPDATED\|postMessage" frontend/web/public/service-worker.js
  # Assert: Client notification on update
  ```

  **Playwright verification** (after deployment):
  ```
  # Agent executes via playwright:
  1. Navigate to: https://rasplay.tplinkdns.com:52416
  2. Open DevTools → Application → Service Workers
  3. Verify: SW is registered and active
  4. Open DevTools → Application → Cache Storage
  5. Assert: 'openmake-v*' cache exists with 65+ entries
  6. Assert: 'openmake-cdn-v1' cache exists
  7. Enable offline mode in DevTools
  8. Navigate to: /settings.html
  9. Assert: Page renders (from cached SPA shell)
  10. Screenshot: .sisyphus/evidence/task-3-sw-cache.png
  ```

  **Commit**: YES
  - Message: `feat(pwa): rewrite service worker with comprehensive caching strategy`
  - Files: `frontend/web/public/service-worker.js`
  - Pre-commit: `grep -c "'/[^']*'" frontend/web/public/service-worker.js` → >= 65

---

- [x] 4. Create Offline Fallback Page ✅ (offline.html 존재)

  **What to do**:
  - Create `frontend/web/public/offline.html` — a self-contained offline page
  - Design: Match app's dark theme (#0a0a0f background, #667eea accent)
  - Content (in Korean):
    - OpenMake.Ai logo (inline SVG or base64 of small logo, NOT external reference)
    - "오프라인 상태입니다" heading
    - "인터넷 연결이 끊어졌습니다. 연결이 복구되면 자동으로 다시 시도합니다." description
    - Auto-retry button: "다시 시도" that calls `window.location.reload()`
    - Auto-detect online event: `window.addEventListener('online', () => window.location.reload())`
  - CRITICAL: Page must be FULLY SELF-CONTAINED — ALL CSS inline, NO external file references
    - Inline the Pretendard font-face for basic text (or use system fonts as fallback)
    - Use system font stack as primary: `'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif`
  - Include meta viewport and theme-color tags
  - Include apple-mobile-web-app-capable meta tags (for iOS standalone mode)
  - Add subtle animation (CSS-only pulse on the retry icon)

  **Must NOT do**:
  - Do NOT reference external CSS/JS files (won't be available offline if cache miss)
  - Do NOT include heavy assets or images
  - Do NOT make it look like an error page — make it feel like part of the app

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
    - Reason: Single HTML file creation with inline CSS, moderate design effort
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Make offline page visually consistent with app design
  - **Skills Evaluated but Omitted**:
    - `typescript-programmer`: No JS logic beyond simple reload

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 2, 8)
  - **Blocks**: Task 3 (SW needs to reference offline.html)
  - **Blocked By**: None (can use logo inline/base64)

  **References**:
  - `frontend/web/public/css/design-tokens.css` — Color variables: --bg-app, --accent, --text-primary
  - `frontend/web/public/login.html` — Visual style reference (dark theme, glassmorphism)
  - `frontend/web/public/logo.png` — Logo to encode as base64 or trace to inline SVG

  **Acceptance Criteria**:

  ```bash
  # File exists
  test -f frontend/web/public/offline.html && echo "EXISTS" || echo "MISSING"
  # Assert: EXISTS

  # Is self-contained (no external CSS/JS references)
  grep -c 'link rel="stylesheet" href=' frontend/web/public/offline.html
  # Assert: 0 (all CSS is inline)

  grep -c '<script src=' frontend/web/public/offline.html
  # Assert: 0 (all JS is inline)

  # Has required Korean text
  grep -q "오프라인" frontend/web/public/offline.html
  # Assert: true

  # Has auto-reconnect listener
  grep -q "addEventListener.*online" frontend/web/public/offline.html
  # Assert: true

  # Has proper meta tags
  grep -q 'apple-mobile-web-app-capable' frontend/web/public/offline.html
  # Assert: true
  ```

  **Commit**: YES
  - Message: `feat(pwa): create self-contained offline fallback page`
  - Files: `frontend/web/public/offline.html`
  - Pre-commit: `grep -q "오프라인" frontend/web/public/offline.html`

---

- [x] 5. PWA Meta Tags Consistency ✅ (login.html에 SW 등록 + apple-mobile-web-app-capable 추가됨)

  **What to do**:
  - **index.html** updates:
    - Change `<meta name="apple-mobile-web-app-title" content="Ollama">` to `content="OpenMake.Ai"`
    - Change `<meta name="theme-color" content="#3b82f6">` to `content="#667eea"`
    - Change `<link rel="apple-touch-icon" href="/icons/icon-192.png">` — keep as-is (will work after Task 1)
    - Add `<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon.png">`
    - Add `<meta name="mobile-web-app-capable" content="yes">` (Chrome equivalent)
    - Add `<meta name="msapplication-TileColor" content="#0a0a0f">`
    - Add `<meta name="msapplication-TileImage" content="/icons/icon-144.png">`
    - Verify manifest link is `<link rel="manifest" href="/manifest.json">` (currently `href="manifest.json"` without leading /)
  
  - **login.html** updates (currently has ZERO PWA meta):
    - Add ALL the same PWA meta tags as index.html:
      ```html
      <meta name="theme-color" content="#667eea">
      <meta name="description" content="OpenMake.Ai - 로그인">
      <meta name="apple-mobile-web-app-capable" content="yes">
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
      <meta name="apple-mobile-web-app-title" content="OpenMake.Ai">
      <link rel="manifest" href="/manifest.json">
      <link rel="apple-touch-icon" href="/icons/icon-192.png">
      <link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon.png">
      ```
    - Add SW registration script (same as index.html):
      ```html
      <script>
        if ('serviceWorker' in navigator) {
          window.addEventListener('load', () => {
            navigator.serviceWorker.register('/service-worker.js')
              .then(reg => console.log('[PWA] SW 등록 성공'))
              .catch(err => console.warn('[PWA] SW 등록 실패:', err));
          });
        }
      </script>
      ```

  - **iOS Splash Screen** (Apple-specific):
    - Add apple-touch-startup-image meta tags for iOS splash screens
    - Minimum: one for iPhone portrait using icon-512.png
    - Use `<link rel="apple-touch-startup-image" href="/icons/icon-512.png">`
    - For proper iOS splash, would ideally need device-specific sizes — for now, use the 512 icon as a simple splash

  **Must NOT do**:
  - Do NOT change any other content in index.html or login.html (only <head> section)
  - Do NOT remove existing meta tags that are correct
  - Do NOT add meta tags for deprecated features (e.g., `apple-mobile-web-app-capable` is NOT deprecated — keep it)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple HTML meta tag edits in two files
  - **Skills**: []
    - No special skills needed
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: No visual changes, just meta tags

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 7)
  - **Blocks**: Task 11
  - **Blocked By**: None

  **References**:
  - `frontend/web/public/index.html:1-61` — Current <head> section with PWA meta tags
  - `frontend/web/public/login.html:1-20` — Current <head> section (missing PWA meta)
  - Apple Web App docs: https://developer.apple.com/documentation/webkit/creating-a-web-application

  **Acceptance Criteria**:

  ```bash
  # index.html checks
  grep -q 'apple-mobile-web-app-title" content="OpenMake.Ai"' frontend/web/public/index.html
  # Assert: true

  grep -q 'theme-color" content="#667eea"' frontend/web/public/index.html
  # Assert: true

  grep -q 'favicon.png' frontend/web/public/index.html
  # Assert: true

  # login.html checks
  grep -q 'apple-mobile-web-app-capable' frontend/web/public/login.html
  # Assert: true

  grep -q 'serviceWorker' frontend/web/public/login.html
  # Assert: true

  grep -q 'manifest' frontend/web/public/login.html
  # Assert: true

  grep -q 'theme-color" content="#667eea"' frontend/web/public/login.html
  # Assert: true
  ```

  **Commit**: YES
  - Message: `fix(pwa): unify PWA meta tags across index.html and login.html`
  - Files: `frontend/web/public/index.html`, `frontend/web/public/login.html`
  - Pre-commit: `grep -q 'OpenMake.Ai' frontend/web/public/index.html && grep -q 'serviceWorker' frontend/web/public/login.html`

---

- [x] 6. Offline Support (Indicator + Message Queue + WS Recovery) ✅ (offline-indicator.js 존재)

  **What to do**:
  This task adds client-side offline awareness to the app. Three sub-components:

  **6a. Offline Indicator UI**:
  - Create a new component: `frontend/web/public/js/components/offline-indicator.js`
  - Shows a banner at the top of the screen when `navigator.onLine === false`
  - Design: Full-width bar, amber/yellow background (#f59e0b), Korean text "오프라인 상태입니다. 일부 기능이 제한됩니다."
  - Listens for 'online' and 'offline' events on window
  - When back online: show green "연결 복구됨" for 3 seconds, then hide
  - Initialize in `app.js` or `main.js` — import and call `initOfflineIndicator()`
  - Also listen for WebSocket disconnect (already shows connection status dot) — coordinate with existing ws status

  **6b. Message Queue for Offline Chat**:
  - When user sends a chat message while offline (WS disconnected):
    - Instead of failing silently, show the message in chat with a "전송 대기 중" badge
    - Store the message in localStorage: `pendingMessages` array
    - When WS reconnects, automatically send all pending messages in order
    - After each successful send, remove from pendingMessages and update badge to "전송됨"
  - Modify `frontend/web/public/js/modules/chat.js` to add this queuing logic
  - Modify `frontend/web/public/js/modules/websocket.js` to flush queue on reconnect

  **6c. Enhanced WebSocket Recovery**:
  - Current: Exponential backoff with max 10 attempts (good)
  - Add: Also trigger reconnect on 'online' event (don't wait for timer)
  - Add: Reset reconnect counter when 'online' fires
  - Modify `frontend/web/public/js/modules/websocket.js`

  **Must NOT do**:
  - Do NOT implement IndexedDB for offline data (too complex for this task — defer to future)
  - Do NOT change the existing WebSocket protocol or message format
  - Do NOT block the UI while waiting for reconnection
  - Do NOT show offline indicator for brief network blips (add 2-second debounce)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Multiple files to modify, complex state management, needs careful integration
  - **Skills**: [`frontend-ui-ux`, `typescript-programmer`]
    - `frontend-ui-ux`: Offline indicator banner design and UX
    - `typescript-programmer`: JS module patterns, event handling, state management
  - **Skills Evaluated but Omitted**:
    - `agent-browser`: Not browser automation

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Task 10)
  - **Blocks**: Task 11
  - **Blocked By**: Task 3 (needs SW for offline detection to work properly)

  **References**:

  **Pattern References**:
  - `frontend/web/public/js/modules/websocket.js:1-50` — Current WS with reconnection logic (modify onclose, add online listener)
  - `frontend/web/public/js/modules/chat.js` — Chat message sending logic (add queue)
  - `frontend/web/public/js/modules/state.js` — State management pattern (import getState/setState)
  - `frontend/web/public/js/modules/ui.js` — UI helper functions (toast, etc.)
  - `frontend/web/public/js/components/unified-sidebar.js` — Component pattern to follow for new component

  **API References**:
  - `frontend/web/public/app.js` — Main entry point (where to import offline-indicator)
  - `frontend/web/public/js/main.js` — Initialization logic

  **Acceptance Criteria**:

  ```bash
  # New component file exists
  test -f frontend/web/public/js/components/offline-indicator.js
  # Assert: EXISTS

  # offline-indicator is imported somewhere
  grep -rq "offline-indicator" frontend/web/public/js/ frontend/web/public/app.js
  # Assert: true

  # WebSocket has online event listener
  grep -q "addEventListener.*online" frontend/web/public/js/modules/websocket.js
  # Assert: true

  # Chat module has pending message logic
  grep -q "pendingMessage\|pending-message\|messageQueue" frontend/web/public/js/modules/chat.js
  # Assert: true
  ```

  **Playwright verification**:
  ```
  # Agent executes via playwright:
  1. Navigate to: https://rasplay.tplinkdns.com:52416
  2. Login with test credentials
  3. Enable offline mode via DevTools
  4. Wait 3 seconds (debounce)
  5. Assert: Offline indicator banner visible with "오프라인" text
  6. Type a chat message and send
  7. Assert: Message appears with "전송 대기" indicator
  8. Disable offline mode
  9. Wait 5 seconds
  10. Assert: Offline banner disappears or shows "연결 복구됨"
  11. Screenshot: .sisyphus/evidence/task-6-offline-indicator.png
  ```

  **Commit**: YES
  - Message: `feat(pwa): add offline indicator, message queue, and enhanced WS recovery`
  - Files: `frontend/web/public/js/components/offline-indicator.js`, `frontend/web/public/js/modules/chat.js`, `frontend/web/public/js/modules/websocket.js`, `frontend/web/public/app.js`
  - Pre-commit: `test -f frontend/web/public/js/components/offline-indicator.js`

---

- [x] 7. Server-side Cache-Control Headers ✅ (server.ts에 Cache-Control 5건 적용됨)

  **What to do**:
  - Modify `backend/api/src/server.ts` to add proper Cache-Control headers in the `express.static` middleware
  - **Caching policy by file type**:

    | File Type | Cache-Control | Rationale |
    |-----------|--------------|-----------|
    | `.html` | `no-cache` | Always check for updates (SW handles offline) |
    | `.js` | `public, max-age=604800, stale-while-revalidate=86400` | 7 days + 1 day SWR |
    | `.css` | `public, max-age=604800, stale-while-revalidate=86400` | 7 days + 1 day SWR |
    | `.png/.jpg/.svg` | `public, max-age=2592000` | 30 days (images rarely change) |
    | `.json` (manifest) | `no-cache` | Must always be fresh for PWA install |
    | `service-worker.js` | `no-cache, no-store` | CRITICAL: SW must NEVER be cached by HTTP cache |

  - Implementation: Add to BOTH `express.static` calls in `setupRoutes()`:
    ```typescript
    this.app.use(express.static(path.join(__dirname, 'public'), {
      setHeaders: (res, filePath) => {
        // Existing Content-Type headers...
        
        // Cache-Control headers
        if (filePath.endsWith('service-worker.js')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.endsWith('.js')) {
          res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
        } else if (filePath.endsWith('.css')) {
          res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
        } else if (/\.(png|jpg|jpeg|svg|gif|webp)$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=2592000');
        } else if (filePath.endsWith('.json')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      }
    }));
    ```

  - **Also add ETag support**: Express.static has ETag enabled by default, but verify it's not disabled:
    ```typescript
    express.static(path, { etag: true, lastModified: true, ... })
    ```

  **Must NOT do**:
  - Do NOT add immutable to Cache-Control (no hash-based filenames = files CAN change)
  - Do NOT cache API responses with these headers (API routes have their own middleware)
  - Do NOT change the order of middleware in setupRoutes()
  - Do NOT modify the SPA catch-all routing logic

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file modification with clear, known changes to Express.js config
  - **Skills**: [`typescript-programmer`]
    - `typescript-programmer`: Express.js TypeScript patterns
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: No frontend changes

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 5)
  - **Blocks**: Task 11
  - **Blocked By**: None

  **References**:
  - `backend/api/src/server.ts:335-360` — Both express.static calls with setHeaders callbacks
  - `backend/api/src/server.ts:309-332` — SPA catch-all middleware (don't interfere)
  - Express.js static docs: http://expressjs.com/en/api.html#express.static

  **Acceptance Criteria**:

  ```bash
  # Verify Cache-Control headers are set
  grep -q "Cache-Control" backend/api/src/server.ts
  # Assert: true

  # Verify service-worker.js gets no-cache
  grep -q "service-worker.js" backend/api/src/server.ts | grep -q "no-cache"
  # Assert: true (or verify pattern exists)

  # Verify ETag is enabled
  grep -q "etag.*true\|etag: true" backend/api/src/server.ts
  # Assert: true (or verify not disabled)

  # After build and restart, verify headers:
  curl -sI https://rasplay.tplinkdns.com:52416/style.css | grep -i cache-control
  # Assert: contains "max-age=604800"

  curl -sI https://rasplay.tplinkdns.com:52416/service-worker.js | grep -i cache-control
  # Assert: contains "no-cache"

  curl -sI https://rasplay.tplinkdns.com:52416/index.html | grep -i cache-control
  # Assert: contains "no-cache"
  ```

  **Commit**: YES
  - Message: `perf(server): add Cache-Control headers for static assets`
  - Files: `backend/api/src/server.ts`
  - Pre-commit: `grep -c "Cache-Control" backend/api/src/server.ts` → >= 4

---

- [ ] 8. Push Notification Foundation (미완료 — web-push 패키지 미설치, push.ts 라우트 미생성)

  **What to do**:
  - This is FOUNDATION only — sets up infrastructure, does NOT implement full push notification UX
  
  **8a. Generate VAPID Keys**:
  - Install `web-push` package: `cd backend/api && npm install web-push`
  - Generate VAPID key pair: `npx web-push generate-vapid-keys`
  - Store keys in `.env` file (create if not exists):
    ```
    VAPID_PUBLIC_KEY=...
    VAPID_PRIVATE_KEY=...
    VAPID_SUBJECT=mailto:admin@openmake.ai
    ```
  
  **8b. Backend Push Subscription API**:
  - Create `backend/api/src/routes/push.ts` with two endpoints:
    - `POST /api/push/subscribe` — Save push subscription to SQLite
    - `POST /api/push/unsubscribe` — Remove push subscription
    - `GET /api/push/vapid-key` — Return public VAPID key
  - Create SQLite table `push_subscriptions` (endpoint, keys_p256dh, keys_auth, user_id, created_at)
  - Register routes in server.ts
  
  **8c. Client Push Registration** (minimal):
  - In the SW registration callback (index.html or app.js), after SW is active:
    ```javascript
    // Don't prompt immediately — just store the registration for later use
    // Actual permission request will be added in a future task
    ```
  - For now, just add a helper function `requestPushPermission()` that:
    1. Fetches VAPID public key from `/api/push/vapid-key`
    2. Calls `registration.pushManager.subscribe()`
    3. POSTs subscription to `/api/push/subscribe`
  - Export this function but do NOT auto-call it (user will trigger it from settings page later)

  **Must NOT do**:
  - Do NOT auto-request notification permission (bad UX)
  - Do NOT implement the full notification UI in settings page (defer to future)
  - Do NOT send actual push notifications yet
  - Do NOT make push a required feature (app must work without it)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
    - Reason: Backend route creation + npm package install, moderate effort
  - **Skills**: [`typescript-programmer`]
    - `typescript-programmer`: Express.js route patterns, TypeScript
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: No UI in this task
    - `python-programmer`: Not Python

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 2, 4)
  - **Blocks**: Task 11
  - **Blocked By**: None

  **References**:
  - `backend/api/src/server.ts` — Route registration pattern (see existing route mounts)
  - `backend/api/src/routes/` — Existing route file patterns to follow
  - `backend/api/package.json` — Current dependencies
  - web-push npm docs: https://github.com/web-push-libs/web-push
  - iOS Safari Push: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/

  **Acceptance Criteria**:

  ```bash
  # web-push package installed
  grep -q "web-push" backend/api/package.json
  # Assert: true

  # VAPID keys exist (in .env or config)
  test -f backend/api/.env && grep -q "VAPID_PUBLIC_KEY" backend/api/.env
  # Assert: true

  # Push route file exists
  test -f backend/api/src/routes/push.ts
  # Assert: true

  # API endpoints work (after build + restart):
  curl -s https://rasplay.tplinkdns.com:52416/api/push/vapid-key
  # Assert: Returns JSON with publicKey field

  # Client helper function exists
  grep -q "requestPushPermission\|pushManager" frontend/web/public/js/modules/settings.js || \
  grep -rq "requestPushPermission\|pushManager" frontend/web/public/js/
  # Assert: true
  ```

  **Commit**: YES
  - Message: `feat(pwa): add push notification foundation with VAPID keys and subscription API`
  - Files: `backend/api/src/routes/push.ts`, `backend/api/package.json`, `backend/api/.env`
  - Pre-commit: `test -f backend/api/src/routes/push.ts`

---

- [x] 9. Performance Optimization ✅ (preload 3건 적용됨)

  **What to do**:

  **9a. Preload Critical Resources**:
  - Add `<link rel="preload">` for critical-path resources in `index.html`:
    ```html
    <link rel="preload" href="/css/design-tokens.css" as="style">
    <link rel="preload" href="/js/spa-router.js" as="script" crossorigin>
    <link rel="preload" href="/js/modules/auth.js" as="script" crossorigin>
    ```
  - Add `<link rel="preconnect">` for CDN domains (already has one for jsdelivr, add cdnjs):
    ```html
    <link rel="preconnect" href="https://cdnjs.cloudflare.com">
    ```
  - Add `<link rel="dns-prefetch">` as fallback for older browsers

  **9b. Defer Non-Critical Resources**:
  - Add `media="print" onload="this.media='all'"` pattern for non-critical CSS:
    - highlight.js theme CSS (only needed when code is displayed)
    - `css/feature-cards.css` (below-the-fold content)
  - Mark non-critical scripts with `defer` attribute:
    - `guide_content.js` (only needed on guide page)
  - Note: Be careful with module scripts — ES modules are deferred by default

  **9c. App Shell Optimization**:
  - Ensure index.html renders the app shell (sidebar skeleton + main content area) BEFORE JS loads
  - Add inline critical CSS for the app shell in `<style>` tag in `<head>`:
    - Background color, layout grid, sidebar width
    - Loading skeleton styles
  - This ensures users see structure immediately instead of blank page

  **Must NOT do**:
  - Do NOT lazy-load page modules differently (SPA router already handles this)
  - Do NOT add a bundler for code splitting (vanilla JS, manual management)
  - Do NOT inline large CSS files (only critical layout CSS)
  - Do NOT change script loading order (dependencies exist)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
    - Reason: HTML modifications with performance optimization knowledge
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Critical rendering path optimization, app shell pattern
  - **Skills Evaluated but Omitted**:
    - `typescript-programmer`: No TS involved

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 3)
  - **Blocks**: Task 11
  - **Blocked By**: Task 2 (needs final manifest for preload hints)

  **References**:
  - `frontend/web/public/index.html:1-80` — Current <head> section with all resource loads
  - `frontend/web/public/css/design-tokens.css` — Critical CSS variables
  - `frontend/web/public/style.css` — Main stylesheet
  - Resource Hints spec: https://www.w3.org/TR/resource-hints/

  **Acceptance Criteria**:

  ```bash
  # Preload tags exist
  grep -c "rel=\"preload\"" frontend/web/public/index.html
  # Assert: >= 2

  # Preconnect for cdnjs exists
  grep -q "preconnect.*cdnjs" frontend/web/public/index.html
  # Assert: true

  # Critical inline CSS exists
  grep -q "<style>" frontend/web/public/index.html | head -1
  # Assert: true (inline style block in <head>)

  # Non-critical CSS uses defer pattern
  grep -q 'media="print"' frontend/web/public/index.html
  # Assert: true
  ```

  **Commit**: YES
  - Message: `perf(pwa): add resource preloading and critical CSS for app shell`
  - Files: `frontend/web/public/index.html`
  - Pre-commit: `grep -c "preload" frontend/web/public/index.html` → >= 2

---

- [x] 10. Install Experience (Custom Prompt + iOS Guidance) ✅ (install-prompt.js 존재)

  **What to do**:

  **10a. Chrome/Android Install Prompt**:
  - Create `frontend/web/public/js/components/install-prompt.js`
  - Intercept `beforeinstallprompt` event:
    ```javascript
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      showInstallBanner();
    });
    ```
  - Show a custom install banner (NOT the browser default):
    - Bottom-sheet style on mobile, toast-style on desktop
    - Korean text: "OpenMake.Ai를 홈 화면에 추가하세요!"
    - "설치" button (triggers `deferredPrompt.prompt()`)
    - "나중에" dismiss button
    - Remember dismissal in localStorage: `installPromptDismissed` with timestamp
    - Don't show again for 7 days after dismissal
    - Don't show if already installed (`display-mode: standalone` media query or `appinstalled` event)
  - Listen for `appinstalled` event to hide banner and track install
  - Initialize in `app.js`

  **10b. iOS Install Guidance**:
  - iOS Safari doesn't fire `beforeinstallprompt`
  - Detect iOS: `navigator.userAgent` includes 'iPhone' or 'iPad' and NOT 'CriOS'
  - Detect standalone: `window.navigator.standalone === true` (already installed)
  - If iOS + not standalone + not dismissed:
    - Show a different banner with iOS-specific instructions:
    - "홈 화면에 추가하려면: 공유 버튼(□↑) → '홈 화면에 추가'를 탭하세요"
    - Include a small visual guide (CSS-only share icon + arrow)
    - Same 7-day dismissal logic as Chrome

  **10c. Post-Install Experience**:
  - When app launches in standalone mode (`window.matchMedia('(display-mode: standalone)').matches`):
    - Don't show install banners (obviously)
    - Optionally: show a one-time "앱 설치 완료!" toast on first standalone launch
    - Store `standaloneWelcomed: true` in localStorage

  **Must NOT do**:
  - Do NOT auto-trigger the native install prompt without user interaction
  - Do NOT show install banner to already-installed users
  - Do NOT show install banner on login page (only on main app)
  - Do NOT make the banner intrusive or blocking

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
    - Reason: UI component with moderate JS logic, iOS detection
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Install banner design, mobile UX patterns
  - **Skills Evaluated but Omitted**:
    - `agent-browser`: Not automated testing, it's building the component
    - `typescript-programmer`: Vanilla JS, not complex TS

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Task 6)
  - **Blocks**: Task 11
  - **Blocked By**: Task 3 (needs SW registered for install prompt to fire)

  **References**:
  - `frontend/web/public/app.js` — Main entry point for initialization
  - `frontend/web/public/js/components/unified-sidebar.js` — Component pattern reference
  - `frontend/web/public/js/modules/ui.js` — Toast/notification UI patterns
  - `frontend/web/public/js/modules/utils.js` — Utility functions
  - `frontend/web/public/css/glassmorphism.css` — Glass effect for banner background
  - MDN beforeinstallprompt: https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent

  **Acceptance Criteria**:

  ```bash
  # Component file exists
  test -f frontend/web/public/js/components/install-prompt.js
  # Assert: EXISTS

  # beforeinstallprompt handled
  grep -q "beforeinstallprompt" frontend/web/public/js/components/install-prompt.js
  # Assert: true

  # iOS detection exists
  grep -q "iPhone\|iPad\|navigator.standalone" frontend/web/public/js/components/install-prompt.js
  # Assert: true

  # Dismissal logic with localStorage
  grep -q "installPromptDismissed\|localStorage" frontend/web/public/js/components/install-prompt.js
  # Assert: true

  # Imported in app.js
  grep -q "install-prompt" frontend/web/public/app.js
  # Assert: true
  ```

  **Playwright verification**:
  ```
  # Agent executes via playwright (Chrome):
  1. Navigate to: https://rasplay.tplinkdns.com:52416
  2. Login with test credentials
  3. Wait for page load
  4. Check if install banner appears (may not if already installed)
  5. If banner visible: Assert Korean text "홈 화면" or "설치" present
  6. Click dismiss "나중에"
  7. Reload page
  8. Assert: Banner does NOT appear (dismissed for 7 days)
  9. Screenshot: .sisyphus/evidence/task-10-install-prompt.png
  ```

  **Commit**: YES
  - Message: `feat(pwa): add custom install prompt for Chrome and iOS guidance`
  - Files: `frontend/web/public/js/components/install-prompt.js`, `frontend/web/public/app.js`
  - Pre-commit: `test -f frontend/web/public/js/components/install-prompt.js`

---

- [ ] 11. Integration Testing & Lighthouse Audit (미완료 — 최종 통합 테스트 미실행)

  **What to do**:
  - Run comprehensive PWA audit after ALL previous tasks are deployed
  - Build: `cd backend/api && npx tsc && npm run sync-frontend`
  - Restart server
  
  **11a. Lighthouse PWA Audit**:
  ```bash
  npx lighthouse https://rasplay.tplinkdns.com:52416 \
    --only-categories=pwa \
    --output=json \
    --output-path=.sisyphus/evidence/lighthouse-pwa.json
  ```
  - Target: PWA score >= 90
  - Fix any remaining issues flagged by Lighthouse

  **11b. Icon Verification**:
  - Verify every icon referenced in manifest.json returns 200:
  ```bash
  for icon in $(python3 -c "import json; [print(i['src']) for i in json.load(open('frontend/web/public/manifest.json'))['icons']]"); do
    curl -sI "https://rasplay.tplinkdns.com:52416${icon}" | head -1
  done
  # All should return HTTP/1.1 200 OK
  ```

  **11c. Service Worker Verification** (via Playwright):
  - Verify SW registers successfully
  - Verify all assets are cached
  - Verify offline navigation works
  - Verify CDN resources are cached
  - Take screenshots as evidence

  **11d. iOS-Specific Testing** (manual guidance):
  - Document steps for user to test on iPhone:
    1. Open Safari → navigate to app URL
    2. Tap Share → Add to Home Screen
    3. Verify app launches in standalone mode
    4. Verify offline indicator appears in airplane mode
    5. Verify app still shows cached content

  **11e. Header Verification**:
  ```bash
  # Verify Cache-Control headers
  curl -sI https://rasplay.tplinkdns.com:52416/style.css | grep -i "cache-control\|etag"
  curl -sI https://rasplay.tplinkdns.com:52416/service-worker.js | grep -i "cache-control"
  curl -sI https://rasplay.tplinkdns.com:52416/manifest.json | grep -i "cache-control"
  ```

  **Must NOT do**:
  - Do NOT skip any verification step
  - Do NOT accept Lighthouse score below 80 without documenting the reason
  - Do NOT fix issues outside the scope of this plan (log them for future)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Browser automation for visual verification + Lighthouse
  - **Skills**: [`agent-browser`, `dev-browser`]
    - `agent-browser`: Playwright automation for visual testing
    - `dev-browser`: Persistent browser state for multi-step verification
  - **Skills Evaluated but Omitted**:
    - `typescript-programmer`: No code writing, just testing
    - `frontend-ui-ux`: No design work

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 5 (solo, final)
  - **Blocks**: None (final task)
  - **Blocked By**: ALL previous tasks (1-10)

  **References**:
  - All files modified in Tasks 1-10
  - `.sisyphus/evidence/` — Directory for test evidence
  - Lighthouse CLI: https://github.com/GoogleChrome/lighthouse

  **Acceptance Criteria**:

  ```bash
  # Lighthouse PWA score
  npx lighthouse https://rasplay.tplinkdns.com:52416 --only-categories=pwa --output=json --quiet | \
    python3 -c "import json,sys; d=json.load(sys.stdin); print(f'PWA Score: {d[\"categories\"][\"pwa\"][\"score\"]*100}')"
  # Assert: >= 90

  # All icons return 200
  # (run the icon verification loop above)
  # Assert: ALL 200 OK

  # Cache-Control on SW
  curl -sI https://rasplay.tplinkdns.com:52416/service-worker.js | grep -qi "no-cache"
  # Assert: true

  # Evidence files exist
  ls .sisyphus/evidence/lighthouse-pwa.json
  # Assert: EXISTS
  ```

  **Commit**: YES (evidence files only)
  - Message: `test(pwa): add integration test evidence and Lighthouse audit results`
  - Files: `.sisyphus/evidence/*`

---

## Commit Strategy

| After Task | Message | Key Files | Verification |
|------------|---------|-----------|--------------|
| 1 | `feat(pwa): generate icon set from logo.png` | icons/* | ls icons/ → 10 files |
| 2 | `fix(pwa): update manifest branding to OpenMake.Ai` | manifest.json | python3 JSON parse |
| 3 | `feat(pwa): rewrite service worker with full caching` | service-worker.js | grep asset count >= 65 |
| 4 | `feat(pwa): create offline fallback page` | offline.html | grep "오프라인" |
| 5 | `fix(pwa): unify PWA meta tags` | index.html, login.html | grep checks |
| 6 | `feat(pwa): add offline support` | 4 JS files | file exists + grep |
| 7 | `perf(server): add Cache-Control headers` | server.ts | curl header checks |
| 8 | `feat(pwa): push notification foundation` | routes/push.ts, .env | API endpoint check |
| 9 | `perf(pwa): optimize critical rendering path` | index.html | preload count >= 2 |
| 10 | `feat(pwa): custom install prompt` | install-prompt.js | beforeinstallprompt grep |
| 11 | `test(pwa): integration test evidence` | .sisyphus/evidence/ | Lighthouse >= 90 |

---

## Success Criteria

### Verification Commands
```bash
# 1. Lighthouse PWA score >= 90
npx lighthouse https://rasplay.tplinkdns.com:52416 --only-categories=pwa --quiet

# 2. All manifest icons load (no 404s)
for icon in 72 96 128 144 152 192 384 512; do
  curl -sI https://rasplay.tplinkdns.com:52416/icons/icon-${icon}.png | head -1
done

# 3. Service Worker registered and caching
# (verify via Playwright DevTools)

# 4. Offline fallback works
# (verify via Playwright offline mode)

# 5. Cache-Control headers correct
curl -sI https://rasplay.tplinkdns.com:52416/style.css | grep -i cache-control
curl -sI https://rasplay.tplinkdns.com:52416/service-worker.js | grep -i cache-control

# 6. Manifest is valid
curl -s https://rasplay.tplinkdns.com:52416/manifest.json | python3 -c "import json,sys; m=json.load(sys.stdin); print(f'{m[\"name\"]} - {len(m[\"icons\"])} icons')"
```

### Final Checklist
- [ ] All "Must Have" items present (icons, SW, offline, branding, headers)
- [ ] All "Must NOT Have" items absent (no build tools, no framework, no auto-push-prompt)
- [ ] Lighthouse PWA >= 90
- [ ] iOS Safari install works (manual test)
- [ ] Chrome install prompt appears
- [ ] Offline navigation shows cached pages or fallback
- [ ] All commits have passing pre-commit checks
