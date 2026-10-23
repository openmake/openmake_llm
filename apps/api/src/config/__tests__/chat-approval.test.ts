/**
 * W3 S3 — 채팅 도구 승인 정책 기본값: 미설정이면 운영(production)은 high-risk, 개발·테스트는 none.
 * 모르는 값은 무시하고 기본을 쓴다. 값은 모듈을 읽을 때 정해지므로 env 를 바꾼 뒤 모듈을 다시 읽는다.
 */
type ChatApprovalModule = typeof import('../chat-approval');

const KEYS = ['NODE_ENV', 'CHAT_TOOL_APPROVAL_POLICY', 'CHAT_TOOL_APPROVAL_TIMEOUT_MS', 'CHAT_TOOL_APPROVAL_TAINT'] as const;

function loadWith(env: Partial<Record<(typeof KEYS)[number], string>>): ChatApprovalModule {
    for (const k of KEYS) {
        if (k === 'NODE_ENV') continue;
        delete process.env[k];
    }
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    jest.resetModules();
    return require('../chat-approval') as ChatApprovalModule;
}

describe('CHAT_TOOL_APPROVAL (W3 S3)', () => {
    const saved: Partial<Record<(typeof KEYS)[number], string>> = {};
    beforeAll(() => { for (const k of KEYS) if (process.env[k] !== undefined) saved[k] = process.env[k]; });
    afterEach(() => {
        for (const k of KEYS) {
            if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
        }
        jest.resetModules();
    });

    it('운영 + 미설정 → high-risk, 오염 판정 켜짐', () => {
        const { CHAT_TOOL_APPROVAL } = loadWith({ NODE_ENV: 'production' });
        expect(CHAT_TOOL_APPROVAL.POLICY).toBe('high-risk');
        expect(CHAT_TOOL_APPROVAL.TAINT_ENABLED).toBe(true);
    });

    it('테스트 + 미설정 → none', () => {
        const { CHAT_TOOL_APPROVAL } = loadWith({ NODE_ENV: 'test' });
        expect(CHAT_TOOL_APPROVAL.POLICY).toBe('none');
    });

    it("모르는 값('bogus') → 환경 기본", () => {
        expect(loadWith({ NODE_ENV: 'production', CHAT_TOOL_APPROVAL_POLICY: 'bogus' }).CHAT_TOOL_APPROVAL.POLICY).toBe('high-risk');
        expect(loadWith({ NODE_ENV: 'test', CHAT_TOOL_APPROVAL_POLICY: 'bogus' }).CHAT_TOOL_APPROVAL.POLICY).toBe('none');
    });

    it("명시 'all' → all(환경과 무관)", () => {
        expect(loadWith({ NODE_ENV: 'test', CHAT_TOOL_APPROVAL_POLICY: 'all' }).CHAT_TOOL_APPROVAL.POLICY).toBe('all');
        expect(loadWith({ NODE_ENV: 'production', CHAT_TOOL_APPROVAL_POLICY: 'none' }).CHAT_TOOL_APPROVAL.POLICY).toBe('none');
    });

    it('대기 시간 — 미설정·잘못된 값은 120초, 명시하면 그 값', () => {
        expect(loadWith({ NODE_ENV: 'test' }).CHAT_TOOL_APPROVAL.TIMEOUT_MS).toBe(120_000);
        expect(loadWith({ NODE_ENV: 'test', CHAT_TOOL_APPROVAL_TIMEOUT_MS: 'x' }).CHAT_TOOL_APPROVAL.TIMEOUT_MS).toBe(120_000);
        expect(loadWith({ NODE_ENV: 'test', CHAT_TOOL_APPROVAL_TIMEOUT_MS: '5000' }).CHAT_TOOL_APPROVAL.TIMEOUT_MS).toBe(5000);
        expect(loadWith({ NODE_ENV: 'test', CHAT_TOOL_APPROVAL_TIMEOUT_MS: '-5' }).CHAT_TOOL_APPROVAL.TIMEOUT_MS).toBe(120_000);
    });

    it('오염 판정 — 명시 false 는 운영에서도 끈다', () => {
        expect(loadWith({ NODE_ENV: 'production', CHAT_TOOL_APPROVAL_TAINT: 'false' }).CHAT_TOOL_APPROVAL.TAINT_ENABLED).toBe(false);
    });

    it('parseApprovalPolicy — all|high-risk|none 만 받는다', () => {
        const { parseApprovalPolicy } = loadWith({ NODE_ENV: 'test' });
        expect(parseApprovalPolicy('all')).toBe('all');
        expect(parseApprovalPolicy('high-risk')).toBe('high-risk');
        expect(parseApprovalPolicy('none')).toBe('none');
        expect(parseApprovalPolicy('ALL')).toBeUndefined();
        expect(parseApprovalPolicy('')).toBeUndefined();
        expect(parseApprovalPolicy(undefined)).toBeUndefined();
    });
});
