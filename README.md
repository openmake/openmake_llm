<h1 align="center">OpenMake LLM</h1>

<p align="center">
  <strong>A self-hosted, multi-model AI assistant platform.</strong><br/>
  Private vLLM/LiteLLM inference · autonomous agents · MCP tools · deep research.
</p>

<p align="center">
  <a href="https://github.com/openmake/openmake_llm/actions/workflows/ci.yml"><img src="https://github.com/openmake/openmake_llm/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/version-1.5.6-green.svg" alt="Version" />
  <img src="https://img.shields.io/badge/node-%3E%3D24%20%3C25-brightgreen.svg" alt="Node >=24 <25" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6.svg" alt="TypeScript strict" />
  <img src="https://img.shields.io/badge/Next.js-16-black.svg" alt="Next.js 16" />
</p>

---

## Overview

**OpenMake LLM** is a self-hosted AI assistant you run on your own hardware. It serves a local model through **vLLM** behind a **LiteLLM proxy** (OpenAI-compatible) and routes the *same* abstraction to external providers (Anthropic, OpenAI-compatible) whenever you want them — so your data stays on your machine by default.

Every request flows through a lightweight, deterministic policy layer — **`ExecutionPlanBuilder`** (regex + fast-path classification) — that routes the single local model and assembles options *without* an extra LLM round-trip. Behavior is controlled by orthogonal axes only — **Model · Style · Mode toggles · Custom Agent** — instead of opaque presets. Beyond chat, it adds autonomous agents, a deep-research pipeline, and an MCP tool system — all behind JWT auth and role-based access control.

> **Single-host design:** the app runs under **PM2**, while stateful dependencies (PostgreSQL/Redis) and sandboxed agent/MCP processes run in **Docker** for isolation.

---

## Features

**▸ Models & routing**
- Single local model routed per request by the `ExecutionPlanBuilder` policy layer; behavior controlled by orthogonal axes (Model · Style · Mode · Custom Agent).
- Self-hosted vLLM + LiteLLM (default `qwen3.6-35b-a3b`) with a context-fit safety net that protects output tokens and degrades gracefully on overflow.
- Bring-your-own external keys (Anthropic / OpenAI-compatible), AES-256-GCM encrypted at rest.

**▸ Agents & research**
- **Autonomous agent tasks** — a Manus-style agent pursues a goal across multiple tool-calling turns inside a **persistent Docker sandbox** (shell, Python, browser, file, planning tools) with human-in-the-loop approval. Produces deliverables including **Excel (.xlsx)** and **PDF** (with Korean/CJK fonts).
- **Deep research** — fan-out web search → source fetch → claim verification → cited synthesis.
- **Custom agents & skills** — project-scoped agents and an auto-selectable skill library.

**▸ Tools & extensibility**
- **MCP tool system** — built-in tools plus external MCP servers, each isolated in Docker (`--cap-drop ALL`, non-root, network policy, no host mount).
- **Artifacts** — live sandboxed iframe rendering, optional Docker code execution, and a separate-origin strict-CSP shared viewer.
- **Memory & instructions** — persistent cross-conversation memory and always-on custom instructions.

**▸ Security**
- JWT in HttpOnly cookies, Google OAuth 2.0, RBAC, per-route rate limiting, SSRF guard, Helmet headers, and a unified Audit ↔ Alert pipeline.

---

## Tech Stack

| Layer | Technologies |
|---|---|
| **Backend** | Node.js (≥24), Express 5, TypeScript (strict, CommonJS), Zod, Winston |
| **Frontend** | Next.js 16, React 19, Zustand 5, Tailwind CSS 4 |
| **Database** | PostgreSQL via `pg` — raw, parameterized SQL (no ORM) |
| **Realtime** | WebSocket (`ws`) streaming chat |
| **LLM backend** | vLLM + LiteLLM (OpenAI-compatible); `@anthropic-ai/sdk`, `openai` for external providers |
| **Agents / Tools** | Model Context Protocol (`@modelcontextprotocol/sdk`), Docker-isolated sandboxes |
| **Auth / Security** | `jsonwebtoken`, Google OAuth 2.0, Helmet, AES-256-GCM |
| **Infra** | PM2 (app) + Docker (PostgreSQL/Redis, MCP & agent sandboxes) |
| **Testing / CI** | Jest (ts-jest), Playwright, ESLint, GitHub Actions |

> **Pipeline shape:** `ExecutionPlanBuilder.build` (policy, once per request) → strategy dispatch → `LLMClient.chat` (execution, per call) — a SQL planner/executor split; keep the two layers separate.

---

## Getting Started

### Prerequisites

- **Node.js** `>=24 <25`
- **PostgreSQL** (run via Docker — see below)
- An OpenAI-compatible LLM endpoint: a local **vLLM + LiteLLM** stack, or an external provider key

### Setup

```bash
# 1. Clone & install (npm workspaces)
git clone https://github.com/openmake/openmake_llm.git
cd openmake_llm
npm install

# 2. Configure environment
cp .env.example .env      # then fill in the values below

# 3. Start PostgreSQL (schema auto-generates on first launch)
docker compose up -d postgres
```

Minimum `.env` values (see `.env.example` for the full list):

| Variable | Purpose |
|---|---|
| `PORT` | API port (default `52416`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | JWT signing secret |
| `TOKEN_ENCRYPTION_KEY` | AES-256-GCM key for external provider credentials |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_DEFAULT_MODEL` | LiteLLM proxy endpoint, master key, default model |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |

### Run

```bash
# Development
npm run dev                 # API + frontend together
npm run dev:api             # backend only (ts-node)
npm run dev:frontend-next   # frontend only (next dev)

# Production
npm run build               # backend + frontend
npm start                   # node apps/api/dist/server.js
```

### Test & lint

```bash
npm test                    # Jest unit tests (apps/api)
npm run test:e2e            # Playwright (chromium + webkit)
npm run lint                # ESLint
```

### Database migrations

Files in `db/migrations/` are **not** auto-applied — run them with the CLI:

```bash
npx ts-node apps/api/src/data/migrations/cli.ts status    # show pending
npx ts-node apps/api/src/data/migrations/cli.ts migrate   # apply
```

---

## Project Structure

```
openmake_llm/
├── apps/
│   ├── api/          # Express 5 + TypeScript API server (strict, CommonJS)
│   │   └── src/
│   │       ├── routes/ controllers/ services/   # REST + business logic
│   │       ├── chat/                            # ExecutionPlanBuilder, classifiers, prompts
│   │       ├── agents/                          # industry agents, router, discussion engine
│   │       ├── llm/ providers/ cluster/         # LLM client, provider abstraction, node routing
│   │       ├── mcp/                             # MCP tool router, external client, sandboxes
│   │       ├── sockets/                         # WebSocket chat handler
│   │       ├── auth/ security/ middlewares/     # JWT/OAuth, SSRF guard, rate limiting
│   │       └── data/                            # PostgreSQL (raw SQL), migrations, repositories
│   ├── web/          # Next.js + React frontend (the operating UI)
│   └── legacy-web/   # Static asset host (e.g. /generated) — legacy SPA retired
├── db/               # init schema + migrations
├── packages/         # shared-types, config, api-client (shared workspaces)
├── infra/            # Dockerfiles (mcp-runtime, task-runtime, …)
├── scripts/          # build, deploy, migration, CI scripts
└── tests/            # Playwright E2E
```

---

## Contributing

Contributions are welcome. Please:

- Use [Conventional Commits](https://www.conventionalcommits.org/) — `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.
- Work on a feature/fix branch and open a PR against `main`.
- Follow the code conventions: TypeScript strict mode, Zod for input validation, Winston for logging, **raw parameterized SQL only** (no ORM), and externalized configuration (no hardcoded models, magic numbers, or inline prompts).

**Before opening a PR:**

- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] DB schema changes include a migration file (no sequence conflicts)
- [ ] New env vars documented in `.env.example`
- [ ] UI changes include screenshots; security changes describe their impact

CI runs a single **CI Gate** (Test → Build → Size → Lint) on every push and pull request.

---

## License

Released under the **MIT License** — see [LICENSE](LICENSE) for details.
