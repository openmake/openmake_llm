---
name: context-state-tracker
description: State persistence across coding sessions. Use when saving progress, loading context from previous sessions, managing feature/task lists, tracking work history, or restoring session state for seamless continuation.
---

# Context State Tracker

Persist and restore state across coding sessions using structured artifacts for seamless work continuation.

## State Artifacts

### 1. Progress File (`Codex-progress.md`)

Human-readable session log stored at project root or `.Codex/` directory.

```markdown
# Session Progress

## Session N - YYYY-MM-DD HH:MM

### Accomplishments
- Implemented [feature/fix] in [file]
- Added [test/validation] for [component]
- Refactored [module] to [improvement]

### Blockers
- [Blocker description] - [status: investigating/waiting/resolved]

### Next Steps
- [Specific actionable task]
- [Specific actionable task]

### Key Decisions
- [Decision]: [Rationale]
```

### 2. Task Tracking File (`Codex-tasks.json`)

Machine-readable task state:

```json
[
  {
    "id": "task-001",
    "category": "feature",
    "description": "Add JWT refresh token rotation",
    "status": "completed",
    "files_modified": ["backend/api/src/auth/middleware.ts"],
    "completed_at": "2025-02-13T10:00:00Z"
  },
  {
    "id": "task-002",
    "category": "bugfix",
    "description": "Fix WebSocket reconnection on token expiry",
    "status": "in_progress",
    "files_modified": ["frontend/web/public/js/modules/websocket.js"],
    "blockers": ["Need to test with expired tokens"]
  }
]
```

### 3. Git History

Use git log for granular rollback and context restoration:
```bash
git log --oneline -20    # Recent commits
git diff HEAD~3..HEAD    # Changes in last 3 commits
git stash list           # Stashed work
```

## Session Workflow

### Session Start (Context Restoration)

1. **Read progress file** (if exists):
   ```
   Read .Codex/Codex-progress.md
   ```

2. **Check task state** (if exists):
   ```
   Read .Codex/Codex-tasks.json
   ```

3. **Get recent git history**:
   ```bash
   git log --oneline -10
   git status
   git stash list
   ```

4. **Determine session type**:

   | Signal | Session Type | Action |
   |--------|-------------|--------|
   | No progress file | INIT | Full exploration, create state files |
   | Progress file exists, tasks pending | CONTINUE | Resume from last session |
   | All tasks completed | NEW_WORK | Review, then plan new tasks |

### During Session (State Updates)

**After each significant accomplishment**:
1. Update progress file with accomplishment
2. Update task status in tasks.json
3. Commit changes with descriptive message

**When encountering blockers**:
1. Document blocker in progress file
2. Update task with blocker info
3. Move to next available task if blocked

### Session End (State Preservation)

1. **Update progress file**:
   - List all accomplishments
   - Document any blockers
   - Write concrete next steps
   - Record key decisions made

2. **Update task tracking**:
   - Mark completed tasks
   - Update in-progress task state
   - Add any new tasks discovered

3. **Commit all changes**:
   ```bash
   git add -A
   git commit -m "Session N: [summary of work done]"
   ```

## State Integrity Rules

| Rule | Rationale |
|------|-----------|
| Never delete completed tasks | History is valuable for context |
| Tasks only transition forward | `pending -> in_progress -> completed` |
| Always include file paths | Enables quick context loading in next session |
| Blockers must have status | Prevents stale blocker accumulation |
| Next steps must be specific | "Fix the bug" bad, "Fix null check in auth.ts:42" good |

## Quick Start for This Project

### First Session (Initialize)
```bash
# Create state directory
mkdir -p .Codex/state

# After doing work, save progress
# Write to .Codex/Codex-progress.md
# Write to .Codex/Codex-tasks.json
```

### Subsequent Sessions (Resume)
```
1. Read .Codex/Codex-progress.md (what was done, what's next)
2. Read .Codex/Codex-tasks.json (task statuses)
3. git log --oneline -5 (verify state matches commits)
4. Resume from "Next Steps" section
```

## Integration

| Skill | Integration Point |
|-------|-------------------|
| `context-compactor` | Uses state artifacts during compaction to preserve critical state |
| `context-engineering` | State files designed for minimal token usage |
| `memory-manager` | Long-term learnings extracted from session progress |
