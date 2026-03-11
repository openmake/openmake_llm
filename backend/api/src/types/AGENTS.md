<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# types — Global TypeScript Type Declarations

## Purpose
Houses global TypeScript type declarations and module augmentations. `api.ts` defines shared domain types used across the codebase (user, session, message, agent profile types). `express.d.ts` augments the Express `Request` type to include the authenticated `user` property set by auth middleware. `jsonwebtoken.d.ts` and `nodemailer.d.ts` provide or extend type declarations for packages where the bundled types are insufficient.

## Key Files
| File | Description |
|------|-------------|
| `api.ts` | Shared domain types: `User`, `Session`, `Message`, `AgentProfile`, `QueryType`, etc. |
| `express.d.ts` | Express `Request` augmentation: adds `req.user: AuthenticatedUser` |
| `jsonwebtoken.d.ts` | Extended JWT payload type declarations |
| `nodemailer.d.ts` | Nodemailer type extensions if needed |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- `express.d.ts` augmentation is what makes `req.user` type-safe throughout the codebase — do not remove it
- Shared types in `api.ts` are the source of truth; do not duplicate type definitions in individual modules
- Module augmentation files (`*.d.ts`) must use `declare module '...'` syntax and be included in `tsconfig.json`'s `typeRoots` or `types`
- When adding new domain types, prefer adding to `api.ts` over creating new type files for small additions

### Testing Requirements
- Types are verified by the TypeScript compiler during `npm run build:backend` — compilation failure = type error
- Run `npx tsc --noEmit` to check types without producing output

### Common Patterns
- Express augmentation: `declare global { namespace Express { interface Request { user?: AuthenticatedUser } } }`
- Domain type: `export interface User { id: string; email: string; role: UserRole; tier: Tier }`
- Import: `import type { User } from '@/types/api'`

## Dependencies
### Internal
- Referenced by virtually every module that handles user data or Express requests

### External
- `express` — Augmented in `express.d.ts`
- `jsonwebtoken` — Extended in `jsonwebtoken.d.ts`

<!-- MANUAL: -->
