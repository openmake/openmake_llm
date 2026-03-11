<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# auth — JWT, OAuth, RBAC, API Keys

## Purpose
Handles the complete authentication and authorization surface: JWT access token generation (15-minute expiry) and refresh token rotation (7-day expiry) stored in HttpOnly cookies, RBAC role enforcement middleware, Google and GitHub OAuth 2.0 flows, and API key generation/validation using HMAC-SHA-256 with the `omk_live_` prefix. This directory is security-critical — modifications require careful review.

## Key Files
| File | Description |
|------|-------------|
| `index.ts` | JWT generation for access (15 min) and refresh (7 day) tokens; token verification helpers |
| `middleware.ts` | Express middleware: `optionalAuth`, `requireAuth`, `requireAdmin`, `requireRole` |
| `oauth-provider.ts` | OAuth 2.0 manager for Google and GitHub provider flows |
| `api-key-utils.ts` | API key generation with `omk_live_` prefix, HMAC-SHA-256 hashing, validation |
| `scope-middleware.ts` | API key scope enforcement — checks key permissions against required scopes |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- **This directory is marked modification-forbidden** in project coding rules (`infrastructure/security/auth/` 수정 금지)
- JWT secrets come from `config/env.ts` — never hardcode or log them
- Access tokens go in HttpOnly cookies only — never in response bodies or localStorage
- `requireAuth` must be applied before `requireRole`; wrong order causes incorrect 403s
- API key hashes are stored in DB; plaintext keys are shown only once at creation time

### Testing Requirements
- Auth middleware is tested via integration tests in `backend/api/src/__tests__/`
- Do not bypass auth middleware in tests; use proper test token fixtures
- Use `npm run test:bun` for fast feedback

### Common Patterns
- Middleware chain: `requireAuth` → `requireRole('admin')` → controller
- OAuth callback URLs must match exactly what is registered in the provider console
- Scope middleware uses bitfield-style string arrays: `['read:chat', 'write:documents']`

## Dependencies
### Internal
- `config/env.ts` — `JWT_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`
- `data/repositories/user` — User lookup for auth verification
- `data/models/token-blacklist.ts` — Revoked token storage

### External
- `jsonwebtoken` — JWT sign/verify
- `bcrypt` — Password hashing (used in user-manager, not here directly)
- `crypto` (Node built-in) — HMAC-SHA-256 for API key hashing

<!-- MANUAL: -->
