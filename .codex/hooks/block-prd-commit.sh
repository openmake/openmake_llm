#!/bin/bash
# Block git add/commit/push attempts that include openmake_prd.md.
# Rationale: memory feedback_no_commit_files.md — file is local-only, never committed.
# Writing/editing the file is allowed; only version-control operations are blocked.
set -euo pipefail

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')

# Fast path: command doesn't mention prd at all
if ! printf '%s' "$cmd" | grep -qiE 'openmake_prd\.md|openmake_prd'; then
  # Also catch blanket commands that would sweep everything: git add -A / -a / . / *
  if printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+(add|commit)[[:space:]]+(-A\b|-a\b|--all\b|\.\s|\*\s|\.$|\*$)'; then
    # Only block if the prd file actually exists untracked/modified in the repo
    if git -C "${CLAUDE_PROJECT_DIR:-/Volumes/MAC_APP/openmake_llm}" ls-files --others --exclude-standard 2>/dev/null | grep -q '^openmake_prd\.md$' \
       || git -C "${CLAUDE_PROJECT_DIR:-/Volumes/MAC_APP/openmake_llm}" diff --name-only 2>/dev/null | grep -q '^openmake_prd\.md$'; then
      cat >&2 <<'EOF'
BLOCKED: openmake_prd.md가 존재하는 상태에서 blanket git add/commit (-A / -a / . / *)는 금지.

이유: openmake_prd.md는 절대 커밋/푸시하지 않는 로컬 전용 파일입니다 (memory feedback_no_commit_files.md).
해결: 개별 파일을 명시적으로 스테이징하세요. 예: git add <특정 파일>
EOF
      exit 2
    fi
  fi
  exit 0
fi

# Direct mention of prd file in git add/commit/push
if printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+(add|commit|push|stash)\b'; then
  cat >&2 <<'EOF'
BLOCKED: openmake_prd.md는 커밋/푸시/stash 금지 파일입니다 (memory feedback_no_commit_files.md).

파일 편집 자체는 허용되지만 version control 작업은 차단됩니다.
사용자가 직접 처리하도록 하거나 다른 파일만 대상으로 재시도하세요.
EOF
  exit 2
fi

exit 0
