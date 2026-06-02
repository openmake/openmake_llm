-- ============================================================
-- 036_seed_karpathy_skill.sql — karpathy-guidelines 스킬 전역(__global__) 등록
-- ============================================================
-- 출처: https://github.com/multica-ai/andrej-karpathy-skills (MIT)
-- 목적: Andrej Karpathy 행동 지침 스킬을 skill_manifests v1.0.0 으로 등록하고
--       __global__ 할당 → 모든 사용자의 Agent Task(buildManifestPrompt)에 지식 주입.
-- 3 테이블 INSERT (agent_skill_assignments.skill_id 는 agent_skills(id) FK 이므로 순서 중요):
--   1) agent_skills            — FK 충족 + legacy buildSkillPrompt 경로 보너스
--   2) skill_manifests v1.0.0  — Agent Task 가 조회 (checksum = sha256(prompt_md), 022 선례)
--   3) agent_skill_assignments — agent_id='__global__' 전역 할당
-- 멱등: 각 INSERT ON CONFLICT DO NOTHING. 롤백: 036_seed_karpathy_skill_rollback.sql
-- 도구 결합 없음(순수 행동지침) → skill_tool_bindings 미생성.
-- ============================================================

-- 1) agent_skills — agent_skill_assignments FK(→agent_skills.id) 충족 + legacy 채팅 경로
INSERT INTO agent_skills (id, name, description, content, category, is_public, created_by, status, source_repo, source_path)
VALUES (
    'system-skill-karpathy-guidelines',
    $kname$karpathy-guidelines$kname$,
    $kdesc$Behavioral guidelines to reduce common LLM coding mistakes. Use when writing, reviewing, or refactoring code to avoid overcomplication, make surgical changes, surface assumptions, and define verifiable success criteria.$kdesc$,
    $kmd$
# Karpathy Guidelines

Behavioral guidelines to reduce common LLM coding mistakes, derived from [Andrej Karpathy's observations](https://x.com/karpathy/status/2015883857489522876) on LLM coding pitfalls.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
$kmd$,
    'engineering',
    TRUE,
    NULL,
    'active',
    'https://github.com/multica-ai/andrej-karpathy-skills',
    'skills/karpathy-guidelines/SKILL.md'
)
ON CONFLICT (id) DO NOTHING;

-- 2) skill_manifests v1.0.0 — Agent Task 의 buildManifestPrompt 조회 대상
INSERT INTO skill_manifests (id, version, manifest_yaml, prompt_md, checksum, created_by, is_public, created_at)
VALUES (
    'system-skill-karpathy-guidelines',
    '1.0.0',
    $kyaml$---
name: karpathy-guidelines
description: Behavioral guidelines to reduce common LLM coding mistakes. Use when writing, reviewing, or refactoring code to avoid overcomplication, make surgical changes, surface assumptions, and define verifiable success criteria.
category: engineering
version: 1.0.0
is_public: true
license: MIT
source_repo: https://github.com/multica-ai/andrej-karpathy-skills
source_path: skills/karpathy-guidelines/SKILL.md
---
$kyaml$,
    $kmd$
# Karpathy Guidelines

Behavioral guidelines to reduce common LLM coding mistakes, derived from [Andrej Karpathy's observations](https://x.com/karpathy/status/2015883857489522876) on LLM coding pitfalls.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
$kmd$,
    encode(sha256($kmd$
# Karpathy Guidelines

Behavioral guidelines to reduce common LLM coding mistakes, derived from [Andrej Karpathy's observations](https://x.com/karpathy/status/2015883857489522876) on LLM coding pitfalls.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
$kmd$::bytea), 'hex'),
    NULL,
    TRUE,
    NOW()
)
ON CONFLICT (id, version) DO NOTHING;

-- 3) 전역 할당 — __global__ → 모든 사용자 Agent Task 에 주입
INSERT INTO agent_skill_assignments (agent_id, skill_id, priority, created_at)
VALUES ('__global__', 'system-skill-karpathy-guidelines', 50, NOW())
ON CONFLICT (agent_id, skill_id) DO NOTHING;
