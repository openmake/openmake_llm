# Draft: PWA Overhaul for OpenMake.Ai

## Requirements (confirmed)
- Transform partially-broken PWA into fully functional PWA
- Primary target device: iPhone (iOS Safari)
- Secondary: Chrome desktop
- Korean-language app
- No build tools - vanilla JS, manual file management
- Files deployed via deploy-frontend.sh (rsync to dist/public)

## Current State Assessment

### BROKEN:
1. manifest.json: Names="Ollama", icons point to non-existent /icons/, theme_color mismatch
2. service-worker.js: Only 9 assets cached (need 50+), no CDN caching, stub sync/push
3. index.html: apple-title says "Ollama", apple-touch-icon missing
4. login.html: ZERO PWA meta tags

### MISSING:
- Icon files (only logo.png 496x503 exists)
- Offline fallback, install prompt UI, offline indicator
- Cache-Control headers, message queuing, push backend

## Technical Decisions
- Icon gen: macOS sips CLI (available)
- SW: Comprehensive rewrite, app shell pattern
- CDN: stale-while-revalidate
- Add IndexedDB for offline conversation cache
- WS already has reconnection logic

## Scope
- IN: Icons, manifest, SW, offline, install UX, server headers, meta tags, perf, push foundation
- OUT: Framework migration, build tools, major UI redesign
