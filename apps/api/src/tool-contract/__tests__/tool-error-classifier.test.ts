import { classifyToolError, formatToolError, isConnectionDeathError } from '../tool-error-classifier';

describe('classifyToolError', () => {
    it('권한 에러를 permission(비재시도)로 분류', () => {
        const r = classifyToolError('🔒 권한 없음: 무료 등급에서는 사용할 수 없습니다.');
        expect(r.category).toBe('permission');
        expect(r.retryable).toBe(false);
        expect(r.hint).toContain('권한');
    });

    it('타임아웃을 timeout(재시도 가능)으로 분류', () => {
        const r = classifyToolError('외부 도구 타임아웃: postgres::query (30000ms 초과)');
        expect(r.category).toBe('timeout');
        expect(r.retryable).toBe(true);
    });

    it('rate limit을 rate_limit(재시도 가능)으로 분류', () => {
        const r = classifyToolError('HTTP 429 Too Many Requests');
        expect(r.category).toBe('rate_limit');
        expect(r.retryable).toBe(true);
    });

    it('미발견을 not_found(비재시도)로 분류', () => {
        const r = classifyToolError('외부 도구를 찾을 수 없습니다: foo::bar');
        expect(r.category).toBe('not_found');
        expect(r.retryable).toBe(false);
    });

    it('출력 초과 잘림을 output_truncated로 분류', () => {
        const r = classifyToolError('... (출력이 1MB를 초과하여 잘렸습니다)');
        expect(r.category).toBe('output_truncated');
        expect(r.retryable).toBe(false);
    });

    it('스키마/필수 인자 오류를 invalid_args로 분류', () => {
        const r = classifyToolError('Invalid arguments: required field "query" missing');
        expect(r.category).toBe('invalid_args');
        expect(r.retryable).toBe(false);
    });

    it('네트워크/5xx를 provider(재시도 가능)로 분류', () => {
        expect(classifyToolError('connect ECONNREFUSED 127.0.0.1:5432').category).toBe('provider');
        expect(classifyToolError('502 Bad Gateway').category).toBe('provider');
        expect(classifyToolError('connect ECONNREFUSED 127.0.0.1:5432').retryable).toBe(true);
    });

    it('미매칭은 execution(비재시도) 기본값', () => {
        const r = classifyToolError('something completely unexpected happened');
        expect(r.category).toBe('execution');
        expect(r.retryable).toBe(false);
    });

    it('우선순위: permission이 not_found보다 먼저 매칭', () => {
        // "권한" + "찾을 수 없습니다" 동시 포함 시 permission 우선
        const r = classifyToolError('권한 없음 — 리소스를 찾을 수 없습니다');
        expect(r.category).toBe('permission');
    });

    it('빈/널 메시지는 안전하게 execution', () => {
        expect(classifyToolError('').category).toBe('execution');
        expect(classifyToolError(undefined as unknown as string).category).toBe('execution');
    });
});

describe('formatToolError', () => {
    it('원문 보존 + 카테고리/힌트 부가', () => {
        const text = formatToolError('외부 도구 타임아웃: x (30000ms 초과)');
        expect(text).toContain('외부 도구 타임아웃');
        expect(text).toContain('[오류 유형: timeout, 재시도 가능]');
    });

    it('비재시도 카테고리는 재시도 라벨 없음', () => {
        const text = formatToolError('🔒 권한 없음');
        expect(text).toContain('[오류 유형: permission]');
        expect(text).not.toContain('재시도 가능');
    });

    it('모든 도구 오류에 환각 방지(추측·날조 금지) 지시를 부가', () => {
        // provider 실패(예: 검색 도구 "Not connected") 후 대체 도구까지 실패하면
        // 모델이 parametric 지식으로 날조하던 회귀 방어 — formatToolError 가 항상
        // anti-fabrication 지시를 포함해야 한다.
        const provider = formatToolError('도구 실행 오류 (brave_web_search): Not connected');
        expect(provider).toContain('지어내지 마세요');
        const perm = formatToolError('🔒 권한 없음');
        expect(perm).toContain('지어내지 마세요');
    });
});

describe('isConnectionDeathError', () => {
    it('연결 사망 신호(컨테이너 死/세션 무효)를 감지', () => {
        expect(isConnectionDeathError('도구 실행 오류 (brave_web_search): Not connected')).toBe(true);
        expect(isConnectionDeathError('Streamable HTTP error: ... "Session not found" ...')).toBe(true);
        expect(isConnectionDeathError('ECONNRESET')).toBe(true);
        expect(isConnectionDeathError('socket hang up')).toBe(true);
    });
    it('일반 도구 오류는 연결 사망이 아님', () => {
        expect(isConnectionDeathError('invalid arguments: missing field url')).toBe(false);
        expect(isConnectionDeathError('rate limit exceeded (429)')).toBe(false);
        expect(isConnectionDeathError('')).toBe(false);
    });
});
