---
name: memory-manager
description: External persistent memory for cross-session knowledge. Use when storing error patterns and solutions, retrieving learned solutions, managing causal memory chains (error->fix), persisting project knowledge, or building institutional knowledge across sessions.
---

# Memory Manager

External persistent memory system for maintaining knowledge across coding sessions. Stores error patterns, solutions, architectural decisions, and learned patterns.

## Memory Types

### 1. Causal Memory (Error -> Solution)

The most valuable memory type. Stores cause-effect chains for self-healing.

```json
{
  "type": "causal",
  "error": "TypeError: Cannot read properties of undefined (reading 'user')",
  "context": "backend/api/src/auth/middleware.ts - JWT verification",
  "solution": "Check req.auth exists before accessing .user - token may be expired",
  "files": ["backend/api/src/auth/middleware.ts"],
  "timestamp": "2025-02-13"
}
```

**When to Store**: Every time you fix a non-trivial bug.

### 2. Procedural Memory (How-To Patterns)

Working patterns and recipes specific to this project.

```json
{
  "type": "procedural",
  "pattern": "Adding a new API route",
  "steps": [
    "Create route file in backend/api/src/routes/",
    "Add Zod schema in backend/api/src/schemas/",
    "Register route in backend/api/src/routes/index.ts",
    "Add controller in backend/api/src/controllers/",
    "Add Swagger docs annotation"
  ],
  "files": ["backend/api/src/routes/index.ts"]
}
```

**When to Store**: After completing a workflow you'll likely repeat.

### 3. Semantic Memory (Project Facts)

Factual knowledge about the project architecture.

```json
{
  "type": "semantic",
  "fact": "Database uses raw SQL via UnifiedDatabase class, NOT an ORM",
  "context": "All DB queries go through backend/api/src/data/models/unified-database.ts",
  "importance": "high"
}
```

**When to Store**: Architecture discoveries, non-obvious constraints.

### 4. Episodic Memory (Session Events)

Notable events and outcomes from past sessions.

```json
{
  "type": "episodic",
  "event": "Attempted migration from SQLite to PostgreSQL",
  "outcome": "Success - used scripts/migrate-sqlite-to-pg.py",
  "lessons": "UnifiedDatabase handles schema auto-creation on startup",
  "session": "2025-02-10"
}
```

**When to Store**: Significant events with learnable outcomes.

## Storage Structure

```
.Codex/
  memory/
    causal.json       # Error -> Solution chains
    procedural.json   # How-to patterns
    semantic.json     # Project facts
    episodic.json     # Session events
```

## Operations

### Store Memory

After fixing a bug, discovering a pattern, or learning a fact:

```bash
# Read current memory file (or create if doesn't exist)
# Append new entry
# Write back
```

**Format per file** (JSON array):
```json
[
  { "id": "mem-001", "type": "causal", "timestamp": "...", ... },
  { "id": "mem-002", "type": "causal", "timestamp": "...", ... }
]
```

### Retrieve Memory

At session start or when encountering an error:

1. **On error**: Search `causal.json` for similar error messages
2. **On new task**: Search `procedural.json` for matching workflow patterns
3. **On exploration**: Check `semantic.json` for known facts about the area
4. **On planning**: Review `episodic.json` for past similar attempts

### Query Patterns

| Scenario | Memory Type | Search Strategy |
|----------|------------|-----------------|
| Hit an error | Causal | Grep error message keywords in causal.json |
| Adding new feature | Procedural | Search pattern name in procedural.json |
| Working in unfamiliar area | Semantic | Search module/directory name in semantic.json |
| Planning large change | Episodic | Search feature/area name in episodic.json |

## Memory Lifecycle

### When to Create
- Bug fixed -> Create causal memory
- Workflow completed -> Create procedural memory (if repeatable)
- Architecture discovered -> Create semantic memory
- Session ended with notable outcome -> Create episodic memory

### When to Update
- Solution improved -> Update causal memory with better fix
- Workflow refined -> Update procedural steps
- Architecture changed -> Update semantic facts (mark old as deprecated)

### When to Prune
- Solution proven wrong -> Remove or mark as "deprecated"
- Architecture fundamentally changed -> Archive old facts
- Keep memory files under 50 entries each (prune oldest low-value entries)

## Pre-Seeded Semantic Memories for This Project

These are key facts about the OpenMake LLM project:

| Fact | Detail |
|------|--------|
| Backend framework | Express v5.2 + TypeScript 5.3 |
| Database | PostgreSQL via raw SQL (UnifiedDatabase class), NO ORM |
| Frontend | Vanilla JavaScript only - NO React/Vue/Angular |
| Auth | JWT + HttpOnly Cookie + OAuth (Google/GitHub) |
| Type safety | Strict mode: no `as any`, `@ts-ignore`, `@ts-expect-error` |
| API format | Standardized via `success()` / `error()` helpers |
| Styling | CSS Variables + Design Tokens (design-tokens.css) |
| Testing | Jest (unit) + Playwright (E2E) |
| Build | TypeScript compile + frontend deploy script |
| Workspaces | npm workspaces: backend/api, backend/workers, frontend/web |

## Integration

| Skill | Integration Point |
|-------|-------------------|
| `context-engineering` | Memory files kept small for minimal context impact |
| `context-compactor` | Key learnings extracted to memory before compaction |
| `context-state-tracker` | Session progress informs episodic memory creation |

## Quick Start

### Initialize Memory
```bash
mkdir -p .Codex/memory
echo "[]" > .Codex/memory/causal.json
echo "[]" > .Codex/memory/procedural.json
echo "[]" > .Codex/memory/semantic.json
echo "[]" > .Codex/memory/episodic.json
```

### After Fixing a Bug
```
Read .Codex/memory/causal.json
Append: { error, context, solution, files, timestamp }
Write .Codex/memory/causal.json
```

### At Session Start
```
Read .Codex/memory/semantic.json   # Project facts
Read .Codex/memory/causal.json     # Known error patterns
# Only load procedural/episodic if relevant to current task
```
