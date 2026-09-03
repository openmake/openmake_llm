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
import {
    buildSkillRewriteSystemPrompt,
    buildSkillRewriteUserPrompt,
    REWRITE_CHANGED_MARKER,
    REWRITE_SUMMARY_MARKER,
    REWRITE_CONTENT_MARKER,
} from '../../prompts/skill-rewrite';

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

/**
 * LLM 응답 텍스트 → 제안 객체. 파싱 불가면 null.
 *
 * 마커 기반 — 본문이 코드블록·백틱·따옴표가 섞인 긴 마크다운이라 JSON 문자열로 받으면
 * 이스케이프가 깨진다(실측: 정상 종료했는데도 JSON.parse 실패). 마커는 그 문제가 없다.
 */
export function parseRewriteResponse(raw: string): { changed: boolean; content: string; summary: string[] } | null {
    const text = (raw ?? '').trim();
    if (!text) return null;

    const changedIdx = text.indexOf(REWRITE_CHANGED_MARKER);
    if (changedIdx === -1) return null;

    // "===CHANGED=== yes|no"
    const changedLineEnd = text.indexOf('\n', changedIdx);
    const changedLine = (changedLineEnd === -1 ? text.slice(changedIdx) : text.slice(changedIdx, changedLineEnd));
    const changed = /\b(yes|true)\b/i.test(changedLine.slice(REWRITE_CHANGED_MARKER.length));
    if (!changed) return { changed: false, content: '', summary: [] };

    const contentIdx = text.indexOf(REWRITE_CONTENT_MARKER);
    if (contentIdx === -1) return null;   // changed=yes 인데 본문이 없으면 신뢰 불가

    const summaryIdx = text.indexOf(REWRITE_SUMMARY_MARKER);
    const summary = summaryIdx !== -1 && summaryIdx < contentIdx
        ? text.slice(summaryIdx + REWRITE_SUMMARY_MARKER.length, contentIdx)
            .split('\n')
            .map(l => l.replace(/^\s*[-*]\s*/, '').trim())
            .filter(Boolean)
        : [];

    // ⚠️ 바깥 펜스를 벗기지 않는다 — 본문이 코드블록으로 시작/끝나는 경우가 흔해
    // (```bash … ```) 벗겨내면 본문 자체가 훼손된다. 프롬프트가 "펜스로 감싸지 말 것"을
    // 지시하며, 설령 감싸더라도 앞뒤에 ``` 가 남는 편이 본문 파손보다 안전하다.
    const content = text.slice(contentIdx + REWRITE_CONTENT_MARKER.length).replace(/^\r?\n/, '');
    return { changed: true, content: content.trimEnd(), summary };
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
        const resp = await llm.chat(messages, undefined, undefined, { think: false });
        const parsed = parseRewriteResponse(resp.content ?? '');
        if (!parsed) {
            // 파싱 실패를 "변경 불필요"와 섞으면 진단이 불가능해진다 (실측 사례)
            logger.warn(`재작성 응답 파싱 실패 (원문 유지): ${input.name} — 응답 ${(resp.content ?? '').length}자`);
            return null;
        }
        if (!parsed.changed) return null;
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
