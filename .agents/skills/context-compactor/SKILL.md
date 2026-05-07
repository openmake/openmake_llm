---
name: context-compactor
description: Automatic context summarization for long-running sessions. Use when context is approaching limits, summarizing completed work, preserving critical information, managing token budgets, or preparing session handoffs.
---

# Context Compactor

Automatically summarize and compact context when approaching token limits while preserving critical information.

## Preservation Priority

### MUST Preserve (Never remove)
- Architectural decisions made in this session
- Unresolved bugs and active blockers
- Current feature/task state and progress
- Recent file changes (last 5 modified files)
- Error patterns and their solutions
- Active TODO items

### CAN Summarize (Compress to brief summary)
- Completed features (list of IDs/names only)
- Resolved errors (brief mention)
- Historical decisions (key points only)
- Exploration results already acted upon

### CAN Discard (Remove entirely)
- Redundant tool outputs (same file read multiple times)
- Stale search results from earlier exploration
- Superseded messages (earlier versions of updated plans)
- Verbose logging and debug output
- Tool call results older than current task scope

## Compaction Triggers

| Context Usage | Status | Action |
|--------------|--------|--------|
| < 50% | Normal | No action needed |
| 50-75% | Warning | Prepare compaction plan |
| 75-85% | Compact | Execute compaction immediately |
| > 85% | Critical | Aggressive compaction + prepare handoff |
| > 90% | Emergency | Force handoff to new session |

## Compaction Process

### Step 1: Score Importance (each context item)

| Score | Category | Examples |
|-------|----------|---------|
| 10 | Critical | Active blockers, current task state, unresolved errors |
| 8 | High | Architecture decisions, recent file changes, TODO items |
| 5 | Medium | Completed work summaries, resolved issues |
| 3 | Low | Old exploration results, superseded plans |
| 1 | Disposable | Redundant reads, stale searches, verbose logs |

### Step 2: Create Compact Summary

```markdown
## Session Compact Summary

### Current State
- Working on: [current task]
- Progress: [X/Y tasks complete]
- Active files: [list of files being modified]

### Key Decisions
- [Decision 1]: [rationale]
- [Decision 2]: [rationale]

### Completed Work
- [Feature/task 1] - done
- [Feature/task 2] - done

### Active Blockers
- [Blocker 1]: [status]

### Next Steps
1. [Immediate next action]
2. [Following action]
```

### Step 3: Externalize Large Data

For any retained data >2,000 tokens:
```bash
# Save to temp file
echo "$large_data" > /tmp/session-context-$(date +%s).md

# Reference in compact summary
"Full exploration results: /tmp/session-context-1234567890.md"
```

### Step 4: Validate Coherence

After compaction, verify:
- [ ] Current task state is clear and actionable
- [ ] All active blockers are documented
- [ ] Key decisions are preserved with rationale
- [ ] Next steps are concrete and ordered
- [ ] No critical information was lost

## Handoff Summary Format

When context is >90% and session transition is needed:

```markdown
# Session Handoff

## Mission
[What we're trying to accomplish]

## Current State
- Branch: [git branch]
- Last commit: [hash + message]
- Modified files: [list]
- Build status: [pass/fail]
- Test status: [pass/fail + details]

## What Was Done
1. [Completed item with brief description]
2. [Completed item with brief description]

## What Remains
1. [TODO item - specific and actionable]
2. [TODO item - specific and actionable]

## Key Context
- [Important decision/finding that new session needs]
- [Pattern/convention discovered]
- [Gotcha or pitfall to avoid]

## Files to Load First
1. [most relevant file for next task]
2. [supporting file]
```

## Integration with Other Skills

| Skill | How They Work Together |
|-------|----------------------|
| `context-engineering` | Provides monitoring data that triggers compaction |
| `context-state-tracker` | State artifacts are preserved during compaction |
| `memory-manager` | Key learnings are persisted to memory before discarding |

## Quick Reference

**Immediate Compaction** (when context >75%):
1. Identify items scored 1-3 -> discard
2. Summarize items scored 5 -> compress to one-liners
3. Keep items scored 8-10 intact
4. Externalize any large data blocks to /tmp/
5. Validate compact summary is coherent

**Emergency Handoff** (when context >90%):
1. Create handoff summary (format above)
2. Save to `/tmp/handoff-{timestamp}.md`
3. Commit any pending changes
4. Start new session with handoff doc loaded first
