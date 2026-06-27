<h1 align="center">OpenMake LLM</h1>

<p align="center">
  <strong>A self-hosted, multi-model AI assistant platform — vLLM/LiteLLM local inference with autonomous agents, MCP tools, and deep research.</strong>
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

## Table of Contents

1. [Introduction](#introduction)
2. [Features](#features)
3. [Tech Stack](#tech-stack)
4. [Installation & Usage](#installation--usage)
5. [Project Structure](#project-structure)
6. [Contributing](#contributing)
7. [License](#license)

---

## Introduction

**OpenMake LLM** is a self-hosted AI assistant platform with multi-model orchestration that you run on your own hardware. Instead of relying solely on a third-party API, it serves a local model through **vLLM** behind a **LiteLLM proxy** that exposes an OpenAI-compatible endpoint, and routes the same abstraction to external providers (Anthropic, OpenAI-compatible) when you want them.

A lightweight, deterministic routing layer (**`ExecutionPlanBuilder`** — regex + fast-path classification) maps each query onto one of **7 brand model profiles** (Default, Pro, Fast, Think, Code, Vision, Auto), so the right model and options are selected per request without an extra LLM round-trip.

On top of chat, OpenMake LLM ships autonomous **agent tasks** that run in isolated, persistent Docker sandboxes with human-in-the-loop approval, a **deep research** pipeline, a **Model Context Protocol (MCP)** tool system, and an artifact runtime — all behind JWT auth with Google OAuth and role-based access control.

> Designed to run on a single host: the application is deployed with **PM2**, while stateful dependencies (PostgreSQL/Redis) and sandboxed MCP/agent processes run in **Docker** for isolation.

## Features

- 🧠 **Multi-model orchestration** — 7 brand profiles routed by an `ExecutionPlanBuilder` policy layer; switch model, response style (Concise/Default/Verbose), and modes from the chat composer.
- 🏠 **Self-hosted inference** — vLLM + LiteLLM (OpenAI-compatible), default model `qwen3.6-35b-a3b`, with a context-fit safety net that protects output tokens and degrades gracefully on overflow.
- 🔌 **External providers** — bring your own Anthropic or OpenAI-compatible keys (AES-256-GCM encrypted at rest) through the same provider abstraction.
- 🤖 **Autonomous agent tasks** — a Manus-style agent works toward a goal across multiple tool-calling turns inside a **persistent Docker sandbox** (shell, Python, browser, file, planning tools) gated by HITL approval. Produces deliverables including **Excel (.xlsx)** and **PDF** (with CJK/Korean font support).
- 🔭 **Deep research** — multi-step, fan-out web search → source fetch → claim verification → cited synthesis.
- 🛠️ **MCP tool system** — built-in tools plus sandboxed external MCP servers, isolated per-server with Docker (`--cap-drop ALL`, non-root, network policy, no host mount).
- 🧩 **Custom agents & skills** — define project-scoped agents (custom system prompts) and a skill library that can be auto-selected per query.
- 💾 **Cross-conversation memory & custom instructions** — persistent user memory and always-on instructions prepended to the system prompt.
- 🎨 **Artifacts** — live sandboxed iframe rendering, optional Docker-based code execution, and a separate-origin strict-CSP shared viewer.
- 🔐 **Security** — JWT access tokens in HttpOnly cookies, Google OAuth 2.0, RBAC, per-route rate limiting, SSRF guard, Helmet headers, and a unified Audit ↔ Alert pipeline.

## Tech Stack

| Layer | Technologies |
|---|---|
| **Backend** | Node.js (≥24), Express 5, TypeScript (strict, CommonJS), Zod, Winston |
| **Frontend** | Next.js 16, React 19, Zustand 5, Tailwind CSS 4, TypeScript 5 |
| **Database** | PostgreSQL via `pg` Pool — raw, parameterized SQL (no ORM) |
| **Realtime** | WebSocket (`ws`) for streaming chat |
| **LLM backend** | vLLM serve + LiteLLM proxy (OpenAI-compatible); `@anthropic-ai/sdk`, `openai` for external providers |
| **Tools / Agents** | Model Context Protocol (`@modelcontextprotocol/sdk`), Docker-isolated sandboxes |
| **Auth / Security** | `jsonwebtoken` (JWT), Google OAuth 2.0, Helmet, AES-256-GCM key encryption |
| **Infra** | PM2 (app), Docker (PostgreSQL/Redis + MCP/agent sandboxes) |
| **Testing / CI** | Jest (ts-jest), Playwright (chromium + webkit), ESLint, GitHub Actions |

> **Architecture note:** the chat pipeline is a two-layer (policy ↔ execution) design — `ExecutionPlanBuilder.build` (policy, once per request) → strategy dispatch → `LLMClient.chat` (execution, per call). Treat them like a SQL planner/executor and keep them separate.

## Installation & Usage

### Prerequisites

- **Node.js** `>=24 <25`
- **PostgreSQL** (run via Docker; see below)
- An OpenAI-compatible LLM endpoint — either a local **vLLM + LiteLLM** stack or an external provider key

### 1. Clone & install

```bash
git clone https://github.com/openmake/openmake_llm.git
cd openmake_llm
npm install            # installs all npm workspaces
```

### 2. Configure environment

```bash
cp .env.example .env
```

Key variables (see `.env.example` for the full list):

| Variable | Purpose |
|---|---|
| `PORT` | API server port (default `52416`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | JWT signing secret |
| `TOKEN_ENCRYPTION_KEY` | AES-256-GCM key for external provider credentials |
| `LLM_BASE_URL` | LiteLLM proxy endpoint (e.g. `http://localhost:4000`) |
| `LLM_API_KEY` | LiteLLM master key |
| `LLM_DEFAULT_MODEL` | Default model id (e.g. `qwen3.6-35b-a3b`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |

### 3. Start PostgreSQL (Docker)

The application schema is auto-generated on first launch — no manual migration step is required to boot.

```bash
docker compose up -d postgres
```

### 4. Develop

```bash
npm run dev                 # API + frontend concurrently
# or individually:
npm run dev:api             # backend (ts-node)
npm run dev:frontend-next   # frontend (next dev)
```

### 5. Build & run (production)

```bash
npm run build               # backend + frontend
npm start                   # node apps/api/dist/server.js
```

### Testing & linting

```bash
npm test                    # Jest unit tests (apps/api)
npx jest path/to/file.test.ts
npm run test:e2e            # Playwright (chromium + webkit)
npm run lint                # ESLint
```

### Database migrations

Files in `db/migrations/` are **not** auto-applied on boot — apply them manually with the CLI:

```bash
npx ts-node apps/api/src/data/migrations/cli.ts status    # show pending
npx ts-node apps/api/src/data/migrations/cli.ts migrate   # apply
```

## Project Structure

```
openmake_llm/
├── apps/
│   ├── api/          # Express 5 + TypeScript API server (CommonJS, ES2022, strict)
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
│   └── legacy-web/   # Static asset host (e.g. /generated images) — legacy SPA retired
├── db/               # init schema + migrations
├── packages/         # shared-types, config, api-client (shared workspaces)
├── infra/            # Dockerfiles (mcp-runtime, task-runtime, …)
├── scripts/          # build, deploy, migration, CI scripts
└── tests/            # Playwright E2E
```

## Contributing

Contributions are welcome! Please follow these conventions:

- **Commits** — [Conventional Commits](https://www.conventionalcommits.org/): `feat`, `fix`, `refactor`, `docs`, `test`, `chore` (e.g. `feat(chat): add style cycle button`).
- **Branching** — work on a feature/fix branch and open a PR against `main`.
- **PR checklist:**
  - [ ] `npm run lint` passes
  - [ ] `npm test` (backend unit tests) passes
  - [ ] DB schema changes include a migration file (no sequence-number conflicts)
  - [ ] New env vars documented in `.env.example`
  - [ ] UI changes include screenshots
  - [ ] Security-relevant changes describe their impact
- **Code conventions** — TypeScript strict mode; validate input with Zod; log via Winston (`createLogger('Module')`); database access is **raw parameterized SQL only** (no ORM / query builder); externalize configuration (no hardcoded models, magic numbers, or inline prompts).

CI runs a single **CI Gate** (Test → Build → Size → Lint) on every push and pull request.

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
