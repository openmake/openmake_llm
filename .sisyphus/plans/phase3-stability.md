# Phase 3: 안정성 개선 (Stability Improvements)

## TL;DR

> **Quick Summary**: Harden the OpenMake LLM backend by wrapping all 50+ legacy route handlers with `asyncHandler`, integrating the existing (but unused) `withRetry` DB wrapper into `UnifiedDatabase`, enforcing `UserContext` typing in the MCP tool pipeline, and standardizing all raw `res.json()` calls to use `api-response` helpers.
>
> **Deliverables**:
> - All 8 legacy route files migrated to `asyncHandler` + `api-response`
> - `withRetry` integrated into `UnifiedDatabase` internal queries
> - `MCPToolHandler.context` typed as `UserContext` (not `unknown`)
> - All raw `res.json()` in middlewares/controllers standardized
> - `types/api.ts` marked `@deprecated`
> - 229+ existing tests still passing, TypeScript clean
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: Task 1 (canary) → Task 3 (bulk routes) → Task 5 (cleanup + regression)

---

## Context

### Original Request
Implement Phase 3: 안정성 개선 (Stability Improvements) of the OpenMake LLM project. Tasks 3.1 and 3.2 were already completed (SKIP). Tasks 3.3 (asyncHandler migration), 3.4 (api-response standardization), 3.5 (error code consistency) should be combined since they affect the same route files. Task 3.6 covers ToolRouter UserContext enforcement. Task 3.7 covers DB query retry wrapper.

### Interview Summary
**Key Discussions**:
- User explicitly requested NO questions — proceed with available information
- Tasks 3.1 (global error handler) and 3.2 (typed AppError) already DONE — skip them
- Tasks 3.3, 3.4, 3.5 combined into single route migration effort (same files)
- User confirmed: test runner is `cd backend/api && bun test` (229 tests)

**Research Findings**:
- **Legacy routes**: 8 files, 50+ handlers, ALL use inline try/catch, NONE import asyncHandler. Most already use api-response helpers for success paths but have raw `res.json` in catch blocks.
- **CRITICAL**: `nodes.routes.ts` line 27 has async POST handler with NO error handling at all
- **Largest file**: `agents.routes.ts` (388 lines, 17 handlers)
- **DB retry**: `withRetry` already EXISTS in `data/retry-wrapper.ts` with exponential backoff + jitter + correct PG error codes, but is NEVER called anywhere. Task reduces to integration, not creation.
- **withTransaction**: Already exists and used in ~4 methods — must NOT retry inside active transactions
- **ToolRouter**: `UserContext` defined in `mcp/user-sandbox.ts`. `executeTool` has `context?: UserContext` (optional). `MCPToolHandler` type has `context?: unknown`. ChatService creates and passes UserContext.
- **API response**: `api-response.ts` has standard format `{ success, data, meta: { timestamp } }`. `types/api.ts` has competing legacy format. Middleware has 7 raw `res.json` calls. `AuthRoutes.ts` line 239, `cluster.controller.ts` (4 calls), `health.controller.ts` (2 calls) use raw format.
- **Test infra**: Bun test runner, 229 tests pass. `error-handler.test.ts` exists. No dedicated api-response tests. No route-level integration tests.

### Metis Review
**Identified Gaps** (addressed):
- **Streaming/SSE handlers**: Guardrail added — do NOT wrap streaming handlers with asyncHandler (causes ERR_HTTP_HEADERS_SENT). Identify and skip them.
- **Catch block side effects**: Must audit each catch block for cleanup logic (resource release, logging) before replacing with asyncHandler delegation
- **Frontend response format**: Routes already use api-response helpers for success paths — only catch blocks and raw middleware calls need migration. Frontend won't break.
- **External tool executor path**: Keep optional `context?` on external-facing interfaces; enforce on internal `MCPToolHandler`
- **Transaction + retry conflict**: Never wrap `withRetry` around calls inside `withTransaction`

---

## Work Objectives

### Core Objective
Eliminate all unhandled async errors in Express route handlers, standardize error/response formatting, integrate dormant DB retry logic, and enforce type safety in the MCP tool pipeline.

### Concrete Deliverables
- 8 route files migrated: `usage.routes.ts`, `nodes.routes.ts`, `agents.routes.ts`, `agents-monitoring.routes.ts`, `push.routes.ts`, `model.routes.ts`, `metrics.routes.ts`, `token-monitoring.routes.ts`
- Middleware + controllers standardized: `middlewares/index.ts`, `AuthRoutes.ts`, `cluster.controller.ts`, `health.controller.ts`
- `UnifiedDatabase` internal methods wrapped with `withRetry` (except inside transactions)
- `MCPToolHandler.context` changed from `unknown` to `UserContext`
- `types/api.ts` marked `@deprecated`

### Definition of Done
- [ ] `cd backend/api && bun test` → 229+ tests pass, 0 failures
- [ ] `cd backend/api && npx tsc --noEmit` → clean compile, 0 errors
- [ ] `grep -r "res\.json(" backend/api/src/routes/ backend/api/src/middlewares/ backend/api/src/controllers/` → 0 raw calls (all use api-response)
- [ ] `grep "context?: unknown" backend/api/src/mcp/types.ts` → 0 matches
- [ ] `grep -r "withRetry" backend/api/src/data/models/unified-database.ts` → at least 1 match

### Must Have
- Every async route handler wrapped with `asyncHandler`
- All raw `res.json()` replaced with `api-response` helpers
- `withRetry` actually called in `UnifiedDatabase`
- TypeScript strict-mode clean (no `as any`, no `@ts-ignore`)
- All 229+ existing tests passing

### Must NOT Have (Guardrails)
- NO wrapping streaming/SSE handlers with asyncHandler (causes ERR_HTTP_HEADERS_SENT)
- NO removing catch blocks that have cleanup side effects (logging, resource release) — preserve the cleanup
- NO changing HTTP status codes in any handler
- NO changing response body shapes (only wrap with api-response helpers)
- NO modifying route handler business logic
- NO retrying DB operations inside active transactions (withTransaction)
- NO migrating ALL pool.query call sites — only UnifiedDatabase internal calls
- NO removing `types/api.ts` — only add `@deprecated` comment
- NO adding input validation, sanitization, or new middleware
- NO using `as any` or `@ts-ignore`
- NO deleting tests — fix code to match tests instead
- NO adding new dependencies

---

## Verification Strategy

> **UNIVERSAL RULE: ZERO HUMAN INTERVENTION**
>
> ALL tasks in this plan MUST be verifiable WITHOUT any human action.

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: YES (tests-after — existing tests must stay green, add new tests for retry wrapper)
- **Framework**: bun test

### Agent-Executed QA Scenarios (MANDATORY — ALL tasks)

**Verification Tool by Deliverable Type:**

| Type | Tool | How Agent Verifies |
|------|------|-------------------|
| Route handlers | Bash (bun test + tsc) | Run tests, check TypeScript compilation |
| DB retry | Bash (bun test) | New test file for withRetry integration |
| Type changes | Bash (tsc --noEmit) | TypeScript compiler catches type mismatches |
| Response format | Bash (grep) | Search for remaining raw res.json calls |

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately):
├── Task 1: Canary migration — usage.routes.ts (1 file, prove pattern)
└── Task 2: DB retry integration — UnifiedDatabase + withRetry

Wave 2 (After Wave 1):
├── Task 3: Bulk route migration (7 remaining route files)
└── Task 4: ToolRouter UserContext enforcement

Wave 3 (After Wave 2):
└── Task 5: Middleware/controller cleanup + final regression
```

### Dependency Matrix

| Task | Depends On | Blocks | Can Parallelize With |
|------|------------|--------|---------------------|
| 1 | None | 3 | 2 |
| 2 | None | 5 | 1 |
| 3 | 1 | 5 | 4 |
| 4 | None | 5 | 3 |
| 5 | 2, 3, 4 | None | None (final) |

### Agent Dispatch Summary

| Wave | Tasks | Recommended Agents |
|------|-------|-------------------|
| 1 | 1, 2 | Both: `category="quick"`, load_skills=[], parallel |
| 2 | 3, 4 | Task 3: `category="unspecified-high"` (bulk); Task 4: `category="quick"` |
| 3 | 5 | `category="unspecified-low"` (cleanup + grep verification) |

---

## TODOs

- [ ] 1. Canary Migration: usage.routes.ts

  **What to do**:
  - Import `asyncHandler` from `../utils/error-handler`
  - Import relevant helpers from `../utils/api-response` (if not already imported)
  - Wrap every async route handler callback with `asyncHandler(...)`
  - Remove inline try/catch blocks, BUT:
    - First audit each catch block for side effects (logging calls, resource cleanup)
    - If side effects exist: keep them inside the handler, let asyncHandler catch only unhandled throws
    - If catch block only does `res.status(N).json(...)`: safe to remove, asyncHandler + error handler will handle
  - Replace any remaining raw `res.json({...})` with `ApiResponse.success(res, data)` or `ApiResponse.error(res, ...)`
  - Ensure all HTTP status codes remain IDENTICAL to current behavior
  - Verify: `cd backend/api && bun test` passes
  - Verify: `cd backend/api && npx tsc --noEmit` clean
  - This is the CANARY — if pattern works here, Task 3 replicates it across 7 more files

  **Must NOT do**:
  - Do NOT change any route paths or HTTP methods
  - Do NOT modify business logic inside handlers
  - Do NOT add new validation or middleware
  - Do NOT touch streaming/SSE handlers (if any in this file)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file, mechanical transformation, clear pattern
  - **Skills**: `[]`
    - No special skills needed — pure code refactoring

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Task 3 (bulk migration uses this as the proven pattern)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References** (existing code to follow):
  - `backend/api/src/utils/error-handler.ts` — `asyncHandler` function definition; wraps async `(req, res, next)` and catches thrown errors
  - `backend/api/src/utils/api-response.ts` — `success()`, `error()`, `unauthorized()`, `notFound()` helpers; standard response shape `{ success, data, meta: { timestamp } }`
  - `backend/api/src/routes/chat.routes.ts` — Already-migrated route file using asyncHandler pattern (reference for how it looks when done)

  **Target References** (files to modify):
  - `backend/api/src/routes/usage.routes.ts` — THE file to migrate; examine all handler callbacks

  **Test References**:
  - `backend/api/src/__tests__/error-handler.test.ts` — Existing tests for asyncHandler behavior; describes expected error delegation flow

  **Acceptance Criteria**:

  - [ ] `grep "asyncHandler" backend/api/src/routes/usage.routes.ts` → at least 1 match (asyncHandler is imported and used)
  - [ ] `grep -c "try {" backend/api/src/routes/usage.routes.ts` → 0 (no remaining inline try/catch, unless catch has side effects)
  - [ ] `grep "res\.json(" backend/api/src/routes/usage.routes.ts` → 0 raw calls (all use api-response helpers)
  - [ ] `cd backend/api && bun test` → 229+ tests pass
  - [ ] `cd backend/api && npx tsc --noEmit` → 0 errors

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Canary file compiles and tests pass after migration
    Tool: Bash
    Preconditions: Working directory is project root
    Steps:
      1. cd backend/api && npx tsc --noEmit
      2. Assert: exit code 0, no TypeScript errors
      3. cd backend/api && bun test
      4. Assert: 229+ tests pass, 0 failures
      5. grep -c "asyncHandler" backend/api/src/routes/usage.routes.ts
      6. Assert: output >= 1
      7. grep -c "try {" backend/api/src/routes/usage.routes.ts
      8. Assert: output is 0 (unless documented side-effect catch blocks exist)
    Expected Result: File migrated, all tests green, TypeScript clean
    Evidence: Terminal output captured

  Scenario: No raw res.json remaining in canary file
    Tool: Bash
    Preconditions: Task 1 migration complete
    Steps:
      1. grep -n "res\.json(" backend/api/src/routes/usage.routes.ts
      2. Assert: no matches (exit code 1 from grep = good)
    Expected Result: All response calls use api-response helpers
    Evidence: grep output captured
  ```

  **Commit**: YES
  - Message: `fix(routes): migrate usage.routes.ts to asyncHandler + api-response`
  - Files: `backend/api/src/routes/usage.routes.ts`
  - Pre-commit: `cd backend/api && bun test && npx tsc --noEmit`

---

- [ ] 2. DB Retry Integration: Wire withRetry into UnifiedDatabase

  **What to do**:
  - Import `withRetry` from `../retry-wrapper` into `unified-database.ts`
  - Identify all `pool.query(...)` calls inside UnifiedDatabase methods
  - For each `pool.query` call:
    - If it's INSIDE a `withTransaction` callback: DO NOT wrap with withRetry (retrying inside transactions is dangerous)
    - If it's a standalone query: wrap with `withRetry(() => pool.query(...))`
  - Keep the existing `withRetry` implementation exactly as-is (it already has exponential backoff, jitter, correct PG error codes 40001, 40P01, 08006, 08001, 08004, 57P01)
  - Add a test file `backend/api/src/__tests__/retry-integration.test.ts` that verifies withRetry is called for standalone queries
  - Verify: `cd backend/api && bun test` passes
  - Verify: `cd backend/api && npx tsc --noEmit` clean

  **Must NOT do**:
  - Do NOT modify `retry-wrapper.ts` itself (it's already correct)
  - Do NOT wrap queries inside `withTransaction` callbacks
  - Do NOT migrate external `pool.query` call sites outside UnifiedDatabase
  - Do NOT change query logic or SQL
  - Do NOT add connection pooling changes

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Mechanical wrapping of existing calls with existing utility
  - **Skills**: `[]`
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Task 5 (final regression)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `backend/api/src/data/retry-wrapper.ts` — `withRetry(fn, options?)` implementation; exponential backoff, jitter, retries on PG codes 40001/40P01/08006/08001/08004/57P01. Also contains `withTransaction(pool, fn)` helper.
  - `backend/api/src/data/retry-wrapper.ts:withTransaction` — See how `withTransaction` wraps `pool.connect()` → `BEGIN` → fn → `COMMIT`/`ROLLBACK`. Queries inside this must NOT be additionally wrapped with `withRetry`.

  **Target References**:
  - `backend/api/src/data/models/unified-database.ts` — THE file to modify; find all `pool.query(...)` or `this.pool.query(...)` calls. Distinguish standalone queries from those inside `withTransaction` callbacks.

  **Test References**:
  - `backend/api/src/__tests__/error-handler.test.ts` — Testing pattern reference (describe/it/expect structure with bun test)

  **Acceptance Criteria**:

  - [ ] `grep "withRetry" backend/api/src/data/models/unified-database.ts` → at least 1 match
  - [ ] `grep "import.*withRetry" backend/api/src/data/models/unified-database.ts` → 1 match (import exists)
  - [ ] File `backend/api/src/__tests__/retry-integration.test.ts` exists with at least 2 test cases
  - [ ] `cd backend/api && bun test` → all tests pass (229+ existing + new retry tests)
  - [ ] `cd backend/api && npx tsc --noEmit` → 0 errors

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: withRetry is imported and used in UnifiedDatabase
    Tool: Bash
    Preconditions: Working directory is project root
    Steps:
      1. grep -n "import.*withRetry" backend/api/src/data/models/unified-database.ts
      2. Assert: exactly 1 import line
      3. grep -c "withRetry" backend/api/src/data/models/unified-database.ts
      4. Assert: count >= 2 (1 import + at least 1 usage)
    Expected Result: withRetry is imported and called
    Evidence: grep output captured

  Scenario: Queries inside withTransaction are NOT wrapped with withRetry
    Tool: Bash
    Preconditions: Task 2 migration complete
    Steps:
      1. Read unified-database.ts and check withTransaction callbacks
      2. Verify no withRetry calls appear inside withTransaction callback bodies
      3. cd backend/api && bun test
      4. Assert: all tests pass
    Expected Result: Transaction-internal queries left untouched
    Evidence: Terminal output captured

  Scenario: New retry integration tests pass
    Tool: Bash
    Preconditions: Test file created
    Steps:
      1. cd backend/api && bun test src/__tests__/retry-integration.test.ts
      2. Assert: 2+ tests pass, 0 failures
    Expected Result: Retry integration verified by tests
    Evidence: Test output captured
  ```

  **Commit**: YES
  - Message: `fix(data): integrate withRetry into UnifiedDatabase standalone queries`
  - Files: `backend/api/src/data/models/unified-database.ts`, `backend/api/src/__tests__/retry-integration.test.ts`
  - Pre-commit: `cd backend/api && bun test && npx tsc --noEmit`

---

- [ ] 3. Bulk Route Migration: 7 Remaining Route Files

  **What to do**:
  - Apply the EXACT same pattern proven in Task 1 (canary) to these 7 files:
    1. `backend/api/src/routes/nodes.routes.ts` — **CRITICAL**: line 27 has async POST with NO error handling at all. Must add asyncHandler.
    2. `backend/api/src/routes/agents.routes.ts` — Largest file (388 lines, 17 handlers). Be thorough.
    3. `backend/api/src/routes/agents-monitoring.routes.ts`
    4. `backend/api/src/routes/push.routes.ts`
    5. `backend/api/src/routes/model.routes.ts`
    6. `backend/api/src/routes/metrics.routes.ts`
    7. `backend/api/src/routes/token-monitoring.routes.ts`
  - For EACH file:
    - Import `asyncHandler` from `../utils/error-handler`
    - Import api-response helpers if not already imported
    - Wrap every async handler with `asyncHandler(...)`
    - Audit each catch block for side effects before removing
    - Replace raw `res.json()` with api-response helpers
    - SKIP streaming/SSE handlers (identify by `res.write()`, `res.flush()`, `res.setHeader('Content-Type', 'text/event-stream')`, `Transfer-Encoding: chunked`)
    - Preserve all HTTP status codes exactly
  - After ALL 7 files: run `bun test` and `tsc --noEmit`

  **Must NOT do**:
  - Do NOT change route paths, HTTP methods, or handler logic
  - Do NOT wrap streaming/SSE handlers with asyncHandler
  - Do NOT remove catch blocks with cleanup side effects (logging, resource release)
  - Do NOT add validation, new middleware, or new dependencies
  - Do NOT change response body shapes

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 7 files, 49+ handlers — high volume of mechanical changes, needs attention to catch-block side effects
  - **Skills**: `[]`
    - No special skills needed — pure refactoring across multiple files

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 4)
  - **Blocks**: Task 5 (final cleanup)
  - **Blocked By**: Task 1 (canary must succeed first to prove the pattern)

  **References**:

  **Pattern References**:
  - `backend/api/src/routes/usage.routes.ts` — AFTER Task 1 migration: THE reference pattern for how each file should look when done
  - `backend/api/src/utils/error-handler.ts` — asyncHandler definition
  - `backend/api/src/utils/api-response.ts` — Response helpers

  **Target References** (files to modify):
  - `backend/api/src/routes/nodes.routes.ts` — CRITICAL: line 27 async POST with NO error handling
  - `backend/api/src/routes/agents.routes.ts` — Largest: 388 lines, 17 handlers
  - `backend/api/src/routes/agents-monitoring.routes.ts`
  - `backend/api/src/routes/push.routes.ts`
  - `backend/api/src/routes/model.routes.ts`
  - `backend/api/src/routes/metrics.routes.ts`
  - `backend/api/src/routes/token-monitoring.routes.ts`

  **Test References**:
  - `backend/api/src/__tests__/error-handler.test.ts` — asyncHandler behavior tests

  **Acceptance Criteria**:

  - [ ] ALL 7 files import `asyncHandler`: `for f in nodes agents agents-monitoring push model metrics token-monitoring; do grep "asyncHandler" backend/api/src/routes/$f.routes.ts; done` → all match
  - [ ] `grep -r "res\.json(" backend/api/src/routes/` → 0 matches (all 8 route files clean)
  - [ ] `nodes.routes.ts` line 27 area: async POST handler now wrapped with asyncHandler
  - [ ] `cd backend/api && bun test` → 229+ tests pass
  - [ ] `cd backend/api && npx tsc --noEmit` → 0 errors

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: All 8 route files use asyncHandler (including canary)
    Tool: Bash
    Preconditions: Tasks 1 and 3 complete
    Steps:
      1. for f in usage nodes agents agents-monitoring push model metrics token-monitoring; do echo "=== $f ===" && grep -c "asyncHandler" backend/api/src/routes/$f.routes.ts; done
      2. Assert: every file shows count >= 1
    Expected Result: asyncHandler used in all 8 route files
    Evidence: Terminal output captured

  Scenario: No raw res.json in any route file
    Tool: Bash
    Preconditions: All route files migrated
    Steps:
      1. grep -rn "res\.json(" backend/api/src/routes/
      2. Assert: no matches (grep exit code 1 = good)
    Expected Result: Zero raw res.json calls in routes
    Evidence: grep output captured

  Scenario: nodes.routes.ts critical handler is protected
    Tool: Bash
    Preconditions: nodes.routes.ts migrated
    Steps:
      1. Read lines 20-35 of backend/api/src/routes/nodes.routes.ts
      2. Assert: POST handler is wrapped with asyncHandler
      3. cd backend/api && bun test
      4. Assert: all tests pass
    Expected Result: Previously unprotected handler now has error handling
    Evidence: File content + test output captured

  Scenario: Streaming handlers NOT wrapped (if any exist)
    Tool: Bash
    Preconditions: All route files migrated
    Steps:
      1. grep -rn "text/event-stream\|res\.write\|res\.flush\|Transfer-Encoding.*chunked" backend/api/src/routes/
      2. For any matches: verify that handler is NOT wrapped with asyncHandler
    Expected Result: Streaming handlers identified and left untouched
    Evidence: grep output captured
  ```

  **Commit**: YES
  - Message: `fix(routes): migrate 7 remaining route files to asyncHandler + api-response`
  - Files: `backend/api/src/routes/nodes.routes.ts`, `backend/api/src/routes/agents.routes.ts`, `backend/api/src/routes/agents-monitoring.routes.ts`, `backend/api/src/routes/push.routes.ts`, `backend/api/src/routes/model.routes.ts`, `backend/api/src/routes/metrics.routes.ts`, `backend/api/src/routes/token-monitoring.routes.ts`
  - Pre-commit: `cd backend/api && bun test && npx tsc --noEmit`

---

- [ ] 4. ToolRouter UserContext Enforcement

  **What to do**:
  - In `backend/api/src/mcp/types.ts`:
    - Import `UserContext` from `./user-sandbox`
    - Change `MCPToolHandler` type's `context?: unknown` to `context?: UserContext`
  - In `backend/api/src/mcp/tool-router.ts`:
    - Verify `executeTool` already has `context?: UserContext` — if so, no change needed
    - If any tool handler implementations cast `context as any`, fix them to use proper `UserContext` type
  - In `backend/api/src/services/ChatService.ts`:
    - Verify `executeToolCall` (line ~906) already creates proper `UserContext` — if so, no change needed
  - Check all tool handler files under `backend/api/src/mcp/tools/`:
    - If any handler accesses `context` as `unknown`, update to use `UserContext` type
  - Keep `context` OPTIONAL (`context?: UserContext`) — external tool executors may not provide it
  - Verify: `cd backend/api && npx tsc --noEmit` — TypeScript will catch any type mismatches from this change
  - Verify: `cd backend/api && bun test` passes

  **Must NOT do**:
  - Do NOT make `context` required (would break external callers)
  - Do NOT change UserContext interface definition
  - Do NOT add runtime validation for context (TypeScript compile-time check is sufficient)
  - Do NOT modify tool handler business logic

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Type change in 1-3 files, TypeScript compiler does the validation work
  - **Skills**: `[]`
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 3)
  - **Blocks**: Task 5 (final regression)
  - **Blocked By**: None (but scheduled Wave 2 for safety)

  **References**:

  **Pattern References**:
  - `backend/api/src/mcp/user-sandbox.ts:230-235` — `UserContext` interface: `{ userId: string, tier: string, role: string, orgId?: string }`
  - `backend/api/src/services/ChatService.ts:~906` — `executeToolCall` creates UserContext and passes to tool pipeline

  **Target References**:
  - `backend/api/src/mcp/types.ts:66` — `MCPToolHandler` type, `context?: unknown` → change to `context?: UserContext`
  - `backend/api/src/mcp/tool-router.ts:69` — `executeTool` with `context?: UserContext` (verify)

  **API/Type References**:
  - `backend/api/src/mcp/tools/filesystem.ts` — Tool handler that already validates UserContext internally; verify it accepts the type change

  **Acceptance Criteria**:

  - [ ] `grep "context?: unknown" backend/api/src/mcp/types.ts` → 0 matches
  - [ ] `grep "context?: UserContext" backend/api/src/mcp/types.ts` → 1 match
  - [ ] `grep "import.*UserContext" backend/api/src/mcp/types.ts` → 1 match
  - [ ] `cd backend/api && npx tsc --noEmit` → 0 errors (TypeScript validates all downstream usages)
  - [ ] `cd backend/api && bun test` → all tests pass

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: MCPToolHandler context typed as UserContext
    Tool: Bash
    Preconditions: Working directory is project root
    Steps:
      1. grep -n "context?" backend/api/src/mcp/types.ts
      2. Assert: shows "context?: UserContext" (not "context?: unknown")
      3. grep "import.*UserContext" backend/api/src/mcp/types.ts
      4. Assert: import exists
    Expected Result: Type changed from unknown to UserContext
    Evidence: grep output captured

  Scenario: TypeScript compiler validates the change
    Tool: Bash
    Preconditions: types.ts modified
    Steps:
      1. cd backend/api && npx tsc --noEmit
      2. Assert: exit code 0, no errors
    Expected Result: All downstream usages are compatible with UserContext type
    Evidence: tsc output captured

  Scenario: All tests still pass with type change
    Tool: Bash
    Preconditions: Type change complete
    Steps:
      1. cd backend/api && bun test
      2. Assert: 229+ tests pass, 0 failures
    Expected Result: No runtime behavior change from type narrowing
    Evidence: Test output captured
  ```

  **Commit**: YES
  - Message: `fix(mcp): enforce UserContext type on MCPToolHandler context parameter`
  - Files: `backend/api/src/mcp/types.ts` (and any other files needing type fixes)
  - Pre-commit: `cd backend/api && bun test && npx tsc --noEmit`

---

- [ ] 5. Middleware/Controller Cleanup + Final Regression

  **What to do**:
  - **Middleware standardization** (`backend/api/src/middlewares/index.ts`):
    - Lines 35, 44, 53, 66, 81, 92, 102: Replace raw `res.json(...)` with `api-response` helpers
    - Match the status code and body shape exactly — just wrap with helpers
  - **Controller standardization**:
    - `backend/api/src/routes/auth/AuthRoutes.ts` line 239: Replace raw `res.json(...)` with api-response helper
    - `backend/api/src/controllers/cluster.controller.ts` lines 55, 67, 79, 87: Replace 4 raw `res.json(...)` calls
    - `backend/api/src/controllers/health.controller.ts` lines 45, 61: Replace 2 raw `res.json(...)` calls
  - **Deprecation marker**:
    - Add `/** @deprecated Use api-response.ts helpers instead */` comment to `backend/api/src/types/api.ts` at the top
    - Do NOT delete the file or remove any exports
  - **Final regression**:
    - Run `cd backend/api && bun test` → all 229+ tests pass
    - Run `cd backend/api && npx tsc --noEmit` → clean compile
    - Run `grep -rn "res\.json(" backend/api/src/routes/ backend/api/src/middlewares/ backend/api/src/controllers/` → verify 0 remaining raw calls
    - Run `grep "context?: unknown" backend/api/src/mcp/types.ts` → verify 0 matches
    - Run `grep "withRetry" backend/api/src/data/models/unified-database.ts` → verify present

  **Must NOT do**:
  - Do NOT change middleware logic or ordering
  - Do NOT remove `types/api.ts` or its exports
  - Do NOT change HTTP status codes
  - Do NOT change response shapes

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
    - Reason: Mechanical cleanup + verification. Low complexity, just thoroughness needed.
  - **Skills**: `[]`
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (sequential, last task)
  - **Blocks**: None (final task)
  - **Blocked By**: Tasks 2, 3, 4 (all must complete before final regression)

  **References**:

  **Pattern References**:
  - `backend/api/src/utils/api-response.ts` — `success()`, `error()`, `unauthorized()`, `notFound()` helpers
  - `backend/api/src/routes/usage.routes.ts` — After Task 1: reference for api-response helper usage

  **Target References**:
  - `backend/api/src/middlewares/index.ts:35,44,53,66,81,92,102` — 7 raw `res.json()` calls to replace
  - `backend/api/src/routes/auth/AuthRoutes.ts:239` — 1 raw `res.json()` call
  - `backend/api/src/controllers/cluster.controller.ts:55,67,79,87` — 4 raw `res.json()` calls
  - `backend/api/src/controllers/health.controller.ts:45,61` — 2 raw `res.json()` calls
  - `backend/api/src/types/api.ts` — Add @deprecated comment at top

  **Acceptance Criteria**:

  - [ ] `grep -rn "res\.json(" backend/api/src/middlewares/index.ts` → 0 matches
  - [ ] `grep -rn "res\.json(" backend/api/src/routes/auth/AuthRoutes.ts` → 0 matches
  - [ ] `grep -rn "res\.json(" backend/api/src/controllers/cluster.controller.ts` → 0 matches
  - [ ] `grep -rn "res\.json(" backend/api/src/controllers/health.controller.ts` → 0 matches
  - [ ] `grep "@deprecated" backend/api/src/types/api.ts` → 1 match
  - [ ] `grep -rn "res\.json(" backend/api/src/routes/ backend/api/src/middlewares/ backend/api/src/controllers/` → 0 total matches
  - [ ] `cd backend/api && bun test` → 229+ tests pass, 0 failures
  - [ ] `cd backend/api && npx tsc --noEmit` → 0 errors

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Zero raw res.json calls across entire backend surface
    Tool: Bash
    Preconditions: All 5 tasks complete
    Steps:
      1. grep -rn "res\.json(" backend/api/src/routes/ backend/api/src/middlewares/ backend/api/src/controllers/
      2. Assert: no matches (exit code 1 from grep = success)
    Expected Result: Complete standardization — all responses use api-response helpers
    Evidence: grep output captured

  Scenario: types/api.ts marked deprecated but NOT deleted
    Tool: Bash
    Preconditions: Task 5 complete
    Steps:
      1. test -f backend/api/src/types/api.ts
      2. Assert: file exists (exit code 0)
      3. grep "@deprecated" backend/api/src/types/api.ts
      4. Assert: deprecation comment present
    Expected Result: File preserved with deprecation marker
    Evidence: grep output captured

  Scenario: Full regression — all tests pass, TypeScript clean
    Tool: Bash
    Preconditions: All 5 tasks complete
    Steps:
      1. cd backend/api && npx tsc --noEmit
      2. Assert: exit code 0
      3. cd backend/api && bun test
      4. Assert: 229+ tests pass, 0 failures
      5. grep "context?: unknown" backend/api/src/mcp/types.ts
      6. Assert: no matches
      7. grep "withRetry" backend/api/src/data/models/unified-database.ts
      8. Assert: at least 1 match
    Expected Result: Everything clean — types, tests, integration
    Evidence: All terminal output captured

  Scenario: Middleware response format preserved
    Tool: Bash
    Preconditions: middlewares/index.ts modified
    Steps:
      1. grep -n "ApiResponse\.\|success(\|error(" backend/api/src/middlewares/index.ts
      2. Assert: api-response helpers present at former raw json locations
      3. cd backend/api && bun test
      4. Assert: all tests pass (middleware behavior unchanged)
    Expected Result: Middleware uses api-response helpers, behavior identical
    Evidence: grep + test output captured
  ```

  **Commit**: YES
  - Message: `fix(api): standardize remaining raw res.json calls and deprecate types/api.ts`
  - Files: `backend/api/src/middlewares/index.ts`, `backend/api/src/routes/auth/AuthRoutes.ts`, `backend/api/src/controllers/cluster.controller.ts`, `backend/api/src/controllers/health.controller.ts`, `backend/api/src/types/api.ts`
  - Pre-commit: `cd backend/api && bun test && npx tsc --noEmit`

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1 | `fix(routes): migrate usage.routes.ts to asyncHandler + api-response` | usage.routes.ts | bun test + tsc |
| 2 | `fix(data): integrate withRetry into UnifiedDatabase standalone queries` | unified-database.ts, retry-integration.test.ts | bun test + tsc |
| 3 | `fix(routes): migrate 7 remaining route files to asyncHandler + api-response` | 7 route files | bun test + tsc |
| 4 | `fix(mcp): enforce UserContext type on MCPToolHandler context parameter` | types.ts + related | bun test + tsc |
| 5 | `fix(api): standardize remaining raw res.json calls and deprecate types/api.ts` | middlewares, controllers, types | bun test + tsc |

---

## Success Criteria

### Verification Commands
```bash
cd backend/api && bun test                          # Expected: 229+ pass, 0 fail
cd backend/api && npx tsc --noEmit                  # Expected: 0 errors
grep -rn "res\.json(" backend/api/src/routes/ backend/api/src/middlewares/ backend/api/src/controllers/  # Expected: 0 matches
grep "context?: unknown" backend/api/src/mcp/types.ts          # Expected: 0 matches
grep "withRetry" backend/api/src/data/models/unified-database.ts  # Expected: >= 1 match
grep "@deprecated" backend/api/src/types/api.ts                 # Expected: 1 match
```

### Final Checklist
- [ ] All 8 route files use `asyncHandler` — no unhandled async errors
- [ ] All raw `res.json()` replaced with `api-response` helpers
- [ ] `withRetry` integrated into `UnifiedDatabase` (not inside transactions)
- [ ] `MCPToolHandler.context` typed as `UserContext` (not `unknown`)
- [ ] `types/api.ts` marked `@deprecated`
- [ ] 229+ tests passing
- [ ] TypeScript strict-mode clean
- [ ] No `as any` or `@ts-ignore` introduced
- [ ] No streaming/SSE handlers wrapped with asyncHandler
- [ ] All HTTP status codes unchanged
- [ ] All response body shapes unchanged
