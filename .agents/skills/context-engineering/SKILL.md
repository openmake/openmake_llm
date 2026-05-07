---
name: context-engineering
description: Optimize Codex/OpenCode context usage through monitoring, reduction strategies, progressive disclosure, planning/execution separation, and file-based optimization. Use when managing token costs, optimizing context usage, preventing context overflow, or improving multi-turn conversation quality.
---

# Context Engineering

Systematic strategies for optimizing context window usage. Monitor token consumption, reduce context load, design context-efficient skills, and apply proven optimization patterns.

**Key Benefits**:
- **29-39% performance improvement** with context editing strategies
- **95% token savings** using file-based approaches for large data
- **70-80% token reduction** with progressive disclosure
- **Sustained quality** in multi-turn conversations

**Context Window**: 200k tokens (standard). Auto-compaction triggers at ~80% (~160k).

## 5 Core Operations

### 1. Monitor Context Usage

Track token consumption and identify optimization opportunities.

**When**: Start of optimization, periodically during long sessions, approaching limits (>60-70%).

**Process**:
1. Check current context usage (tokens + percentage)
2. Identify heavy consumers:
   - Large files loaded (>5,000 tokens each)
   - Extensive conversation history
   - Many tool call results
   - Large AGENTS.md/AGENTS.md files
3. Document baseline and set reduction targets

**Example Analysis**:
```
Current: 145,000 tokens (72%)
Heavy Consumers:
  AGENTS.md: 25,000 tokens (17%)
  Large skill files: 40,000 tokens (28%)
  Conversation history: 30,000 tokens (21%)
  Tool call results: 20,000 tokens (14%)
Target: ~100,000 tokens (50%, 31% reduction)
```

### 2. Reduce Context Load

Remove stale content and minimize loaded files.

**When**: Context >70%, performance degradation, before major operations.

**Actions**:
| Action | Token Savings |
|--------|--------------|
| Clear stale tool results | -15,000 typical |
| Unload unused files | -10,000-20,000 |
| Optimize AGENTS.md (<5k tokens) | Variable |
| Progressive loading of references | -25,000 |

**Key Rules**:
- Only load files actively needed for current task
- Use Grep instead of Read for searching (doesn't load full file)
- Use Glob for finding files (doesn't load content)
- Load specific sections, not entire files
- Delegate exploration to background agents (separate context)

### 3. Optimize Skill Design (Progressive Disclosure)

Design context-efficient skills with lazy loading.

**Pattern**:
```
skill/
  SKILL.md          # Overview + essentials only (<1,200 lines, ~3-5k tokens)
  references/       # Detailed guides loaded on-demand (300-600 lines each)
  scripts/          # Automation loaded when needed
```

**Token Budget**:

| Complexity | Total | Typical Load | Savings |
|------------|-------|-------------|---------|
| Simple | 5-10k | 3-4k (SKILL.md only) | 40-60% |
| Medium | 15-30k | 4-6k (SKILL.md + 1 ref) | 60-80% |
| Complex | 40-60k | 6-10k (SKILL.md + 2 refs) | 75-85% |

**Efficient Formats** (higher information density):
- Tables > prose
- Lists > paragraphs
- Code blocks for examples
- Quick Reference sections

### 4. Separate Planning from Execution

Keep execution context clean by splitting sessions.

**Planning Phase** (exploratory, broad, high context):
- Codebase exploration, research, architecture decisions
- Output: Plan documents, task lists, decisions

**Execution Phase** (focused, clean context):
- Load only plan docs + immediate dependencies
- Follow plan, don't re-explore
- Load files as needed, unload when done

**Impact**: 80% context reduction (150k planning -> 30k execution)

**When to Split**: Planning >30 min, complex implementation, cluttered context.

### 5. File-Based Optimization

Externalize large data to files for on-demand analysis.

**When**: Data >5,000 tokens (>10,000 characters).

**Process**:
```bash
# Save large output to temp file
command > /tmp/analysis-data.json

# Reference in conversation (not content)
"Dataset saved to /tmp/analysis-data.json (50k tokens) - load on-demand"
```

**Token Impact**: 50,000 tokens -> ~500 tokens (95% reduction, data still accessible).

**Best For**: Logs, large MCP responses, generated reports, test outputs, build outputs.

## Context Usage Guidelines

| Usage % | Status | Action |
|---------|--------|--------|
| <50% | Healthy | Normal operation |
| 50-70% | Monitor | Check periodically, plan optimization |
| 70-80% | Optimize | Reduce context load actively |
| >80% | Critical | Immediate optimization (auto-compact triggers) |

## Decision Tree

```
Is context >70%?
  Yes -> Reduce immediately (Op 2)
    Clear stale tool results
    Unload unnecessary files  
    Consider fresh session
  No -> Preventive optimization
    Data >5k tokens? -> File-based (Op 5)
    Building skills? -> Progressive disclosure (Op 3)
    Long session? -> Plan/Execute split (Op 4)
```

## Tool Selection for Context Efficiency

| Task | Efficient Tool | Avoid |
|------|---------------|-------|
| Find files | Glob | `find` via Bash (more output) |
| Search content | Grep | Read entire file then search |
| Read specific section | Read with offset/limit | Read entire file |
| Explore codebase | Background explore agent | Loading all files yourself |
| External docs | Background librarian agent | Fetching pages into context |

## Token Estimation

- 1 line of code/text: ~3-4 tokens average
- 1,000 lines: ~3,000-4,000 tokens
- Tables/lists: ~2-2.5 tokens/line (more efficient)
- Dense prose: ~3-3.5 tokens/line

## Common Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| Loading everything upfront | Context fills fast | Progressive disclosure |
| Not monitoring context | Unexpected overflow | Check every 30-60 min |
| Large monolithic AGENTS.md | 20-50k tokens per session | Split, keep <5k |
| Keeping stale tool results | Context bloat | Fresh session for transitions |
| Large data in conversation | 30-50% context wasted | Externalize to /tmp/ |
