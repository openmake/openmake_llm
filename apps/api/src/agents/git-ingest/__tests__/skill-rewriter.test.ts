import {
    buildToolMappingHint,
    parseRewriteResponse,
    isAcceptableRewrite,
    proposeSkillRewrite,
} from '../skill-rewriter';
import type { LLMClient } from '../../../llm/client';

describe('skill-rewriter', () => {
    describe('buildToolMappingHint', () => {
        it('본문에 등장하는 도구만 대응표에 싣는다', () => {
            const hint = buildToolMappingHint('Use the `Bash` command and the Read tool.');
            expect(hint).toContain('`Bash` → `bash`');
            expect(hint).toContain('`Read` → `file_ops`');
            expect(hint).not.toContain('WebFetch');
        });

        it('대응 도구가 없으면 그렇게 표기', () => {
            expect(buildToolMappingHint('use `NotebookEdit` here')).toContain('대응 도구 없음');
        });

        it('도구 언급이 없으면 빈 문자열', () => {
            expect(buildToolMappingHint('일반적인 지침 본문입니다.')).toBe('');
        });
    });

    describe('parseRewriteResponse', () => {
        it('JSON 파싱', () => {
            const r = parseRewriteResponse(JSON.stringify({ changed: true, content: 'new', summary: ['a'] }));
            expect(r).toEqual({ changed: true, content: 'new', summary: ['a'] });
        });

        it('code fence 감싼 응답', () => {
            const r = parseRewriteResponse('```json\n{"changed":false,"content":"","summary":[]}\n```');
            expect(r?.changed).toBe(false);
        });

        it('파싱 불가는 null', () => {
            expect(parseRewriteResponse('not json')).toBeNull();
            expect(parseRewriteResponse('')).toBeNull();
        });
    });

    describe('isAcceptableRewrite', () => {
        const original = 'a'.repeat(1000);

        it('충분한 길이의 변경본은 수용', () => {
            expect(isAcceptableRewrite(original, 'b'.repeat(900))).toBe(true);
        });

        it('요약해버린 제안은 거부 (내용 소실 방지)', () => {
            expect(isAcceptableRewrite(original, 'b'.repeat(300))).toBe(false);
        });

        it('빈 값·동일 내용은 거부', () => {
            expect(isAcceptableRewrite(original, '')).toBe(false);
            expect(isAcceptableRewrite(original, original)).toBe(false);
        });
    });

    describe('proposeSkillRewrite', () => {
        const body = '이 스킬은 `Bash` 도구를 씁니다.\n'.repeat(40);

        function mockLlm(content: string) {
            return { chat: jest.fn().mockResolvedValue({ content, metrics: { completion_tokens: 10 } }) } as unknown as Pick<LLMClient, 'chat'>;
        }

        it('변경 제안을 반환', async () => {
            const proposed = body.replace(/`Bash`/g, '`bash`');
            const llm = mockLlm(JSON.stringify({ changed: true, content: proposed, summary: ['도구 이름 교체'] }));
            const r = await proposeSkillRewrite(llm, { name: 's', content: body, model: 'm' });
            expect(r?.content).toBe(proposed);
            expect(r?.summary).toEqual(['도구 이름 교체']);
        });

        it('changed=false 면 제안 없음', async () => {
            const llm = mockLlm(JSON.stringify({ changed: false, content: '', summary: [] }));
            expect(await proposeSkillRewrite(llm, { name: 's', content: body, model: 'm' })).toBeNull();
        });

        it('내용이 급감하면 제안을 버린다', async () => {
            const llm = mockLlm(JSON.stringify({ changed: true, content: '짧은 요약', summary: [] }));
            expect(await proposeSkillRewrite(llm, { name: 's', content: body, model: 'm' })).toBeNull();
        });

        it('LLM 오류는 fail-open (null)', async () => {
            const llm = { chat: jest.fn().mockRejectedValue(new Error('boom')) } as unknown as Pick<LLMClient, 'chat'>;
            expect(await proposeSkillRewrite(llm, { name: 's', content: body, model: 'm' })).toBeNull();
        });

        it('검사 대상을 경계 태그로 감싸 전달', async () => {
            const llm = mockLlm(JSON.stringify({ changed: false, content: '', summary: [] }));
            await proposeSkillRewrite(llm, { name: 's', content: body, model: 'm' });
            const messages = (llm.chat as jest.Mock).mock.calls[0][0];
            expect(messages[1].content).toContain('<skill_body>');
            expect(messages[1].content).toContain('</skill_body>');
        });
    });
});
