# OpenMake LLM — AI Agent Guide

> Sub-layer guides: `backend/api/AGENTS.md`, `frontend/web/AGENTS.md`

## Project Structure

```
openmake_llm/
├── backend/api/src/         # Express v5 + TypeScript 5.3 (strict mode)
│   ├── agents/              # Agent routing, system prompts, skill manager
│   ├── chat/                # Pipeline profiles, model selector, context engineering
│   ├── services/            # ChatService, MemoryService, ApiKeyService, etc.
│   ├── routes/              # REST API routes (22+ files)
│   ├── data/                # UnifiedDatabase (PostgreSQL, raw SQL with pg)
│   ├── auth/                # JWT, OAuth (Google/GitHub), API Key — DO NOT MODIFY
│   ├── middlewares/         # Auth/rate-limit middleware — DO NOT MODIFY
│   ├── mcp/                 # Model Context Protocol integration
│   ├── ollama/              # Ollama client, A2A, API key rotation
│   ├── utils/               # logger, api-response, error-handler, token-tracker
│   └── __tests__/           # Jest tests (19 files)
├── frontend/web/public/     # Vanilla JS SPA (NO bundler, NO framework)
│   ├── app.js               # Main app (WebSocket, Chat, Auth)
│   ├── js/spa-router.js     # History API SPA router
│   ├── js/nav-items.js      # Sidebar navigation (single source of truth)
│   └── js/modules/pages/    # Page modules (IIFE pattern, 22 files)
└── services/database/init/  # PostgreSQL schema SQL (002-schema.sql)
```

## Build & Run

```bash
npm run build                  # Full: tsc + frontend deploy
npm run build:backend          # Backend only: cd backend/api && tsc
cd backend/api && npx tsc --noEmit  # Type-check only (no emit)
npm run dev                    # Dev: concurrent backend + frontend
npm run deploy:frontend        # Copy frontend → backend/api/dist/public/
node backend/api/dist/cli.js cluster --port 52416  # Production start
```

## Test Commands

```bash
# All tests (from root — timeout: 30s)
npm test

# All tests (from backend — timeout: 10s)
cd backend/api && npm test

# Single file
cd backend/api && npx jest src/__tests__/ChatService.test.ts

# Single test case by name
cd backend/api && npx jest --testNamePattern "should route to coding agent"

# File pattern match
cd backend/api && npx jest --testPathPattern "model-selector"

# Coverage / Watch
cd backend/api && npm run test:coverage
cd backend/api && npm run test:watch

# E2E (Playwright)
npm run test:e2e
npm run test:e2e:ui
```

- **Framework**: Jest + ts-jest, `testEnvironment: 'node'`
- **Location**: `backend/api/src/__tests__/*.test.ts`
- **Path alias**: `@/` → `backend/api/src/` (in jest moduleNameMapper)
- **Style**: `describe('Module') > test('행위 설명')` with Korean test names
- **Ignored**: `tests/e2e/`, stale `tests/unit/__tests__/auth.test.ts` and `unified-database.test.ts`

## Lint

```bash
npm run lint                   # eslint . --ext .ts,.tsx,.js,.jsx
```

No project-level ESLint config — relies on defaults. No Cursor/Copilot rules.

## Backend Code Style (backend/api/src/)

### Absolute Prohibitions

```typescript
// ❌ Type suppression — NEVER
as any; // @ts-ignore // @ts-expect-error

// ❌ Empty catch blocks
try { ... } catch(e) {}

// ❌ Inline SQL string concatenation (SQL injection risk)
pool.query(`SELECT * FROM users WHERE id = '${id}'`);

// ❌ Direct res.json({}) — use api-response helpers
res.json({ success: true, data }); // WRONG
```

### TypeScript Patterns

```typescript
// tsconfig: strict, noImplicitAny, strictNullChecks, target ES2022, module CommonJS

// Parameterized queries ONLY
await pool.query('SELECT * FROM users WHERE id = $1', [userId]);

// Explicit return types on public functions
async function getUser(id: string): Promise<User | null> { ... }

// DB row mapping: Record<string, unknown>
private rowToSkill(row: Record<string, unknown>): AgentSkill { ... }

// Singleton factory pattern for services
let instance: MyService | null = null;
export function getMyService(): MyService {
    if (!instance) instance = new MyService();
    return instance;
}
```

### Import Order

```typescript
import * as fs from 'fs';                          // 1. Node built-in
import { Router } from 'express';                  // 2. Third-party
import { createLogger } from '../utils/logger';    // 3. Internal utils
import type { AgentSelection } from './types';     // 4. Internal types (type-only)
```

### Naming Conventions

| Target | Convention | Example |
|--------|-----------|---------|
| Service class | PascalCase | `ChatService`, `SkillManager` |
| Route file | kebab-case.routes.ts | `agents.routes.ts` |
| Util function | camelCase | `createLogger`, `sanitizeInput` |
| Interface | PascalCase, NO `I` prefix | `AgentSkill`, `ExecutionPlan` |
| Constants | UPPER_SNAKE_CASE | `AGENTS`, `ErrorCodes` |
| DB column → TS | snake_case → camelCase | `is_public` → `isPublic` |

### API Response Format — DO NOT CHANGE

```typescript
import { success, badRequest, notFound, internalError } from '../utils/api-response';

res.json(success(data));                       // { success: true, data, meta }
res.status(400).json(badRequest('message'));    // { success: false, error: { code, message } }
res.status(404).json(notFound('resource'));
res.status(500).json(internalError('message'));
```

### Route Handler — Two Accepted Patterns

```typescript
// Pattern A: asyncHandler wrapper (preferred for new routes — 13+ files use this)
import { asyncHandler } from '../utils/error-handler';
router.get('/path', requireAuth, asyncHandler(async (req, res) => {
    const result = await service.doWork();
    res.json(success(result));
}));

// Pattern B: manual try/catch (legacy — agents.routes.ts uses this)
router.get('/path', requireAuth, async (req, res) => {
    try {
        const result = await service.doWork();
        res.json(success(result));
    } catch (error) {
        logger.error('Operation failed:', error);
        res.status(500).json(internalError('Operation failed'));
    }
});
```

### Route Registration Order — CRITICAL

```typescript
router.get('/skills', handler);           // Specific paths FIRST
router.get('/skills/categories', handler);// More specific BEFORE params
router.get('/skills/:skillId', handler);  // Param paths next
router.get('/:id', handler);              // Catch-all LAST
```

### Logging

```typescript
import { createLogger } from '../utils/logger';
const logger = createLogger('ModuleName');  // [ModuleName] prefix in output
logger.info('message');
logger.error('message:', error);
```

## Frontend Code Style (frontend/web/public/)

### Absolute Prohibitions

```javascript
// ❌ No React/Vue/Angular — Vanilla JS only
// ❌ No bundlers (webpack, vite)
// ❌ No unsanitized innerHTML
el.innerHTML = userInput;  // XSS — NEVER
```

### IIFE Page Module Pattern (ALL pages follow this)

```javascript
(function() {
    'use strict';
    window.PageModules = window.PageModules || {};
    window.PageModules['page-name'] = {
        getHTML: function() { return '<div>...</div>'; },
        init: function() {
            // DOM manipulation, event binding, API calls
            // Functions referenced by onclick → register on window
            window.myFunc = myFunc;
        },
        cleanup: function() {
            // Clear timers, remove window globals
            try { delete window.myFunc; } catch(e) {}
        }
    };
})();
```

### XSS Defense — MANDATORY for all user input in HTML

```javascript
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
el.innerHTML = `<span>${esc(userInput)}</span>`;
```

### CSS — Design tokens only, NO hardcoded colors

```css
color: var(--text-primary);     /* ✅ from design-tokens.css */
background: var(--bg-card);     /* ✅ */
color: #333;                    /* ❌ NEVER */
```

### Adding a New Page

1. Create `frontend/web/public/js/modules/pages/{name}.js` (IIFE pattern above)
2. Create `frontend/web/public/{name}.html` (SPA shell)
3. Add entry to `frontend/web/public/js/nav-items.js`
4. Add `<script>` tag to `frontend/web/public/index.html`

## Do-Not-Modify Zones

| Path | Reason |
|------|--------|
| `backend/api/src/auth/` | JWT/OAuth/API Key — security core |
| `backend/api/src/middlewares/` | Auth/rate-limit middleware — ordering sensitive |
| `frontend/web/public/js/modules/sanitize.js` | XSS defense core |
