/**
 * ============================================================
 * Tool Error Classifier — 도구 실행 에러 분류 + 교정 힌트
 * ============================================================
 *
 * Harness Engineering 원칙 적용:
 * - Cursor harness 블로그: tool 에러를 invalid args / unexpected environment /
 *   provider error 로 분류하면 모델 실수와 인프라 장애를 구분해 같은 모델에서도
 *   에러를 10배 줄일 수 있다.
 * - Ryan Lopopolo (OpenAI, "Harness Engineering"): 에러 메시지는 모델·사람이
 *   다음에 무엇을 해야 할지 알 수 있는 actionable remediation 을 담아야 한다.
 *
 * 이 모듈은 ToolRouter 가 반환하는 raw 에러 메시지를 카테고리로 분류하고,
 * 모델에게 줄 한국어 교정 가이드(hint)와 재시도 가능 여부를 산출합니다.
 * 부수효과 없는 순수 함수로 — 어디서든 재사용 가능합니다.
 *
 * @module mcp/tool-error-classifier
 */

/** 도구 실행 에러 카테고리 */
export type ToolErrorCategory =
    | 'timeout' // 제한 시간 초과 (일시적)
    | 'not_found' // 도구/리소스 미존재 (영구)
    | 'permission' // 접근 권한 없음 (영구)
    | 'invalid_args' // 입력 인자 스키마 불일치 (모델 실수, 영구)
    | 'rate_limit' // 요청 한도 초과 (일시적)
    | 'provider' // 외부 서비스/네트워크 장애 (일시적)
    | 'output_truncated' // 출력 과대로 잘림 (영구)
    | 'execution'; // 그 외 일반 실행 오류

/** 에러 분류 결과 */
export interface ToolErrorClassification {
    /** 분류된 카테고리 */
    category: ToolErrorCategory;
    /** 일시적 장애로 재시도 시 해소될 수 있는가 (모델/상위 계층 판단 보조) */
    retryable: boolean;
    /** 모델에게 줄 다음 행동 교정 가이드 (actionable remediation) */
    hint: string;
}

/**
 * 카테고리별 매칭 규칙 (순서 = 우선순위, 위에서부터 먼저 매칭).
 * No-Hardcoding: 키워드/정규식을 인라인하지 않고 이 명명 테이블에 외부화.
 */
interface CategoryRule {
    category: ToolErrorCategory;
    pattern: RegExp;
    retryable: boolean;
    hint: string;
}

const CATEGORY_RULES: readonly CategoryRule[] = [
    {
        category: 'permission',
        pattern: /권한\s*없음|🔒|접근 권한이 없는|permission denied|forbidden|unauthorized|\b401\b|\b403\b/i,
        retryable: false,
        hint: '이 도구 또는 경로에 대한 접근 권한이 없습니다. 허용된 리소스를 사용하거나 다른 접근 방식을 시도하세요. 같은 호출을 반복하지 마세요.',
    },
    {
        category: 'rate_limit',
        pattern: /rate limit|too many requests|\b429\b|요청 한도|quota exceeded/i,
        retryable: true,
        hint: '요청 한도에 도달했습니다. 잠시 후 재시도하거나 호출 빈도를 줄이세요.',
    },
    {
        category: 'timeout',
        pattern: /타임아웃|timed?\s*out|timeout|ETIMEDOUT|ms\s*초과|deadline exceeded/i,
        retryable: true,
        hint: '도구가 제한 시간 내 응답하지 않았습니다. 범위를 더 좁혀 재시도하거나 대체 도구를 사용하세요.',
    },
    {
        category: 'not_found',
        pattern: /찾을 수 없습니다|not found|ENOENT|no such|존재하지 않|\b404\b/i,
        retryable: false,
        hint: '대상 도구 또는 리소스가 존재하지 않습니다. 이름·경로를 확인하거나 사용 가능한 도구 목록을 다시 확인하세요.',
    },
    {
        category: 'output_truncated',
        pattern: /출력이 .*잘렸|초과하여 잘렸|truncated|출력 크기/i,
        retryable: false,
        hint: '출력이 너무 커서 잘렸습니다. 더 구체적인 질의로 범위를 좁혀 다시 호출하세요.',
    },
    {
        category: 'invalid_args',
        pattern: /invalid|유효하지 않|필수|required|missing (?:param|argument|field|required)|스키마|schema|\b400\b|bad request|필요합니다/i,
        retryable: false,
        hint: '입력 인자가 도구 스키마와 맞지 않습니다. 필수 필드와 형식을 점검하여 인자를 수정한 뒤 다시 호출하세요.',
    },
    {
        category: 'provider',
        pattern: /\b5\d\d\b|upstream|bad gateway|service unavailable|ECONNREFUSED|ECONNRESET|socket hang up|network|연결|connect/i,
        retryable: true,
        hint: '외부 서비스/제공자 측 일시 장애로 보입니다. 잠시 후 재시도하거나 대체 도구를 사용하세요.',
    },
];

/** 매칭 실패 시 기본 분류 */
const DEFAULT_CLASSIFICATION: ToolErrorClassification = {
    category: 'execution',
    retryable: false,
    hint: '도구 실행 중 오류가 발생했습니다. 인자를 점검하거나 다른 접근 방식을 시도하세요.',
};

/**
 * 도구 실패 시 환각(추측·날조) 방지 지시.
 *
 * 근거: 검색/조회 도구가 모두 실패하면 모델이 parametric 지식으로 폴백하며
 *   확인되지 않은 사실을 지어내는 회귀가 라이브 적대적 테스트에서 재현됨
 *   (예: 존재하지 않는 인물/CVE 를 도구 실패 후 상세히 날조). 기존 hint 들은
 *   remediation(재시도·대체도구)만 안내할 뿐 "지어내지 말라"는 지시가 없어
 *   대체 도구까지 실패하면 방어선이 사라졌다. 모든 도구 오류 결과에 이 지시를
 *   덧붙여, 도구로 확인 못 한 정보는 날조 대신 "확인 불가"를 명시하게 한다.
 */
const ANTI_FABRICATION_GUIDANCE =
    '⚠️ 이 정보를 도구로 확인하지 못했다면 사실을 추측하거나 지어내지 마세요. ' +
    '확인할 수 없다는 점을 사용자에게 명확히 알리고, 정확한 답을 위해 필요한 정보를 요청하세요.';

/**
 * raw 에러 메시지를 카테고리로 분류합니다.
 *
 * @param message - 도구가 반환했거나 throw 된 에러 메시지
 * @returns 카테고리 + 재시도 가능 여부 + 교정 힌트
 */
export function classifyToolError(message: string): ToolErrorClassification {
    const text = message ?? '';
    for (const rule of CATEGORY_RULES) {
        if (rule.pattern.test(text)) {
            return { category: rule.category, retryable: rule.retryable, hint: rule.hint };
        }
    }
    return { ...DEFAULT_CLASSIFICATION };
}

/**
 * 분류 결과를 모델에게 전달할 에러 텍스트로 포맷합니다.
 * 원문 메시지를 보존하면서 카테고리·재시도 가능성·교정 힌트를 덧붙입니다.
 *
 * @param rawMessage - 원본 에러 메시지
 * @param classification - classifyToolError 결과 (생략 시 내부 계산)
 * @returns 모델 친화적 에러 텍스트
 */
export function formatToolError(
    rawMessage: string,
    classification?: ToolErrorClassification
): string {
    const c = classification ?? classifyToolError(rawMessage);
    const retryLabel = c.retryable ? ', 재시도 가능' : '';
    return `${rawMessage}\n[오류 유형: ${c.category}${retryLabel}] ${c.hint}\n${ANTI_FABRICATION_GUIDANCE}`;
}
