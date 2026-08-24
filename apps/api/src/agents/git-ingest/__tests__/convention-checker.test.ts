import { ConventionChecker, isBlockedByConvention } from '../convention-checker';
import type { LLMClient } from '../../../llm/client';

describe('ConventionChecker', () => {
    const mockLLM = { chat: jest.fn() } as unknown as Pick<LLMClient, 'chat'>;

    beforeEach(() => jest.clearAllMocks());

    it('clean manifest → findings 빈 배열', async () => {
        (mockLLM.chat as jest.Mock).mockResolvedValueOnce({
            content: JSON.stringify({ findings: [] }),
            metrics: { completion_tokens: 50 },
        });
        const c = new ConventionChecker(mockLLM as LLMClient);
        const r = await c.check('manifest yaml', 'prompt body');
        expect(r.findings).toEqual([]);
        expect(r.tokensUsed).toBe(50);
    });

    // LLM 이 error 를 매겨도 warn 으로 강등한다 — 차단 권한은 정적 룰에만 있다.
    // (LLM audit 이 자기 지시문·폐기된 정책으로 정상 플러그인을 막던 오탐, 2026-08-24)
    it('LLM 이 매긴 error 는 warn 으로 강등 + source=llm 표시', async () => {
        (mockLLM.chat as jest.Mock).mockResolvedValueOnce({
            content: JSON.stringify({ findings: [{ severity: 'error', rule: 'prompt-injection-risk', message: '인젝션 의심' }] }),
            metrics: { completion_tokens: 80 },
        });
        const c = new ConventionChecker(mockLLM as LLMClient);
        const r = await c.check('m', 'p');
        expect(r.findings).toHaveLength(1);
        expect(r.findings[0].severity).toBe('warn');
        expect(r.findings[0].source).toBe('llm');
        expect(isBlockedByConvention(r.findings)).toBe(false);
    });

    it('검사 대상을 경계 태그로 감싸 전달한다 (자기 지시문 오탐 방지)', async () => {
        (mockLLM.chat as jest.Mock).mockResolvedValueOnce({
            content: JSON.stringify({ findings: [] }), metrics: { completion_tokens: 5 },
        });
        const c = new ConventionChecker(mockLLM as LLMClient);
        await c.check('yaml-here', 'body-here');
        const messages = (mockLLM.chat as jest.Mock).mock.calls[0][0];
        expect(messages[1].content).toContain('<audit_target>');
        expect(messages[1].content).toContain('</audit_target>');
        expect(messages[1].content).toContain('yaml-here');
    });

    it('mcp-server 모드는 전용 시스템 프롬프트를 쓴다 (SKILL.md 전제 오탐 방지)', async () => {
        (mockLLM.chat as jest.Mock).mockResolvedValueOnce({
            content: JSON.stringify({ findings: [] }), metrics: { completion_tokens: 5 },
        });
        const c = new ConventionChecker(mockLLM as LLMClient);
        await c.check('{"command":"npx"}', '', 'mcp-server');
        const messages = (mockLLM.chat as jest.Mock).mock.calls[0][0];
        expect(messages[0].content).toContain('MCP 서버 정의를 검토');
        expect(messages[1].content).toContain('MCP 서버 정의');
    });

    describe('isBlockedByConvention', () => {
        it('정적 룰의 error 만 차단', () => {
            expect(isBlockedByConvention([
                { severity: 'error', rule: 'remote-exec', message: 'x', source: 'static' },
            ])).toBe(true);
        });

        it('LLM findings 는 error 라도 차단하지 않는다', () => {
            expect(isBlockedByConvention([
                { severity: 'error', rule: 'no-docker', message: 'x', source: 'llm' },
            ])).toBe(false);
        });

        it('source 없는 과거 findings 는 정적으로 간주하되, LLM 전용 룰은 제외 (기존 draft 구제)', () => {
            // 과거 저장분에는 source 가 없다 — 실측 오탐 룰만 예외로 풀어준다
            expect(isBlockedByConvention([
                { severity: 'error', rule: 'prompt-injection-risk', message: 'x' },
            ])).toBe(false);
            expect(isBlockedByConvention([
                { severity: 'error', rule: 'risky-curl-sh', message: 'x' },
            ])).toBe(true);
        });

        it('warn/info 나 빈 배열은 차단 없음', () => {
            expect(isBlockedByConvention([{ severity: 'warn', rule: 'x', message: 'y', source: 'static' }])).toBe(false);
            expect(isBlockedByConvention([])).toBe(false);
            expect(isBlockedByConvention(undefined)).toBe(false);
        });
    });

    it('LLM 응답이 invalid JSON → finding(severity=warn, rule=llm-parse-fail)', async () => {
        (mockLLM.chat as jest.Mock).mockResolvedValueOnce({ content: 'not json', metrics: { completion_tokens: 3 } });
        const c = new ConventionChecker(mockLLM as LLMClient);
        const r = await c.check('m', 'p');
        expect(r.findings[0].rule).toBe('llm-parse-fail');
        expect(r.findings[0].severity).toBe('warn');
    });

    it('JSON code fence 감싸진 응답도 파싱 가능', async () => {
        (mockLLM.chat as jest.Mock).mockResolvedValueOnce({
            content: '```json\n{"findings":[{"severity":"info","rule":"x","message":"y"}]}\n```',
            metrics: { completion_tokens: 10 },
        });
        const c = new ConventionChecker(mockLLM as LLMClient);
        const r = await c.check('m', 'p');
        expect(r.findings).toHaveLength(1);
        expect(r.findings[0].rule).toBe('x');
    });
    // ⚠️ 펜스를 먼저 벗기면 JSON **안의** 코드블록을 잡아 깨진다 — 전체 파싱이 먼저다
    // (2026-08-24 skill-creator 실측: `Unexpected token 'p', "python..."`)
    it('findings 안에 코드펜스가 있어도 정상 파싱 (전체 파싱 우선)', async () => {
        const payload = JSON.stringify({
            findings: [{
                severity: 'warn', rule: 'x',
                message: '예시: ```python\nimport os\n``` 를 쓰지 마세요',
            }],
        });
        (mockLLM.chat as jest.Mock).mockResolvedValueOnce({
            content: payload, metrics: { completion_tokens: 10 },
        });
        const c = new ConventionChecker(mockLLM as LLMClient);
        const r = await c.check('m', 'p');
        expect(r.findings).toHaveLength(1);
        expect(r.findings[0].rule).toBe('x');
    });

});
