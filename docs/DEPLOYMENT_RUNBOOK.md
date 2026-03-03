# OpenMake LLM — Deployment Runbook

## Prerequisites

- Node.js >= 18
- PostgreSQL >= 14 with pgvector extension
- Ollama (local or cloud)
- Bun (for test runner)

## Environment Setup

1. Clone repository
2. Copy `.env.example` to `.env`
3. Configure required variables:
   - `DATABASE_URL` — PostgreSQL connection string
   - `JWT_SECRET` — generate with `openssl rand -hex 32`
   - `OLLAMA_BASE_URL` — Ollama server URL
   - `OLLAMA_API_KEY_1` — First API key (add `_2`, `_3`, etc. for pool rotation)

## Database Setup

```bash
createdb openmake_llm
```

Schema auto-creates on first launch. Migrations run automatically:

| Migration | Purpose |
|-----------|---------|
| `002-schema.sql` | Base schema (users, sessions, messages, agents, etc.) |
| `002_vector_type_migration.sql` | TEXT → vector(768) column fix, pgvector mandatory |
| `003_hybrid_search_fts.sql` | tsvector column + GIN index + auto-update trigger for FTS |
| `004_hnsw_index.sql` | Replace IVFFlat with HNSW (m=16, ef_construction=64) |
| `005_kb_nm_schema.sql` | Knowledge Base N:M schema (kb, kb_documents join table) |

### pgvector Requirement

pgvector extension **must** be installed in PostgreSQL:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## Build & Deploy

```bash
npm install
npm run build
node backend/api/dist/cli.js cluster --port 52416
```

### Development Mode

```bash
npm run dev
```

## Verification Checklist

After deployment, verify each item:

- [ ] `npm run build` — exit code 0
- [ ] `npm run lint` — 0 errors (warnings are acceptable)
- [ ] `GET /api/health` — returns `{ "status": "ok" }`
- [ ] `GET /api/status` — returns `{ "status": "ok" }`
- [ ] `GET /api/v1/models` — returns OpenAI-format model list
- [ ] `POST /api/v1/chat/completions` — returns chat completion (requires API key)
- [ ] WebSocket connection at `ws://host:port` — handshake succeeds
- [ ] `GET /api-docs` — Swagger UI loads
- [ ] `GET /api/openapi.json` — OpenAPI spec returns JSON

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (e.g., `postgres://user:pass@localhost:5432/openmake_llm`) |
| `JWT_SECRET` | JWT signing secret (min 32 hex chars) |
| `OLLAMA_BASE_URL` | Ollama API base URL (e.g., `http://localhost:11434`) |
| `PORT` | Server port (default: `52416`) |

### Ollama & LLM

| Variable | Description | Default |
|----------|-------------|---------|
| `OLLAMA_API_KEY_1` ... `_N` | API key pool (round-robin rotation) | — |
| `OMK_ENGINE_LLM` | Default model engine | — |
| `OMK_ENGINE_PRO` | Pro model engine | — |
| `OMK_ENGINE_FAST` | Fast model engine | — |
| `OMK_ENGINE_THINK` | Thinking model engine | — |
| `OMK_ENGINE_CODE` | Code model engine | — |

### Observability (OpenTelemetry)

| Variable | Description | Default |
|----------|-------------|---------|
| `OTEL_ENABLED` | Enable OpenTelemetry tracing | `true` |
| `OTEL_SAMPLE_RATE` | Trace sampling rate (0.0-1.0) | `0.1` |
| `OTEL_EXPORT_CONSOLE` | Export traces to stdout | `false` |
| `OTEL_OTLP_ENDPOINT` | OTLP collector endpoint URL | (disabled) |

### Optional Services

| Variable | Description | Default |
|----------|-------------|---------|
| `FIRECRAWL_API_KEY` | Firecrawl scraping API key | (disabled) |
| `GOOGLE_API_KEY` | Google Custom Search API key | (disabled) |
| `GOOGLE_CSE_ID` | Google Custom Search Engine ID | (disabled) |
| `LOG_LEVEL` | Winston log level | `info` |

## API Endpoints (Key)

### Internal (Session Auth)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/chat` | Chat (non-streaming) |
| POST | `/api/chat/stream` | Chat (SSE streaming) |
| POST | `/api/rag/search` | RAG hybrid search |
| GET/POST | `/api/kb` | Knowledge Base CRUD |

### External (API Key Auth — `/api/v1/*`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/models` | List models (OpenAI format) |
| POST | `/api/v1/chat/completions` | Chat completions (OpenAI-compatible) |
| GET | `/api/v1/usage` | API key usage summary |
| GET | `/api/v1/usage/daily` | API key daily usage |

## Monitoring

| Resource | Location |
|----------|----------|
| Application logs | `backend/api/logs/combined.log` |
| Error logs | `backend/api/logs/error.log` |
| Health check | `GET /api/health` |
| System status | `GET /api/status` |
| Metrics | `GET /api/metrics` |
| Swagger docs | `GET /api-docs` |
| OpenAPI spec | `GET /api/openapi.json` |

## Security Features

- SSRF defense (`ssrf-guard.ts`) — blocks internal IP ranges in outbound requests
- BOLA prevention (`auth/ownership.ts`) — resource ownership verification
- API Key rate limiting — RPM + TPM per-key limits
- WebSocket rate limiting — per-message and per-connection throttling
- JWT HttpOnly cookies — secure token storage
- Input sanitization — XSS prevention on all user inputs

## Rollback

```bash
git checkout <previous-tag>
npm install
npm run build
# Restart the server process
```

## Hardware Reference (Test Environment)

- Mac mini (M4), 10 cores, 16 GB RAM
- PostgreSQL 16
- Ollama with nomic-embed-text, qwen3.5:397b-cloud, glm-5:cloud, gpt-oss:120b-cloud, gemini-3-flash-preview:cloud
