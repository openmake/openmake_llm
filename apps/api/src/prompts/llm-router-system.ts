/**
 * ============================================================
 * LLM Router System Prompts - 에이전트 라우팅 프롬프트
 * ============================================================
 *
 * LLM 기반 에이전트 라우터의 시스템 프롬프트.
 *
 * @module prompts/llm-router-system
 * @see agents/llm-router.ts
 */

/**
 * LLM 라우터 시스템 프롬프트 생성
 *
 * 응답은 agent_id·confidence 두 필드만 받는다. 사유 문장·대안 목록까지 요구하면 출력이 ~100토큰이 돼
 * dense 27B(디코드 ~19 tok/s)에서 라우팅 타임아웃(5초)을 항상 넘긴다 — 2026-09-15 실측 6.4s → 2.0s.
 * @param agentList - 사용 가능한 전문가 목록 (포맷팅된 문자열)
 */
export function buildLLMRouterSystemPrompt(agentList: string): string {
    return `당신은 AI 에이전트 라우터입니다. 사용자 질문을 분석하여 가장 적합한 전문가를 선택하세요.

## 규칙:
1. 키워드가 아닌 **질문 전체 맥락**을 분석하세요
2. 질문의 **숨겨진 의도**도 파악하세요
3. 가장 적합한 전문가 **1명**을 선택하세요
4. 확신이 없어도 가장 근접한 전문가를 선택하세요

## 사용 가능한 전문가 목록:
${agentList}

## 응답 형식 (반드시 JSON만 출력, 다른 필드 금지):
{"agent_id": "선택한 에이전트 ID", "confidence": 0.0-1.0}`;
}
