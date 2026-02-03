# Draft: Backend/Database Improvements (13 Tasks)

## Requirements (confirmed)
- Implement 13 backend/database improvements for OpenMake LLM
- Backend stack: Express.js + TypeScript
- Database: SQLite with better-sqlite3
- Auth: JWT-based authentication
- Frontend tasks excluded from this plan

## Technical Decisions

### 1. SQL Injection Fix (CRITICAL)
- **Location**: `backend/api/src/data/models/unified-database.ts` line 897
- **Issue Found**: String interpolation in SQL: `const ids = result.map(m => \`'${m.id}'\`).join(',');` followed by `WHERE id IN (${ids})`
- **Also Found**: Line 795 - `SELECT COUNT(*) as count FROM ${table}` (table name interpolation)
- **Solution**: Use parameterized placeholders `?` and pass ids as array, or use better-sqlite3's statement preparation

### 2. Rate Limiting (ALREADY PARTIALLY IMPLEMENTED)
- **Status**: `express-rate-limit` v8.2.1 already installed in package.json
- **Current Implementation**: 
  - `server.ts` lines 130-155: authLimiter (5 req/15min), chatLimiter (30 req/min), generalLimiter (100 req/15min)
  - `middlewares/index.ts` lines 75-101: Similar limiters defined
- **Gap**: Need to ensure consistent application and possibly externalize to Redis for distributed systems

### 3. Redis Token Blacklist (HIGH PRIORITY)
- **Current Implementation**: `infrastructure/security/auth/index.ts` line 18: `const tokenBlacklist = new Map<string, number>();`
- **Also Found**: Same pattern in `backend/api/src/auth/index.ts` - duplicate code!
- **Active Code Location**: `backend/api/src/auth/index.ts` is the active auth module (imported by server.ts)
- **Solution**: Replace in-memory Map with Redis using ioredis package

### 4. Remove `any` Types from ChatService (HIGH PRIORITY)
- **Location**: `backend/api/src/services/ChatService.ts`
- **Found 13 `any` usages**:
  1. Line 52: `history?: any[]` -> Should be `ChatMessage[]`
  2. Line 157: `onAgentSelected?: (agent: any) => void` -> Should be `AgentInfo`
  3. Line 254: `let currentHistory: any[]` -> Should be `ChatMessage[]`
  4. Line 262: `history.map((h: any) => ...)` -> Should be typed
  5. Line 312: `tools: allowedTools as any[]` -> Should be `ToolDefinition[]`
  6. Line 565: `chatMessages as any[]` -> Should be typed
  7. Line 613: `webSearchFn: ((q: string, opts?: any) => Promise<any[]>)` -> Should have proper types
  8. Line 664: `executeToolCall(toolCall: any)` -> Should be `ToolCall`
  9-13: Various error catches `catch (e: any)` -> Can stay as Error handling

### 5. Unified Error Handler (PARTIALLY EXISTS)
- **Current State**: 
  - `middlewares/index.ts` lines 156-167: `globalErrorHandler` exists
  - `server.ts` lines 1112-1128: Inline error handler
- **Gap**: Not consistently used, need to centralize all error types

### 6. Input Validation with Zod (Zod ALREADY INSTALLED)
- **Status**: Zod v3/v4 already in node_modules (found test files)
- **Gap**: No validation middleware or schemas exist
- **Need**: Create validation schemas for chat, auth endpoints

### 7. JWT Token Expiry
- **Current Config**: 
  - `backend/api/src/auth/index.ts` line 82: `JWT_EXPIRES_IN = '7d'`
  - `config/constants.ts` line 85: `TOKEN_EXPIRY: '7d'`
- **Target**: Access token 15m, refresh token 7d
- **Existing**: `generateRefreshToken()` function exists with 30d expiry

### 8. Split server.ts (LARGE FILE ~1200 lines)
- **Current Structure**: Already has some routes extracted to:
  - `routes/chat.routes.ts`
  - `routes/documents.routes.ts`
  - `routes/agents.routes.ts`
  - `routes/mcp.routes.ts`
  - etc.
- **Still in server.ts**: 
  - Lines 535-606: /api/chat POST (duplicated with chatRouter?)
  - Lines 645-725: /api/upload POST
  - Lines 727-778: /api/summarize POST
  - Lines 780-825: /api/document/ask POST
  - Lines 827-866: GET/DELETE /api/documents
  - Lines 867-952: /api/web-search POST
  - Lines 954-1082: Admin APIs
- **Need**: Extract admin routes, upload routes to separate files

### 9. Boolean Conversion Helper
- **Current State**: No consistent boolean handling found in database layer
- **Need**: Add `toBool()` helper for SQLite boolean (0/1) to JS boolean conversion

### 10. Security Middleware
- **Helmet**: NOT INSTALLED - need to add
- **CORS**: EXISTS in server.ts lines 338-352 and middlewares/index.ts
- **CSRF**: NOT IMPLEMENTED
- **Need**: Add helmet, csrf protection

### 11. API Versioning
- **Current**: Routes use `/api/chat`, `/api/auth`, etc.
- **Target**: `/api/v1/chat`, `/api/v1/auth`
- **Implementation**: Create versioned router wrapper

### 12. Password Policy
- **Current**: `AuthService.ts` lines 53-55: Only `password.length < 6` check
- **Need**: Add complexity requirements (uppercase, lowercase, number, special char, min 8)

### 13. Additional Tests
- **Current Tests Found**:
  - `backend/api/src/__tests__/auth.test.ts` - Basic auth tests exist
  - `backend/api/src/__tests__/mcp-filesystem.test.ts`
  - `tests/unit/__tests__/` - Unit tests directory
  - `tests/e2e/` - E2E tests with Playwright
- **Test Framework**: Jest (configured in package.json)
- **Gap**: No ChatService tests, error handler tests

## Research Findings

### Dependencies Status
| Package | Status | Notes |
|---------|--------|-------|
| express-rate-limit | INSTALLED v8.2.1 | In use |
| zod | INSTALLED | Not yet used for validation |
| helmet | NOT INSTALLED | Need to add |
| ioredis | NOT INSTALLED | Need for Redis blacklist |
| csurf/csrf | NOT INSTALLED | Need for CSRF protection |

### Existing Patterns to Follow
1. **Middleware Pattern**: See `middlewares/index.ts` for standard middleware structure
2. **Route Pattern**: See `routes/index.ts` for route exports
3. **Logger Pattern**: `utils/logger.ts` using Winston
4. **Constants Pattern**: `config/constants.ts` for centralized config
5. **Test Pattern**: `__tests__/auth.test.ts` for Jest test structure

### File Structure
```
backend/api/src/
├── auth/
│   ├── index.ts         # JWT functions + blacklist
│   ├── middleware.ts    # Auth middlewares
│   └── types.ts         # Auth types
├── config/
│   └── constants.ts     # Centralized constants
├── data/models/
│   └── unified-database.ts  # SQL injection issue here
├── middlewares/
│   └── index.ts         # Common middlewares
├── routes/
│   ├── index.ts         # Route exports
│   └── *.routes.ts      # Individual routes
├── services/
│   ├── AuthService.ts   # Auth business logic
│   └── ChatService.ts   # Chat with any types
├── utils/
│   └── logger.ts        # Winston logger
└── server.ts            # Main server (1200+ lines)
```

## Scope Boundaries

### IN Scope
- SQL injection fix
- Rate limiting consolidation (already partially done)
- Redis token blacklist
- Remove `any` types in ChatService
- Unified error handler
- Zod input validation middleware
- JWT token expiry changes
- Split server.ts into route modules
- Boolean conversion helper
- Security middleware (Helmet, CSRF)
- API versioning
- Password policy
- Unit tests for ChatService, AuthService, error handler

### OUT of Scope
- Frontend changes
- Database schema migrations
- Deployment/infrastructure changes
- Performance optimization beyond these fixes
- New feature development

## Open Questions

1. **Redis Connection**: Will Redis be available in production? Need connection string/config.
2. **API Versioning Strategy**: Should v1 be the only version, or plan for future versions?
3. **CSRF Strategy**: SPA with JWT typically uses different CSRF approach - confirm approach?
4. **Test Coverage Target**: What's the minimum coverage requirement?

## Verification Strategy Decision
- **Infrastructure exists**: YES (Jest configured)
- **User wants tests**: YES (Task 16 explicitly requests tests)
- **Framework**: Jest with ts-jest
- **QA approach**: Tests-after implementation (not TDD)
