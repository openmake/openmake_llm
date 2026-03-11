<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# swagger — OpenAPI 3.0 Path Definitions

## Purpose
Contains OpenAPI 3.0 path definition objects that are assembled by `src/swagger.ts` into a complete API specification served via Swagger UI. Each file covers a domain group of endpoints. These definitions serve as the machine-readable API contract for external integrations and are displayed in the interactive Swagger UI mounted at `/api/docs`.

## Key Files
| File | Description |
|------|-------------|
| `paths-chat.ts` | OpenAPI path definitions for chat, session, and streaming endpoints |
| `paths-platform.ts` | OpenAPI path definitions for auth, admin, health, and platform endpoints |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- Keep path definitions in sync with actual route implementations in `routes/` — mismatches mislead API consumers
- When adding a new route, add the corresponding path definition here in the same PR
- Use `$ref` to reference shared schema components rather than inline duplication
- Response examples in path definitions must match real response shapes

### Testing Requirements
- Validate the assembled spec against OpenAPI 3.0 schema (automated in CI if configured)
- Manually verify Swagger UI renders correctly after changes: `GET /api/docs`

### Common Patterns
- Path object: `'/api/chat': { post: { summary: '...', requestBody: {...}, responses: {...} } }`
- Reuse components: `{ $ref: '#/components/schemas/ChatRequest' }`
- Security requirement: `{ security: [{ cookieAuth: [] }] }` for authenticated endpoints

## Dependencies
### Internal
- `src/swagger.ts` — Assembles and serves the complete spec
- `routes/` — Actual implementations that definitions must match

### External
- `swagger-ui-express` — Swagger UI mounting (in `swagger.ts`)
- `swagger-jsdoc` or manual assembly (check `swagger.ts` for approach used)

<!-- MANUAL: -->
