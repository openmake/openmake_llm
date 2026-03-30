/**
 * ============================================================
 * PreCompletion Checklist — 종료 전 셀프 검증 프롬프트
 * ============================================================
 *
 * Harness Engineering 원칙 (Verify):
 * AgentLoop 종료 직전에 LLM이 스스로 응답을 점검하도록 유도합니다.
 * 코드 도메인과 일반 도메인에 따라 다른 체크리스트를 적용합니다.
 *
 * LangChain PreCompletionChecklistMiddleware 참고:
 * https://blog.langchain.com/improving-deep-agents-with-harness-engineering/
 *
 * @module prompts/checklist-system
 */

/** 체크리스트 도메인 타입 */
export type ChecklistDomain = 'code' | 'general';

/** 체크리스트 파싱 결과 */
export interface ChecklistResult {
    /** 체크리스트 통과 여부 */
    passed: boolean;
    /** 발견된 이슈 목록 (빈 배열이면 통과) */
    issues: string[];
}

/**
 * 도메인별 체크리스트 프롬프트
 *
 * 코드 도메인: 컴파일 가능성, 엣지 케이스, 에러 처리, 보안 취약점
 * 일반 도메인: 사실 정확성, 완전성, 일관성, 명확성
 */
const CHECKLIST_PROMPTS: Record<ChecklistDomain, string> = {
    code: `당신은 코드 품질 검증자입니다. 아래 응답을 다음 체크리스트로 검증하세요.

## 체크리스트
1. 코드가 구문 오류 없이 실행 가능한가?
2. 엣지 케이스(빈 입력, null, 경계값)가 처리되었는가?
3. 에러 핸들링이 적절한가?
4. 보안 취약점(XSS, SQL Injection, 경로 탐색)이 없는가?
5. 사용자의 질문에 완전히 답변했는가?

## 응답 형식
반드시 아래 형식으로만 답변하세요:
PASS — 모든 항목을 통과한 경우
FAIL:
- [이슈 1 설명]
- [이슈 2 설명]`,

    general: `당신은 응답 품질 검증자입니다. 아래 응답을 다음 체크리스트로 검증하세요.

## 체크리스트
1. 사실적으로 정확한가? (확인 불가한 주장이 있는가?)
2. 사용자의 질문에 완전히 답변했는가? (누락된 부분이 있는가?)
3. 논리적으로 일관성이 있는가? (모순이 없는가?)
4. 명확하고 이해하기 쉬운가?

## 응답 형식
반드시 아래 형식으로만 답변하세요:
PASS — 모든 항목을 통과한 경우
FAIL:
- [이슈 1 설명]
- [이슈 2 설명]`,
};

/**
 * 도메인과 응답 텍스트를 받아 체크리스트 검증 프롬프트를 생성합니다.
 *
 * @param domain - 체크리스트 도메인 ('code' | 'general')
 * @param response - 검증 대상 응답 텍스트
 * @returns 체크리스트 검증 프롬프트 전체 텍스트
 */
export function getChecklistPrompt(domain: ChecklistDomain, response: string): string {
    const checklist = CHECKLIST_PROMPTS[domain];
    // 응답이 너무 길면 앞부분만 사용 (체크리스트 검증에 전체 필요 없음)
    const truncatedResponse = response.length > 3000
        ? response.substring(0, 3000) + '\n...(이하 생략)'
        : response;

    return `${checklist}\n\n## 검증 대상 응답\n${truncatedResponse}`;
}

/**
 * 체크리스트 LLM 응답을 파싱하여 통과/실패 여부와 이슈 목록을 추출합니다.
 *
 * @param response - LLM의 체크리스트 검증 응답
 * @returns 파싱된 체크리스트 결과
 */
export function parseChecklistResult(response: string): ChecklistResult {
    const trimmed = response.trim();

    // PASS 감지
    if (trimmed.startsWith('PASS') || trimmed.toUpperCase().includes('PASS')) {
        // FAIL도 포함되어 있으면 FAIL 우선
        if (!trimmed.toUpperCase().includes('FAIL')) {
            return { passed: true, issues: [] };
        }
    }

    // FAIL 감지: "- " 로 시작하는 줄들을 이슈로 추출
    const issues: string[] = [];
    const lines = trimmed.split('\n');
    for (const line of lines) {
        const match = line.match(/^[-*]\s+(.+)/);
        if (match) {
            issues.push(match[1].trim());
        }
    }

    // 이슈가 없는데 FAIL이라고 한 경우 → 통과 처리 (파싱 불가)
    if (issues.length === 0) {
        return { passed: true, issues: [] };
    }

    return { passed: false, issues };
}
