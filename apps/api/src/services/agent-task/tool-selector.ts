/**
 * Agent Task 동적 도구 서브셋팅 (Phase 2-A) — capability 회복.
 *
 * 샌드박스 활성 시 전체 MCP 카탈로그(~150 도구)를 LLM 에 넘기면 vLLM guided-decoding
 * 문법 컴파일이 수백 KB union 에서 폭주(첫 토큰 100s+ → Connection error)한다. 그래서
 * 현재는 샌드박스 도구 + 정적 extraTools 화이트리스트(2개)만 노출해 searxng/postgres/notion
 * 등 실제 통합 도구를 자율 작업에서 못 썼다.
 *
 * 이 모듈은 목표(goal)에 대한 **관련성 기반 top-K** 서브셋을 골라 예산 내에서만 합류시킨다.
 * 무-LLM·결정적(키워드 오버랩) — 추가 지연 0, 유닛테스트 가능. 관련성 0(키워드 미매칭) 도구는
 * 절대 넣지 않아(budget 채우기 금지) 문법 폭주를 재유발하지 않는다.
 *
 * ⚠️ measure-first: budget 상한은 vLLM 문법 컴파일 지연을 실측해 정한다(config 기본 보수적).
 *
 * @module services/agent-task/tool-selector
 */
import type { ToolDefinition } from '../../llm/types';

/** 목표 문자열을 매칭 토큰으로 분해 — 소문자화 + 영숫자/한글 경계 분리 + 2자 이상만. */
export function tokenizeGoal(goal: string): string[] {
    const raw = goal.toLowerCase().split(/[^a-z0-9가-힣]+/).filter(Boolean);
    // 중복 제거(같은 토큰이 점수를 이중 가산하지 않게) + 너무 짧은 토큰(1자) 제외.
    return [...new Set(raw)].filter((t) => t.length >= 2);
}

/** PURE: 단일 도구의 목표 관련성 점수. name 매칭은 description 매칭보다 가중. */
export function scoreTool(tool: ToolDefinition, tokens: string[]): number {
    const name = (tool.function.name ?? '').toLowerCase();
    const desc = (tool.function.description ?? '').toLowerCase();
    let score = 0;
    for (const tk of tokens) {
        if (name.includes(tk)) score += 3;
        else if (desc.includes(tk)) score += 1;
    }
    return score;
}

export interface SelectToolsOptions {
    /** 추가로 노출할 최대 도구 수(예산). 0 이하면 빈 배열. */
    budget: number;
    /** 이미 노출된 도구 이름(샌드박스 도구 + 정적 extraTools) — 제외. */
    exclude?: Set<string>;
}

/**
 * PURE: 목표에 관련된 도구를 점수 내림차순으로 budget 개까지 선별.
 * 관련성 0 도구는 제외(budget 을 무관 도구로 채우지 않음 — 문법 폭주 방지).
 * 동점은 이름 오름차순으로 결정적 정렬.
 */
export function selectRelevantTools(
    goal: string,
    catalog: ToolDefinition[],
    opts: SelectToolsOptions,
): ToolDefinition[] {
    if (opts.budget <= 0) return [];
    const tokens = tokenizeGoal(goal);
    if (tokens.length === 0) return [];
    const exclude = opts.exclude ?? new Set<string>();

    const scored = catalog
        .filter((t) => !exclude.has(t.function.name))
        .map((t) => ({ t, s: scoreTool(t, tokens) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || a.t.function.name.localeCompare(b.t.function.name));

    return scored.slice(0, opts.budget).map((x) => x.t);
}
