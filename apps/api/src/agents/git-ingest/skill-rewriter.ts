/**
 * 설치 시 적응 Phase 3 — 스킬 본문 재작성 **제안** 생성 (LLM 1회, fail-open).
 *
 * Phase 1 은 본문을 건드리지 않고 안내 노트만 앞에 붙였다(치환 오탐 위험 때문).
 * 이 모듈은 본문 자체를 다듬되 **자동 적용하지 않는다** — 제안을 만들고, 사용자가
 * 승인 화면에서 diff 를 확인한 뒤 명시적으로 적용할 때만 반영된다.
 *
 * 안전 장치:
 *   - fail-open: 호출/파싱 실패 시 null → 호출자가 원문 유지
 *   - 소실 방지: 결과 길이가 원문 대비 급감하면(요약해버린 경우) 제안을 버린다
 *   - 무변경 판정: changed=false 또는 내용 동일이면 제안 없음
 *
 * @module agents/git-ingest/skill-rewriter
 */
import type { LLMClient } from '../../llm/client';
import type { ChatMessage } from '../../llm/types';
import { createLogger } from '../../utils/logger';
import { SKILL_REWRITE, CLAUDE_TOOL_ALIASES } from '../../config/skill-compat';
import { buildSkillRewriteSystemPrompt, buildSkillRewriteUserPrompt } from '../../prompts/skill-rewrite';

const logger = createLogger('SkillRewriter');

export interface SkillRewriteProposal {
    /** 제안된 전체 본문 */
    content: string;
    /** 무엇을 왜 바꿨는지 (사용자에게 보여줄 요약) */
    summary: string[];
    model: string;
    tokensUsed: number;
}

/** 본문에 등장하는 도구만 골라 대응표 문자열로 (프롬프트 비대화 방지). */
export function buildToolMappingHint(body: string): string {
    const lines: string[] = [];
    for (const [from, to] of Object.entries(CLAUDE_TOOL_ALIASES)) {
        const re = new RegExp(`(\`${from}\`)|(\\b${from}\\s+(tool|도구))`, 'i');
        if (!re.test(body)) continue;
        lines.push(to ? `   - \`${from}\` → \`${to}\`` : `   - \`${from}\` → (이 환경에는 대응 도구 없음)`);
    }
    return lines.join('\n');
}

/** LLM 응답 텍스트 → 제안 객체. 파싱 불가면 null. */
export function parseRewriteResponse(raw: string): { changed: boolean; content: string; summary: string[] } | null {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) return null;
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    const candidate = fence ? fence[1] : trimmed;
    try {
        const parsed = JSON.parse(candidate) as { changed?: unknown; content?: unknown; summary?: unknown };
        const changed = parsed.changed === true;
        const content = typeof parsed.content === 'string' ? parsed.content : '';
        const summary = Array.isArray(parsed.summary)
            ? parsed.summary.filter((s): s is string => typeof s === 'string')
            : [];
        return { changed, content, summary };
    } catch {
        return null;
    }
}

/**
 * 제안 수용 가능 여부 — 내용 소실을 막는 결정적 가드.
 *
 * LLM 이 "다듬어라"를 "요약해라"로 해석해 본문을 대폭 줄이는 실패가 흔하다. 길이 비율이
 * 하한 미만이면 제안 자체를 버린다(사용자에게 보여주지도 않는다).
 */
export function isAcceptableRewrite(original: string, proposed: string): boolean {
    if (!proposed.trim()) return false;
    if (proposed.trim() === original.trim()) return false;
    const ratio = proposed.length / Math.max(original.length, 1);
    return ratio >= SKILL_REWRITE.minLengthRatio;
}

/**
 * 재작성 제안 생성. 실패·무변경·소실 의심은 모두 null (fail-open).
 */
export async function proposeSkillRewrite(
    llm: Pick<LLMClient, 'chat'>,
    input: { name: string; content: string; model: string },
): Promise<SkillRewriteProposal | null> {
    if (!SKILL_REWRITE.enabled) return null;
    const body = input.content;
    if (body.length > SKILL_REWRITE.maxBodyChars) {
        logger.info(`재작성 건너뜀 (본문 ${body.length}자 > 상한): ${input.name}`);
        return null;
    }
    const messages: ChatMessage[] = [
        { role: 'system', content: buildSkillRewriteSystemPrompt(buildToolMappingHint(body)) },
        { role: 'user', content: buildSkillRewriteUserPrompt(input.name, body) },
    ];
    try {
        const resp = await llm.chat(messages);
        const parsed = parseRewriteResponse(resp.content ?? '');
        if (!parsed || !parsed.changed) return null;
        if (!isAcceptableRewrite(body, parsed.content)) {
            logger.warn(`재작성 제안 폐기 (내용 소실 의심): ${input.name} — ${body.length}자 → ${parsed.content.length}자`);
            return null;
        }
        return {
            content: parsed.content,
            summary: parsed.summary,
            model: input.model,
            tokensUsed: resp.metrics?.completion_tokens ?? 0,
        };
    } catch (e) {
        logger.warn(`재작성 제안 실패 (원문 유지): ${input.name} — ${e instanceof Error ? e.message : String(e)}`);
        return null;
    }
}
