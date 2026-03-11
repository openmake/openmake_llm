<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# schemas — Zod Validation Schemas

## Purpose
Centralizes all Zod schemas used for validating HTTP request bodies. Each file groups schemas by domain: chat requests, auth payloads, security settings, document upload metadata, memory operations, and research requests. Schemas are imported by route files and passed to the `validate()` middleware factory in `middlewares/validation.ts`. Keeping schemas separate from routes ensures they can be reused across routes and tested independently.

## Key Files
| File | Description |
|------|-------------|
| `chat.schema.ts` | Chat message request body: `message`, `sessionId`, `model`, `enabledTools`, language |
| `auth.schema.ts` | Login, registration, token refresh, password change request bodies |
| `security.schema.ts` | Security settings update schemas |
| `documents.schema.ts` | Document upload metadata: title, tags, knowledge base assignment |
| `memory.schema.ts` | Memory entry create/update/delete schemas |
| `research.schema.ts` | Deep research session creation parameters |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- Export both the schema and the inferred TypeScript type: `export const chatSchema = z.object({...}); export type ChatRequest = z.infer<typeof chatSchema>`
- Use `.strict()` on object schemas to reject unknown fields and prevent parameter pollution
- Required fields must not have defaults; optional fields should use `.optional()` or `.default()`
- When a field has a restricted set of values, use `z.enum([...])` not `z.string()`

### Testing Requirements
- Test each schema with valid input (should pass), missing required fields (should fail), and extra fields (should fail with `.strict()`)
- Run `npm run test:bun`

### Common Patterns
- Import and use: `import { chatSchema } from '@/schemas/chat.schema'; router.post('/', validate(chatSchema), handler)`
- Nested objects: use `z.object({}).strict()` at every nesting level
- Array fields: use `z.array(z.string()).min(1).max(10)` with explicit bounds

## Dependencies
### Internal
- `middlewares/validation.ts` — Consumes schemas via `validate(schema)` factory
- `controllers/` and `routes/` — Import schemas for use with `validate()`

### External
- `zod` — Schema definition and type inference

<!-- MANUAL: -->
