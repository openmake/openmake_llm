# Phase 4: 아키텍처 리팩토링 (Architecture Refactoring)

## Status: ✅ COMPLETE

## Baseline
- TSC: ✅ clean
- Tests: ✅ 229 pass, 0 fail

## Execution Plan

### Wave 1 (Parallel - No Dependencies)

#### Task 4.1: Delete Dead Code
- **Priority**: HIGH
- **Files**: 
  - DELETE `backend/api/src/routes/AuthRoutes.ts` (confirmed: `createAuthRoutes` never imported)
  - DELETE `/infrastructure/` directory (has DEPRECATED.md, nothing imports from it)
  - DELETE `/database/` directory (legacy SQLite, superseded by backend/api/src/data/)
- **Risk**: LOW (no imports exist)
- **Verify**: tsc --noEmit

#### Task 4.4: Deduplicate CORS
- **Priority**: MEDIUM
- **Files**: `server.ts`, `middlewares/index.ts`
- **Action**: Remove inline CORS from server.ts lines 306-320, use `corsMiddleware()` from middlewares
- **Risk**: LOW (same logic, just dedup)
- **Verify**: tsc --noEmit

### Wave 2 (Sequential - Config must be done first)

#### Task 4.2: Centralize process.env
- **Priority**: HIGH
- **Scope**: 99 `process.env` accesses across 27 files → route through `config/env.ts` getConfig()
- **Approach**: 
  1. Extend `EnvConfig` interface with all needed env vars
  2. Add to `loadConfig()` with proper defaults
  3. Replace all `process.env.X` with `getConfig().x`
- **Constraint**: Preserve exact default values
- **Files**: env.ts + 27 consumer files
- **Verify**: tsc --noEmit + bun test

### Wave 3 (After Config)

#### Task 4.3: Wire Zod Validation
- **Priority**: HIGH
- **Files**: `schemas/auth.schema.ts`, `schemas/chat.schema.ts`, `middlewares/validation.ts`, route files
- **Action**: Apply existing Zod schemas as middleware to auth/chat route handlers
- **Verify**: tsc --noEmit + bun test

#### Task 4.5: Consolidate Types
- **Priority**: MEDIUM
- **Files**: `monitoring/metrics.ts`, `services/ChatService.ts`, auth types
- **Action**: Create central type files, re-export from single source
- **Verify**: tsc --noEmit

#### Task 4.6: Extract Bootstrap
- **Priority**: MEDIUM
- **Files**: `server.ts` → new `bootstrap.ts`
- **Action**: Move service initialization (getCacheSystem, getAnalyticsSystem, etc.) out of setupRoutes()
- **Verify**: tsc --noEmit + bun test

## Completion Criteria
- [x] All tasks complete
- [x] tsc --noEmit → exit 0
- [x] bun test → 229 pass, 0 fail
- [x] No behavior changes (pure refactor)
