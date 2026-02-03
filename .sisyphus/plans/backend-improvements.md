# Backend/Database Improvements (13 Tasks)

## TL;DR

> **Quick Summary**: Implement 13 backend security and code quality improvements for OpenMake LLM, including critical SQL injection fix, TypeScript type safety, security hardening, and architectural cleanup.
> 
> **Deliverables**:
> - SQL injection vulnerabilities fixed with parameterized queries
> - SQLite-backed token blacklist with pluggable interface
> - Type-safe ChatService (no `any` types)
> - Zod validation middleware for API endpoints
> - Security headers via Helmet
> - API versioning (/api/v1/*)
> - Fully split server.ts into route modules
> - Password complexity policy
> - Moderate test coverage for core services
> 
> **Estimated Effort**: Large (13 interconnected tasks)
> **Parallel Execution**: YES - 5 waves
> **Critical Path**: Task 1 (SQL fix) → Task 3 (Blacklist) → Task 7 (JWT) → Task 13 (Tests)

---

## Context

### Original Request
Implement 13 backend/database improvements for the OpenMake LLM project. Backend uses Express.js + TypeScript with SQLite (better-sqlite3) and JWT authentication. Frontend tasks excluded.

### Interview Summary
**Key Discussions**:
- SQLite-backed blacklist with pluggable interface (future Redis swap)
- Simple /v1 prefix for API versioning
- No CSRF needed (JWT stored in localStorage)
- Helmet for security headers
- Complete server.ts split to separate route files
- Moderate test coverage (happy path + key error scenarios)

**Research Findings**:
- SQL injection at lines 897 AND 795 in unified-database.ts
- Duplicate auth code exists (infrastructure/ vs backend/api/src/auth/ - latter is active)
- Rate limiting already implemented with express-rate-limit v8.2.1
- Zod installed but unused for validation
- Jest configured with existing tests in `__tests__/`
- server.ts is ~1200 lines with some routes already extracted

### Metis Review
**Identified Gaps** (addressed):
- Rate limiting consolidation scope clarified (already partially done)
- Boolean helper scope limited to database layer only
- Test scope bounded to ChatService, AuthService, error handler
- Duplicate auth code in infrastructure/ marked as out of scope (cleanup separately)

---

## Work Objectives

### Core Objective
Improve backend security posture and code quality through SQL injection fixes, type safety improvements, security hardening, and architectural cleanup.

### Concrete Deliverables
- `backend/api/src/data/models/unified-database.ts` - SQL injection fixed
- `backend/api/src/data/models/token-blacklist.ts` - New SQLite-backed blacklist
- `backend/api/src/services/ChatService.ts` - All `any` types removed
- `backend/api/src/utils/error-handler.ts` - Unified error handler
- `backend/api/src/middlewares/validation.ts` - Zod validation middleware
- `backend/api/src/schemas/` - Zod schemas for auth, chat
- `backend/api/src/auth/index.ts` - Updated JWT expiry (15m/7d)
- `backend/api/src/routes/admin.routes.ts` - Extracted admin routes
- `backend/api/src/routes/upload.routes.ts` - Extracted upload routes
- `backend/api/src/utils/db-helpers.ts` - Boolean conversion helper
- `backend/api/src/server.ts` - Helmet integration, route cleanup
- `backend/api/src/services/AuthService.ts` - Password policy
- `backend/api/src/__tests__/ChatService.test.ts` - New tests
- `backend/api/src/__tests__/error-handler.test.ts` - New tests

### Definition of Done
- [ ] All SQL queries use parameterized statements (no string interpolation)
- [ ] Token blacklist persists to SQLite and survives server restart
- [ ] ChatService has zero `any` type usages
- [ ] All API endpoints return consistent error format
- [ ] Auth endpoints validate input with Zod
- [ ] Access token expires in 15 minutes
- [ ] All route handlers extracted from server.ts
- [ ] `npm test` passes with new tests
- [ ] Security headers visible in response (X-Content-Type-Options, etc.)

### Must Have
- SQL injection fix (CRITICAL security)
- Token blacklist persistence
- Type safety in ChatService
- Security headers via Helmet
- Password complexity validation

### Must NOT Have (Guardrails)
- Do NOT modify frontend code
- Do NOT change database schema (use existing tables or new tables only)
- Do NOT refactor infrastructure/security/auth/ (out of scope - duplicate code cleanup is separate)
- Do NOT add Redis dependency (SQLite-backed for now)
- Do NOT implement CSRF protection (not needed for localStorage JWT)
- Do NOT add excessive validation (only auth and chat endpoints)
- Do NOT over-engineer versioning (simple /v1 prefix only)
- Do NOT create comprehensive test suites (moderate coverage only)

---

## Verification Strategy (MANDATORY)

### Test Decision
- **Infrastructure exists**: YES
- **User wants tests**: YES (Tests-after)
- **Framework**: Jest with ts-jest

### Automated Verification (Agent-Executable)

Each TODO includes executable verification that agents can run directly:

**For Code Changes** (using Bash):
```bash
# TypeScript compilation check
cd backend/api && npx tsc --noEmit

# Run specific tests
npm test -- --testPathPattern="ChatService|AuthService|error-handler"
```

**For Security Headers** (using curl):
```bash
curl -I http://localhost:52416/api/health | grep -E "X-Content-Type|X-Frame|Strict-Transport"
```

**For API Versioning** (using curl):
```bash
curl -s http://localhost:52416/api/v1/health | jq '.success'
```

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately) - Foundation & Critical Security:
├── Task 1: SQL Injection Fix [CRITICAL]
├── Task 9: Boolean Conversion Helper
└── Task 12: Password Policy

Wave 2 (After Wave 1) - Security Infrastructure:
├── Task 3: SQLite Token Blacklist [depends: 1, 9]
├── Task 6: Zod Validation Middleware
└── Task 10: Security Middleware (Helmet)

Wave 3 (After Wave 2) - Type Safety & Error Handling:
├── Task 4: Remove `any` Types from ChatService
├── Task 5: Unified Error Handler
└── Task 7: JWT Token Expiry [depends: 3]

Wave 4 (After Wave 3) - Architecture:
├── Task 8: Split server.ts [depends: 5, 10]
├── Task 11: API Versioning [depends: 8]
└── Task 2: Rate Limiting Consolidation [depends: 8]

Wave 5 (After Wave 4) - Testing & Verification:
└── Task 13: Unit Tests [depends: 4, 5, 7]

Critical Path: Task 1 → Task 3 → Task 7 → Task 13
Parallel Speedup: ~50% faster than sequential
```

### Dependency Matrix

| Task | Depends On | Blocks | Can Parallelize With |
|------|------------|--------|---------------------|
| 1. SQL Injection | None | 3 | 9, 12 |
| 2. Rate Limiting | 8 | None | 11 |
| 3. Token Blacklist | 1, 9 | 7 | 6, 10 |
| 4. Remove `any` | None | 13 | 5 |
| 5. Error Handler | None | 8, 13 | 4 |
| 6. Zod Validation | None | None | 3, 10 |
| 7. JWT Expiry | 3 | 13 | None |
| 8. Split server.ts | 5, 10 | 2, 11 | None |
| 9. Boolean Helper | None | 3 | 1, 12 |
| 10. Helmet | None | 8 | 3, 6 |
| 11. API Versioning | 8 | None | 2 |
| 12. Password Policy | None | None | 1, 9 |
| 13. Tests | 4, 5, 7 | None | None (final) |

### Agent Dispatch Summary

| Wave | Tasks | Recommended Dispatch |
|------|-------|---------------------|
| 1 | 1, 9, 12 | 3 parallel agents |
| 2 | 3, 6, 10 | 3 parallel agents |
| 3 | 4, 5, 7 | 3 parallel agents |
| 4 | 8, 11, 2 | 3 parallel agents |
| 5 | 13 | 1 agent (final) |

---

## TODOs

### Wave 1: Foundation & Critical Security

- [ ] 1. SQL Injection Fix [CRITICAL]

  **What to do**:
  - Fix string interpolation SQL injection at line 897 in `unified-database.ts`
  - Fix table name interpolation at line 795 (whitelist valid table names)
  - Replace `WHERE id IN (${ids})` with parameterized placeholders
  - Use better-sqlite3's native parameter binding

  **Must NOT do**:
  - Do NOT change the database schema
  - Do NOT modify unrelated queries
  - Do NOT add ORM/query builder

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Focused security fix, single file, clear scope
  - **Skills**: [`git-master`]
    - `git-master`: Atomic commit for security fix with clear message

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 9, 12)
  - **Blocks**: Task 3 (Token Blacklist)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `backend/api/src/data/models/unified-database.ts:880-906` - Current vulnerable code (searchMemories method)
  - `backend/api/src/data/models/unified-database.ts:795` - Table name interpolation issue

  **API/Type References**:
  - better-sqlite3 docs: Prepared statements with `?` placeholders
  - `backend/api/src/data/models/unified-database.ts:927` - Example of safe parameterized query pattern

  **Acceptance Criteria**:

  ```bash
  # Verify no string interpolation in SQL WHERE IN clauses
  grep -n "IN (\${" backend/api/src/data/models/unified-database.ts
  # Expected: No matches (exit code 1)

  # Verify table name is validated
  grep -n "const validTables" backend/api/src/data/models/unified-database.ts
  # Expected: 1 match showing whitelist

  # TypeScript compiles without error
  cd backend/api && npx tsc --noEmit
  # Expected: Exit code 0
  ```

  **Commit**: YES
  - Message: `fix(security): parameterize SQL queries to prevent injection`
  - Files: `backend/api/src/data/models/unified-database.ts`
  - Pre-commit: `cd backend/api && npx tsc --noEmit`

---

- [ ] 9. Boolean Conversion Helper

  **What to do**:
  - Create `backend/api/src/utils/db-helpers.ts` with `toBool()` helper
  - Function converts SQLite integer (0/1) to JavaScript boolean
  - Function handles null/undefined gracefully
  - Export for use in database models

  **Must NOT do**:
  - Do NOT apply to all existing code (that's a separate refactor)
  - Do NOT modify database schema

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small utility function, single new file
  - **Skills**: []
    - No special skills needed for simple utility

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 12)
  - **Blocks**: Task 3 (Token Blacklist uses this helper)
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `backend/api/src/utils/logger.ts` - Utility file pattern to follow

  **Acceptance Criteria**:

  ```bash
  # File exists
  test -f backend/api/src/utils/db-helpers.ts && echo "EXISTS"
  # Expected: EXISTS

  # TypeScript compiles
  cd backend/api && npx tsc --noEmit
  # Expected: Exit code 0

  # Function signature check
  grep -n "export function toBool" backend/api/src/utils/db-helpers.ts
  # Expected: 1 match
  ```

  **Commit**: YES
  - Message: `feat(utils): add toBool helper for SQLite boolean conversion`
  - Files: `backend/api/src/utils/db-helpers.ts`
  - Pre-commit: `cd backend/api && npx tsc --noEmit`

---

- [ ] 12. Password Policy

  **What to do**:
  - Update `backend/api/src/services/AuthService.ts` register method
  - Add password complexity validation:
    - Minimum 8 characters
    - At least 1 uppercase letter
    - At least 1 lowercase letter
    - At least 1 number
    - At least 1 special character (!@#$%^&*()_+-=)
  - Return descriptive error messages for each violation
  - Update changePassword method with same policy

  **Must NOT do**:
  - Do NOT change existing passwords in database
  - Do NOT add password history tracking
  - Do NOT add password expiration

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file modification, clear requirements
  - **Skills**: []
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 9)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `backend/api/src/services/AuthService.ts:45-70` - Current register method
  - `backend/api/src/services/AuthService.ts:97-116` - Current changePassword method

  **Acceptance Criteria**:

  ```bash
  # Check for password validation regex or function
  grep -n "uppercase\|lowercase\|special" backend/api/src/services/AuthService.ts
  # Expected: Multiple matches showing validation

  # Check minimum length changed from 6 to 8
  grep -n "length < 8" backend/api/src/services/AuthService.ts
  # Expected: At least 1 match

  # TypeScript compiles
  cd backend/api && npx tsc --noEmit
  # Expected: Exit code 0
  ```

  **Commit**: YES
  - Message: `feat(auth): add password complexity requirements`
  - Files: `backend/api/src/services/AuthService.ts`
  - Pre-commit: `cd backend/api && npx tsc --noEmit`

---

### Wave 2: Security Infrastructure

- [ ] 3. SQLite Token Blacklist

  **What to do**:
  - Create `backend/api/src/data/models/token-blacklist.ts` with pluggable interface
  - Define `ITokenBlacklist` interface with methods: `add(jti, expiry)`, `has(jti)`, `cleanup()`
  - Implement `SQLiteTokenBlacklist` class using unified.db
  - Create `token_blacklist` table if not exists (jti TEXT PRIMARY KEY, expires_at INTEGER)
  - Update `backend/api/src/auth/index.ts` to use new blacklist instead of Map
  - Add cleanup scheduler (hourly) for expired tokens
  - Export factory function `getTokenBlacklist()` for future Redis swap

  **Must NOT do**:
  - Do NOT add Redis dependency yet
  - Do NOT modify infrastructure/security/auth/ (duplicate code, out of scope)
  - Do NOT change JWT payload structure

  **Recommended Agent Profile**:
  - **Category**: `ultrabrain`
    - Reason: Database integration, interface design, multiple file coordination
  - **Skills**: [`git-master`]
    - `git-master`: Atomic commit for new module

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 10)
  - **Blocks**: Task 7 (JWT Expiry depends on blacklist working)
  - **Blocked By**: Tasks 1, 9

  **References**:

  **Pattern References**:
  - `backend/api/src/auth/index.ts:17-71` - Current in-memory blacklist implementation
  - `backend/api/src/data/models/unified-database.ts:100-200` - Database table creation pattern
  - `backend/api/src/utils/db-helpers.ts` - toBool helper (from Task 9)

  **API/Type References**:
  - `backend/api/src/auth/types.ts` - Auth types for reference

  **Acceptance Criteria**:

  ```bash
  # New blacklist file exists
  test -f backend/api/src/data/models/token-blacklist.ts && echo "EXISTS"
  # Expected: EXISTS

  # Interface exported
  grep -n "export interface ITokenBlacklist" backend/api/src/data/models/token-blacklist.ts
  # Expected: 1 match

  # SQLite implementation exists
  grep -n "class SQLiteTokenBlacklist" backend/api/src/data/models/token-blacklist.ts
  # Expected: 1 match

  # Old Map removed from auth/index.ts
  grep -n "new Map<string, number>()" backend/api/src/auth/index.ts
  # Expected: No matches (exit code 1)

  # TypeScript compiles
  cd backend/api && npx tsc --noEmit
  # Expected: Exit code 0
  ```

  **Commit**: YES
  - Message: `feat(auth): implement SQLite-backed token blacklist with pluggable interface`
  - Files: `backend/api/src/data/models/token-blacklist.ts`, `backend/api/src/auth/index.ts`
  - Pre-commit: `cd backend/api && npx tsc --noEmit`

---

- [ ] 6. Zod Input Validation Middleware

  **What to do**:
  - Create `backend/api/src/schemas/auth.schema.ts` with Zod schemas:
    - `loginSchema`: email (email format), password (string)
    - `registerSchema`: email, password (min 8), role (optional enum)
    - `changePasswordSchema`: currentPassword, newPassword
  - Create `backend/api/src/schemas/chat.schema.ts`:
    - `chatMessageSchema`: message (string, min 1), history (optional array), docId (optional), etc.
  - Create `backend/api/src/middlewares/validation.ts`:
    - `validate(schema)` middleware factory
    - Returns 400 with Zod error messages on failure
  - Create `backend/api/src/schemas/index.ts` for exports

  **Must NOT do**:
  - Do NOT add validation to ALL endpoints (only auth and chat)
  - Do NOT use Zod v4 features (stick to v3 API for stability)
  - Do NOT validate response bodies

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: New files with clear patterns, no complex logic
  - **Skills**: []
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 3, 10)
  - **Blocks**: None (applied in Wave 4 during route restructure)
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `backend/api/src/middlewares/index.ts` - Middleware pattern to follow
  - `backend/api/src/services/AuthService.ts:14-37` - Request interfaces to match

  **External References**:
  - Zod docs: https://zod.dev/?id=basic-usage

  **Acceptance Criteria**:

  ```bash
  # Schema files exist
  test -f backend/api/src/schemas/auth.schema.ts && echo "EXISTS"
  test -f backend/api/src/schemas/chat.schema.ts && echo "EXISTS"
  # Expected: EXISTS for both

  # Validation middleware exists
  grep -n "export function validate" backend/api/src/middlewares/validation.ts
  # Expected: 1 match

  # Zod import present
  grep -n "import.*from 'zod'" backend/api/src/schemas/auth.schema.ts
  # Expected: 1 match

  # TypeScript compiles
  cd backend/api && npx tsc --noEmit
  # Expected: Exit code 0
  ```

  **Commit**: YES
  - Message: `feat(validation): add Zod schemas and validation middleware for auth/chat`
  - Files: `backend/api/src/schemas/*.ts`, `backend/api/src/middlewares/validation.ts`
  - Pre-commit: `cd backend/api && npx tsc --noEmit`

---

- [ ] 10. Security Middleware (Helmet)

  **What to do**:
  - Install helmet: `npm install helmet` in backend/api
  - Update `backend/api/src/server.ts` to use helmet middleware
  - Configure helmet with appropriate options:
    - contentSecurityPolicy: false (API server, not serving HTML)
    - crossOriginEmbedderPolicy: false (for API compatibility)
    - Other defaults enabled
  - Add helmet import and usage early in middleware chain (before routes)

  **Must NOT do**:
  - Do NOT add CSRF protection (not needed for localStorage JWT)
  - Do NOT configure CSP (API-only server)
  - Do NOT add rate limiting here (already done)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Package install + single file config change
  - **Skills**: []
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 3, 6)
  - **Blocks**: Task 8 (server.ts split depends on this being in place)
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `backend/api/src/server.ts:289-352` - Current middleware setup location
  - `backend/api/package.json` - Dependencies location

  **External References**:
  - Helmet docs: https://helmetjs.github.io/

  **Acceptance Criteria**:

  ```bash
  # Helmet installed
  grep -n '"helmet"' backend/api/package.json
  # Expected: 1 match in dependencies

  # Helmet imported in server.ts
  grep -n "import helmet from 'helmet'" backend/api/src/server.ts
  # Expected: 1 match

  # Helmet used in middleware
  grep -n "app.use(helmet" backend/api/src/server.ts
  # Expected: 1 match

  # Start server and check headers (requires running server)
  # curl -I http://localhost:52416/api/health | grep "X-Content-Type-Options"
  # Expected: "nosniff"
  ```

  **Commit**: YES
  - Message: `feat(security): add Helmet middleware for security headers`
  - Files: `backend/api/package.json`, `backend/api/src/server.ts`
  - Pre-commit: `cd backend/api && npx tsc --noEmit`

---

### Wave 3: Type Safety & Error Handling

- [ ] 4. Remove `any` Types from ChatService

  **What to do**:
  - Create proper interfaces in `backend/api/src/services/ChatService.ts` or separate types file:
    - `ChatMessage` interface for history items
    - `AgentInfo` interface for agent selection callback
    - `ToolCall` interface for tool execution
    - `WebSearchFunction` type for web search callback
  - Replace all 13 `any` usages with proper types:
    - Line 52: `history?: any[]` → `history?: ChatMessage[]`
    - Line 157: `(agent: any)` → `(agent: AgentInfo)`
    - Line 254: `any[]` → `ChatMessage[]`
    - Line 262: `(h: any)` → `(h: ChatMessage)`
    - Line 312: `as any[]` → `as ToolDefinition[]`
    - Line 565: `as any[]` → proper type
    - Line 613: function type with proper generics
    - Line 664: `toolCall: any` → `toolCall: ToolCall`
    - Lines 701, 716, 762, 806, 824: `catch (e: any)` → `catch (e: Error)` or `catch (e: unknown)`

  **Must NOT do**:
  - Do NOT change function behavior
  - Do NOT refactor method signatures (only add types)
  - Do NOT add strict null checks that break existing code

  **Recommended Agent Profile**:
  - **Category**: `ultrabrain`
    - Reason: Complex type inference, multiple interface definitions
  - **Skills**: []
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 5, 7)
  - **Blocks**: Task 13 (Tests need typed service)
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `backend/api/src/services/ChatService.ts:37-71` - Existing interfaces
  - `backend/api/src/ollama/types.ts:1-50` - ToolDefinition type reference
  - `backend/api/src/auth/types.ts` - Type file pattern

  **Acceptance Criteria**:

  ```bash
  # Count remaining any usages (should be 0 or only in catch blocks with unknown)
  grep -c ": any" backend/api/src/services/ChatService.ts
  # Expected: 0 (or document exceptions)

  # New interfaces defined
  grep -n "interface ChatMessage\|interface AgentInfo\|interface ToolCall" backend/api/src/services/ChatService.ts
  # Expected: At least 3 matches

  # TypeScript compiles with strict mode
  cd backend/api && npx tsc --noEmit
  # Expected: Exit code 0
  ```

  **Commit**: YES
  - Message: `refactor(types): replace any types with proper interfaces in ChatService`
  - Files: `backend/api/src/services/ChatService.ts`
  - Pre-commit: `cd backend/api && npx tsc --noEmit`

---

- [ ] 5. Unified Error Handler

  **What to do**:
  - Create `backend/api/src/utils/error-handler.ts`:
    - Define `AppError` class extending Error with statusCode, isOperational
    - Define error types: `ValidationError`, `AuthenticationError`, `NotFoundError`, `DatabaseError`
    - Create `errorHandler` middleware function
    - Standardize error response format: `{ success: false, error: string, code?: string, timestamp: string }`
  - Update `backend/api/src/middlewares/index.ts` to export from error-handler
  - Update `backend/api/src/server.ts` to use unified error handler

  **Must NOT do**:
  - Do NOT change existing route error responses yet (applied in Task 8)
  - Do NOT add error logging to external services
  - Do NOT change success response format

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: New utility file with clear pattern
  - **Skills**: []
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 4, 7)
  - **Blocks**: Task 8 (server.ts split uses this), Task 13 (Tests)
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `backend/api/src/middlewares/index.ts:156-167` - Current globalErrorHandler
  - `backend/api/src/middlewares/index.ts:176-205` - ApiResponse interface pattern
  - `backend/api/src/server.ts:1112-1128` - Current inline error handler

  **Acceptance Criteria**:

  ```bash
  # Error handler file exists
  test -f backend/api/src/utils/error-handler.ts && echo "EXISTS"
  # Expected: EXISTS

  # AppError class defined
  grep -n "export class AppError" backend/api/src/utils/error-handler.ts
  # Expected: 1 match

  # Error types defined
  grep -n "ValidationError\|AuthenticationError\|NotFoundError" backend/api/src/utils/error-handler.ts
  # Expected: At least 3 matches

  # TypeScript compiles
  cd backend/api && npx tsc --noEmit
  # Expected: Exit code 0
  ```

  **Commit**: YES
  - Message: `feat(errors): add unified error handler with typed error classes`
  - Files: `backend/api/src/utils/error-handler.ts`, `backend/api/src/middlewares/index.ts`
  - Pre-commit: `cd backend/api && npx tsc --noEmit`

---

- [ ] 7. JWT Token Expiry

  **What to do**:
  - Update `backend/api/src/auth/index.ts`:
    - Change `JWT_EXPIRES_IN` from '7d' to '15m' (line 82)
    - Change `generateRefreshToken` expiry from '30d' to '7d' (line 145)
  - Update `backend/api/src/config/constants.ts`:
    - Update `AUTH_CONFIG.TOKEN_EXPIRY` to '15m'
    - Add `AUTH_CONFIG.REFRESH_TOKEN_EXPIRY` = '7d'
  - Add refresh token endpoint in auth routes if not exists:
    - POST /api/auth/refresh - accepts refresh token, returns new access token
  - Update token blacklist cleanup to handle shorter expiry

  **Must NOT do**:
  - Do NOT invalidate existing tokens (graceful transition)
  - Do NOT change JWT payload structure
  - Do NOT add token rotation on every request

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Configuration changes across few files
  - **Skills**: []
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES (after Wave 2)
  - **Parallel Group**: Wave 3 (with Tasks 4, 5)
  - **Blocks**: Task 13 (Tests need updated expiry)
  - **Blocked By**: Task 3 (Token Blacklist must be working)

  **References**:

  **Pattern References**:
  - `backend/api/src/auth/index.ts:82-130` - Token generation functions
  - `backend/api/src/auth/index.ts:137-149` - Refresh token function
  - `backend/api/src/config/constants.ts:79-88` - AUTH_CONFIG

  **Acceptance Criteria**:

  ```bash
  # Access token expiry is 15m
  grep -n "JWT_EXPIRES_IN = '15m'" backend/api/src/auth/index.ts
  # Expected: 1 match

  # Refresh token expiry is 7d
  grep -n "expiresIn: '7d'" backend/api/src/auth/index.ts
  # Expected: 1 match (in generateRefreshToken)

  # Constants updated
  grep -n "TOKEN_EXPIRY: '15m'" backend/api/src/config/constants.ts
  # Expected: 1 match

  # TypeScript compiles
  cd backend/api && npx tsc --noEmit
  # Expected: Exit code 0
  ```

  **Commit**: YES
  - Message: `feat(auth): reduce access token expiry to 15m, refresh to 7d`
  - Files: `backend/api/src/auth/index.ts`, `backend/api/src/config/constants.ts`
  - Pre-commit: `cd backend/api && npx tsc --noEmit`

---

### Wave 4: Architecture

- [ ] 8. Split server.ts Completely

  **What to do**:
  - Create `backend/api/src/routes/admin.routes.ts`:
    - Extract /api/admin/stats, /api/admin/conversations, /api/admin/export (lines 957-1082)
    - Apply requireAdmin middleware
  - Create `backend/api/src/routes/upload.routes.ts`:
    - Extract /api/upload, /api/summarize, /api/document/ask (lines 646-825)
    - Include multer configuration
  - Create `backend/api/src/routes/legacy-chat.routes.ts`:
    - Extract /api/chat POST (lines 535-606) - mark as legacy, chatRouter is preferred
    - Extract /api/chat/stream POST (lines 608-643)
  - Update `backend/api/src/routes/index.ts` to export new routers
  - Update `backend/api/src/server.ts`:
    - Remove extracted route handlers
    - Import and mount new routers
    - Apply unified error handler at the end
    - Apply Zod validation middleware to auth/chat routes
  - Keep in server.ts:
    - Express app setup
    - Middleware chain (cors, helmet, rate limiting)
    - Router mounting
    - WebSocket setup
    - Server start

  **Must NOT do**:
  - Do NOT change route paths or behavior
  - Do NOT modify WebSocket handling
  - Do NOT change middleware order

  **Recommended Agent Profile**:
  - **Category**: `ultrabrain`
    - Reason: Large refactor, multiple files, careful extraction needed
  - **Skills**: [`git-master`]
    - `git-master`: Multiple related files in single atomic commit

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 start
  - **Blocks**: Tasks 2, 11
  - **Blocked By**: Tasks 5, 10

  **References**:

  **Pattern References**:
  - `backend/api/src/routes/chat.routes.ts` - Existing route file pattern
  - `backend/api/src/routes/index.ts` - Router export pattern
  - `backend/api/src/server.ts:535-1082` - Code to extract
  - `backend/api/src/controllers/admin.controller.ts` - Controller pattern (if using)

  **Acceptance Criteria**:

  ```bash
  # New route files exist
  test -f backend/api/src/routes/admin.routes.ts && echo "EXISTS"
  test -f backend/api/src/routes/upload.routes.ts && echo "EXISTS"
  # Expected: EXISTS for both

  # Server.ts reduced in size
  wc -l backend/api/src/server.ts | awk '{print $1}'
  # Expected: Less than 600 lines (was ~1200)

  # Routes still work (requires running server)
  # curl http://localhost:52416/api/admin/stats -H "Authorization: Bearer $TOKEN"
  # Expected: JSON response

  # TypeScript compiles
  cd backend/api && npx tsc --noEmit
  # Expected: Exit code 0
  ```

  **Commit**: YES
  - Message: `refactor(routes): extract admin, upload routes from server.ts`
  - Files: `backend/api/src/routes/admin.routes.ts`, `backend/api/src/routes/upload.routes.ts`, `backend/api/src/routes/legacy-chat.routes.ts`, `backend/api/src/routes/index.ts`, `backend/api/src/server.ts`
  - Pre-commit: `cd backend/api && npx tsc --noEmit`

---

- [ ] 11. API Versioning

  **What to do**:
  - Create `backend/api/src/routes/v1/index.ts`:
    - Import all existing routers
    - Re-export under /v1 prefix
  - Update `backend/api/src/server.ts`:
    - Mount v1 router at `/api/v1`
    - Keep `/api/*` routes as aliases (backward compatibility during transition)
    - Add deprecation header to non-versioned routes
  - Update route mounts:
    - `/api/v1/chat` → chatRouter
    - `/api/v1/auth` → authRouter
    - `/api/v1/admin` → adminRouter
    - etc.

  **Must NOT do**:
  - Do NOT remove old /api/* routes immediately (add deprecation warning)
  - Do NOT add version negotiation via headers
  - Do NOT create v2 routes

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Wrapper routes, straightforward restructure
  - **Skills**: []
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Task 2)
  - **Blocks**: None
  - **Blocked By**: Task 8

  **References**:

  **Pattern References**:
  - `backend/api/src/routes/index.ts` - Current route exports
  - `backend/api/src/server.ts:361-392` - Current route mounting

  **Acceptance Criteria**:

  ```bash
  # v1 index file exists
  test -f backend/api/src/routes/v1/index.ts && echo "EXISTS"
  # Expected: EXISTS

  # v1 routes mounted
  grep -n "'/api/v1'" backend/api/src/server.ts
  # Expected: At least 1 match

  # Old routes still work (deprecated)
  # curl http://localhost:52416/api/chat -X POST -d '{"message":"test"}'
  # Expected: Works with deprecation warning in headers

  # TypeScript compiles
  cd backend/api && npx tsc --noEmit
  # Expected: Exit code 0
  ```

  **Commit**: YES
  - Message: `feat(api): add /api/v1 versioned routes with backward compatibility`
  - Files: `backend/api/src/routes/v1/index.ts`, `backend/api/src/server.ts`
  - Pre-commit: `cd backend/api && npx tsc --noEmit`

---

- [ ] 2. Rate Limiting Consolidation

  **What to do**:
  - Review current rate limiting:
    - `server.ts` lines 130-155: Already has authLimiter, chatLimiter, generalLimiter
    - `middlewares/index.ts` lines 75-101: Duplicate definitions
  - Consolidate to single source of truth:
    - Keep definitions in `middlewares/index.ts`
    - Remove duplicates from `server.ts`
    - Import and apply from middlewares
  - Ensure consistent application:
    - authLimiter on /api/v1/auth/*
    - chatLimiter on /api/v1/chat/*
    - generalLimiter on remaining /api/v1/*
  - Update `config/constants.ts` RATE_LIMITS if values differ

  **Must NOT do**:
  - Do NOT change rate limit values (already correct: 5/15min auth, 30/min chat, 100/15min general)
  - Do NOT add Redis store (future consideration)
  - Do NOT add per-user rate limiting

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Code consolidation, removing duplicates
  - **Skills**: []
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Task 11)
  - **Blocks**: None
  - **Blocked By**: Task 8

  **References**:

  **Pattern References**:
  - `backend/api/src/server.ts:130-155` - Current inline limiters
  - `backend/api/src/middlewares/index.ts:75-101` - Middleware limiters
  - `backend/api/src/config/constants.ts:25-44` - RATE_LIMITS config

  **Acceptance Criteria**:

  ```bash
  # No duplicate rate limiter definitions in server.ts
  grep -c "rateLimit({" backend/api/src/server.ts
  # Expected: 0 (all moved to middlewares)

  # Rate limiters exported from middlewares
  grep -n "export const.*Limiter" backend/api/src/middlewares/index.ts
  # Expected: 3 matches (general, auth, chat)

  # TypeScript compiles
  cd backend/api && npx tsc --noEmit
  # Expected: Exit code 0
  ```

  **Commit**: YES
  - Message: `refactor(middleware): consolidate rate limiters to single source`
  - Files: `backend/api/src/server.ts`, `backend/api/src/middlewares/index.ts`
  - Pre-commit: `cd backend/api && npx tsc --noEmit`

---

### Wave 5: Testing & Verification

- [ ] 13. Unit Tests

  **What to do**:
  - Create `backend/api/src/__tests__/ChatService.test.ts`:
    - Test processMessage happy path (mock OllamaClient)
    - Test agent selection callback
    - Test error handling when client unavailable
    - Test discussion mode toggle
  - Create `backend/api/src/__tests__/error-handler.test.ts`:
    - Test AppError creation
    - Test errorHandler middleware
    - Test different error types return correct status codes
    - Test error response format
  - Update `backend/api/src/__tests__/auth.test.ts`:
    - Add tests for password policy validation
    - Add tests for token blacklist (SQLite-backed)
    - Add tests for refresh token generation
  - Ensure all tests pass with `npm test`

  **Must NOT do**:
  - Do NOT aim for 100% coverage
  - Do NOT add integration tests (unit only)
  - Do NOT mock database for blacklist tests (use in-memory SQLite)

  **Recommended Agent Profile**:
  - **Category**: `ultrabrain`
    - Reason: Multiple test files, mocking strategies, comprehensive scenarios
  - **Skills**: []
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: NO (final task)
  - **Parallel Group**: Wave 5 (solo)
  - **Blocks**: None (final)
  - **Blocked By**: Tasks 4, 5, 7

  **References**:

  **Pattern References**:
  - `backend/api/src/__tests__/auth.test.ts` - Existing test patterns
  - `backend/api/src/__tests__/mcp-filesystem.test.ts` - Another test example
  - `tests/unit/__tests__/cluster.test.ts` - Unit test structure

  **Test References**:
  - Jest docs: https://jestjs.io/docs/getting-started
  - ts-jest docs: https://kulshekhar.github.io/ts-jest/

  **Acceptance Criteria**:

  ```bash
  # Test files exist
  test -f backend/api/src/__tests__/ChatService.test.ts && echo "EXISTS"
  test -f backend/api/src/__tests__/error-handler.test.ts && echo "EXISTS"
  # Expected: EXISTS for both

  # All tests pass
  cd backend/api && npm test
  # Expected: All tests pass, exit code 0

  # Coverage for key files (optional check)
  cd backend/api && npm test -- --coverage --collectCoverageFrom="src/services/ChatService.ts"
  # Expected: Some coverage reported
  ```

  **Commit**: YES
  - Message: `test: add unit tests for ChatService, error handler, and auth`
  - Files: `backend/api/src/__tests__/ChatService.test.ts`, `backend/api/src/__tests__/error-handler.test.ts`, `backend/api/src/__tests__/auth.test.ts`
  - Pre-commit: `cd backend/api && npm test`

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1 | `fix(security): parameterize SQL queries to prevent injection` | unified-database.ts | tsc --noEmit |
| 9 | `feat(utils): add toBool helper for SQLite boolean conversion` | db-helpers.ts | tsc --noEmit |
| 12 | `feat(auth): add password complexity requirements` | AuthService.ts | tsc --noEmit |
| 3 | `feat(auth): implement SQLite-backed token blacklist` | token-blacklist.ts, auth/index.ts | tsc --noEmit |
| 6 | `feat(validation): add Zod schemas and validation middleware` | schemas/*.ts, validation.ts | tsc --noEmit |
| 10 | `feat(security): add Helmet middleware for security headers` | package.json, server.ts | tsc --noEmit |
| 4 | `refactor(types): replace any types in ChatService` | ChatService.ts | tsc --noEmit |
| 5 | `feat(errors): add unified error handler` | error-handler.ts, middlewares/index.ts | tsc --noEmit |
| 7 | `feat(auth): reduce token expiry to 15m/7d` | auth/index.ts, constants.ts | tsc --noEmit |
| 8 | `refactor(routes): extract admin, upload routes from server.ts` | admin.routes.ts, upload.routes.ts, server.ts | tsc --noEmit |
| 11 | `feat(api): add /api/v1 versioned routes` | v1/index.ts, server.ts | tsc --noEmit |
| 2 | `refactor(middleware): consolidate rate limiters` | server.ts, middlewares/index.ts | tsc --noEmit |
| 13 | `test: add unit tests for ChatService, error handler, auth` | __tests__/*.test.ts | npm test |

---

## Success Criteria

### Verification Commands
```bash
# 1. TypeScript compiles cleanly
cd backend/api && npx tsc --noEmit
# Expected: Exit code 0

# 2. All tests pass
cd backend/api && npm test
# Expected: All tests pass

# 3. No SQL injection patterns remain
grep -r "IN (\${" backend/api/src/data/
# Expected: No matches

# 4. No any types in ChatService
grep -c ": any" backend/api/src/services/ChatService.ts
# Expected: 0

# 5. Security headers present (requires running server)
curl -I http://localhost:52416/api/v1/health | grep -E "X-Content-Type|X-Frame"
# Expected: Headers present

# 6. Token blacklist persists (requires test)
# Blacklist a token, restart server, verify still blacklisted
```

### Final Checklist
- [ ] All "Must Have" items implemented
- [ ] All "Must NOT Have" guardrails respected
- [ ] All tests pass
- [ ] TypeScript compiles without errors
- [ ] SQL injection vulnerabilities eliminated
- [ ] Token blacklist survives server restart
- [ ] Security headers visible in API responses
- [ ] API versioning (/api/v1/*) working
- [ ] server.ts reduced to < 600 lines
