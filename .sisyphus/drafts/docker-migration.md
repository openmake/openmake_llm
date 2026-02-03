# Draft: OpenMake.Ai Docker Microservices Migration

## Requirements (confirmed from user + codebase analysis)

### Source Codebase Structure (verified)
- Monorepo with npm workspaces: database, backend/api, backend/core, backend/workers, frontend/web
- Backend entry: backend/api/src/server.ts (942 LOC) - Express v5 + WebSocket
- ChatService: backend/api/src/services/ChatService.ts (942 LOC) - agent routing, MCP, streaming
- Database: database/models/unified-database.ts (1888 LOC) - SQLite via better-sqlite3
- Frontend: frontend/web/public/ - Vanilla JS SPA with 20+ HTML pages
- app.js monolith (2857 LOC) + SPA router + page modules

### Backend Route Files (18 total, 3544 LOC)
- chat.routes.ts (150), documents.routes.ts (325), agents.routes.ts (387)
- AuthRoutes.ts (534), web-search.routes.ts (110), mcp.routes.ts (146)
- memory.routes.ts (164), marketplace.routes.ts (203), canvas.routes.ts (290)
- research.routes.ts (218), external.routes.ts (273), audit.routes.ts (127)
- metrics.routes.ts (238), usage.routes.ts (47), nodes.routes.ts (53)
- agents-monitoring.routes.ts (59), token-monitoring.routes.ts (194)

### AI/LLM Layer (4397 LOC total)
- Ollama client (560) + agent-loop (432) + LLM router (207)
- Discussion engine (562) + Web search MCP (594) + Unified MCP client (237)
- Memory service (354) + Context engineering (630) + Prompt system (821)
- 115 agent prompt files in prompts/ directory
- industry-agents.json (1186 LOC) - agent definitions

### Frontend Pages (20+ HTML pages, 4016 LOC page modules)
- settings, admin, admin-metrics, agent-learning, alerts, analytics
- audit, canvas, cluster, custom-agents, external, guide, history
- marketplace, mcp-tools, memory, password-change, research, token-monitoring, usage
- Core modules: chat (356), websocket (205), auth (201), state (153), ui (288), settings (236)
- service-worker.js (327)

### CSS/Design System (7164 LOC)
- design-tokens.css (579) - CSS variables, dark theme as default
- glassmorphism.css (278) - glass-card, glass-panel effects
- animations.css (656), components.css (681), layout.css (751)
- dark-sidebar.css (199), unified-sidebar.css (572)
- style.css (2053) - main styles
- Purple-blue accent (#667eea), Outfit font, backdrop-filter blur effects

### Database Tables (verified from schema)
- users, conversation_sessions, conversation_messages
- api_usage, agent_usage_logs, agent_feedback, custom_agents
- audit_logs, alert_history
- user_memories, memory_tags (long-term memory)
- research_sessions, research_steps (deep research)
- agent_marketplace, agent_reviews, agent_installations (marketplace)
- canvas_documents, canvas_versions, canvas_ai_edits (canvas)
- external_connections, external_files (integrations)

## Target Architecture
- Container 1: PostgreSQL 16 + pgvector
- Container 2: Python 3.12 FastAPI (AI Service)
- Container 3: Go 1.22 + Gin (API Gateway)
- Container 4: Next.js 14 + React + Tailwind (Frontend)

## Technical Decisions (confirmed)
- Go API Gateway: all HTTP routing, JWT auth, WebSocket proxying
- Python AI Service: LLM chat, agent routing, doc processing, RAG, embeddings, memory
- PostgreSQL: all SQLite tables + new vector_embeddings table
- Next.js: port all 20+ pages, same glassmorphism dark theme
- Ollama: maintain existing cloud model connectivity

## Open Questions (CRITICAL - need user input)
1. Migration approach: big bang vs incremental?
2. Testing: TDD or tests-after? Existing Playwright tests reusable?
3. Ollama: runs on host or in container? How does Python service reach it?
4. WebSocket flow: Go proxies raw WS to Python, or Go handles WS + calls Python REST?
5. Next.js rendering: SSR, SSG, or CSR for each page type?
6. Auth token format: same JWT structure or redesign?
7. File uploads: which container handles document upload/processing?
8. Push notifications: keep web-push or change approach?
9. Agent prompts: copy .md files to Python as-is or convert to Python format?
10. Real-time features: which events go through WebSocket vs REST polling?

## Scope Boundaries
- INCLUDE: All 4 containers, Docker Compose, data migration, testing per container
- EXCLUDE: TBD (CI/CD? Production deployment? Monitoring stack?)
