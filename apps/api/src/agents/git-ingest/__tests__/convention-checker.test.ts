import { ConventionChecker } from '../convention-checker';
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

    it('Docker keyword 감지 → severity=error', async () => {
        (mockLLM.chat as jest.Mock).mockResolvedValueOnce({
            content: JSON.stringify({ findings: [{ severity: 'error', rule: 'no-docker', message: 'Docker 참조 감지' }] }),
            metrics: { completion_tokens: 80 },
        });
        const c = new ConventionChecker(mockLLM as LLMClient);
        const r = await c.check('docker-compose.yml 참조', 'Run Docker...');
        expect(r.findings).toHaveLength(1);
        expect(r.findings[0].severity).toBe('error');
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
});
